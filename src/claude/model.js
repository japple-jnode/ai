/*
@jnode/ai/claude/model.js
v2

Simple AI API package for Node.js.

by Claude (haven't tested, I need your help :D - JA)
*/

// dependencies
const AIAgent = require('./../agent.js');
const AIConversation = require('./../conversation.js');
const { request } = require('@jnode/request');

// thinking level → budget_tokens mapping
const THINKING_BUDGETS = {
    low: 1024,
    medium: 8000,
    high: 32000
};

// sanitize tool name to Claude's allowed pattern: [a-zA-Z0-9_-]{1,64}
function _sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || '_';
}

// claude model
class ClaudeModel {
    constructor(service, name, options = {}) {
        // allow calling as ClaudeModel(name, options) without a service
        if (typeof service === 'string') {
            options = name || {};
            name = service;
            service = null;
        }
        this.service = service;
        this.name = name;
        this.options = options;
        this._info = options.info;

        // generation configs
        this.temperature = options.temperature; // temperature, 0.0~2.0
        this.topP = options.topP ?? options.top_p; // top p, 0.0~1.0
        this.topK = options.topK ?? options.top_k; // top k, >= 1
        this.seed = options.seed; // seed
        this.outputLimit = options.outputLimit ?? options.output_limit; // max output token limit
        this.stopStrings = options.stopStrings ?? options.stop_strings; // strings that will make model stop outputting
        this.logprobs = options.logprobs; // logprobs
        this.frequencyPenalty = options.frequencyPenalty ?? options.frequency_penalty; // frequency penalty, -2.0~2.0
        this.presencePenalty = options.presencePenalty ?? options.presence_penalty; // presence penalty, -2.0~2.0
        this.thinkingLevel = options.thinkingLevel ?? options.thinking_level; // thinking level, "none" / "low" / "medium" / "high"
        this.responseSchema = options.responseSchema ?? options.response_schema; // response schema in JSON Schema for formatted JSON output

        // core instructions, commonly called system prompt
        this.instructions = options.instructions;
    }

    async getInfo() {
        if (this._info) return this._info;

        this._info = {
            type: 'interactive',
            name: this.name,
            altNames: [],
            updated: null,
            released: null,
            description: 'Anthropic Claude model.',
            features: {
                reasoning: true,
                multimodalCapabilities: [
                    'image/png',
                    'image/jpeg',
                    'image/webp',
                    'image/gif',
                    'application/pdf'
                ],
                actions: ['@code_execution']
            },
            inputPrice: null,
            outputPrice: null,
            inputLimit: null,
            outputLimit: null,
            x: {
                provider: 'claude'
            }
        };

        return this._info;
    }

    // build Claude Messages API request body
    async _buildBody(agent, conversation, context, options) {
        const info = await this.getInfo();

        const body = {
            model: this.name,
            max_tokens: agent.outputLimit ?? 8096
        };

        // generation config
        body.temperature = agent.temperature ?? this.temperature;
        body.top_p = agent.topP ?? this.topP;
        body.top_k = agent.topK ?? this.topK;
        body.stop_sequences = agent.stopStrings ?? this.stopStrings;

        // extended thinking
        if ((agent.thinkingLevel ?? this.thinkingLevel) && (agent.thinkingLevel ?? this.thinkingLevel) !== 'none') {
            const budget = agent.x?.claude_budget_tokens ?? this.options?.claude_budget_tokens
                ?? THINKING_BUDGETS[agent.thinkingLevel ?? this.thinkingLevel]
                ?? THINKING_BUDGETS.medium;
            body.thinking = { type: 'enabled', budget_tokens: budget };
            // thinking requires temperature=1 — set only if not explicitly overridden
            body.temperature = agent.temperature ?? 1;
        }

        // structured output via output_config
        if (agent.responseSchema ?? this.responseSchema) {
            body.output_config = {
                format: {
                    type: 'json_schema',
                    schema: agent.responseSchema ?? this.responseSchema
                }
            };
        }

        // system prompt
        if (agent.instructions) body.system = agent.instructions ?? this.instructions;

        // tools
        const tools = [];
        for (const i of agent.actions) {
            let fnInfo = i.getInfo();
            if (fnInfo instanceof Promise) fnInfo = await fnInfo;

            if (fnInfo.name.startsWith('@')) {
                // native actions — map supported ones
                if (fnInfo.name === '@code_execution' && info.features.actions.includes('@code_execution')) {
                    tools.push({ type: 'bash_20250124', name: 'bash' });
                }
                // other unsupported native actions are skipped
            } else {
                tools.push({
                    type: 'custom',
                    name: _sanitizeName(fnInfo.name),
                    description: fnInfo.description,
                    input_schema: fnInfo.parameters ?? { type: 'object', properties: {} }
                });
            }
        }
        for (const i of agent.functions) {
            let fnInfo = i.getInfo();
            if (fnInfo instanceof Promise) fnInfo = await fnInfo;
            tools.push({
                type: 'custom',
                name: _sanitizeName(fnInfo.name),
                description: fnInfo.description,
                input_schema: fnInfo.parameters ?? { type: 'object', properties: {} }
            });
        }
        if (tools.length > 0) body.tools = tools;

        // build messages array
        // Claude requires strict user/assistant alternation; consecutive same-role turns are merged.
        body.messages = [];

        const conv = conversation.conversation;
        for (let i = 0; i < conv.length; i++) {
            const turn = conv[i];
            // map roles: model → assistant, user/system → user
            const claudeRole = turn.role === 'model' ? 'assistant' : 'user';

            const parts = []; // Claude content blocks for this turn

            for (const j of turn.components) {
                switch (j.type) {
                    case 'text':
                        parts.push({ type: 'text', text: j.content });
                        break;

                    case 'thought': {
                        // thinking block — requires signature stored in x.claude_signature
                        const sig = j.x?.claude_signature;
                        if (sig) {
                            parts.push({ type: 'thinking', thinking: j.content, signature: sig });
                        } else if (j.x?.claude_redacted) {
                            parts.push({ type: 'redacted_thinking', data: j.x.claude_redacted_data });
                        }
                        // if no signature, omit (can't replay unsigned thinking)
                        break;
                    }

                    case 'file': {
                        const mediaType = j.mediaType ?? j.media_type;
                        if (!info.features.multimodalCapabilities.includes(mediaType)) {
                            // fallback: treat as plain text if possible
                            if (mediaType === 'text/plain') parts.push({ type: 'text', text: j.data?.toString?.() ?? '' });
                            break;
                        }

                        if (mediaType === 'application/pdf') {
                            // document block
                            if (j.uri) {
                                parts.push({ type: 'document', source: { type: 'url', url: j.uri } });
                            } else {
                                const data = Buffer.isBuffer(j.data) ? j.data.toString('base64') : j.data;
                                parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
                            }
                        } else {
                            // image block
                            if (j.uri) {
                                parts.push({ type: 'image', source: { type: 'url', url: j.uri } });
                            } else {
                                const data = Buffer.isBuffer(j.data) ? j.data.toString('base64') : j.data;
                                parts.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
                            }
                        }
                        break;
                    }

                    case 'function_call':
                        // assistant turn: tool_use block
                        parts.push({
                            type: 'tool_use',
                            id: j.x?.claude_tool_use_id ?? `toolu_${j.name}_${Date.now()}`,
                            name: _sanitizeName(j.name),
                            input: j.arguments ?? {}
                        });
                        break;

                    case 'function_response':
                        // user turn: tool_result block
                        parts.push({
                            type: 'tool_result',
                            tool_use_id: j.x?.claude_tool_use_id ?? '',
                            content: typeof j.result === 'string' ? j.result : JSON.stringify(j.result ?? null)
                        });
                        break;

                    case 'action':
                        if (typeof j.name === 'string' && !j.name.startsWith('@')) {
                            // function-like action: emit tool_use + tool_result as separate turns
                            const toolId = j.x?.claude_tool_use_id ?? `toolu_${j.name}_${Date.now()}`;
                            // flush current parts as assistant turn
                            parts.push({
                                type: 'tool_use',
                                id: toolId,
                                name: _sanitizeName(j.name),
                                input: j.action ?? {}
                            });
                            // We'll push the assistant turn now and start a user turn for the result
                            _pushMessage(body.messages, claudeRole, [...parts]);
                            parts.length = 0;
                            _pushMessage(body.messages, 'user', [{
                                type: 'tool_result',
                                tool_use_id: toolId,
                                content: typeof j.reaction === 'string' ? j.reaction : JSON.stringify(j.reaction ?? null)
                            }]);
                        }
                        // native actions (e.g. @executable_code) are skipped — no standard replay
                        break;
                }
            }

            if (parts.length > 0) {
                _pushMessage(body.messages, claudeRole, parts);
            }
        }

        // merge any additional body overrides
        if (agent.x?.claude_body) Object.assign(body, agent.x.claude_body);

        return body;
    }

    // interact
    async interact(agent, conversation, context, options = {}) {
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, { ...this.options?.agent, ...agent });
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        // execute pending function calls if last turn is model with function_call components
        if (conversation.last?.role === 'model') {
            const funcs = [];
            for (const i of conversation.last.components) {
                if (i.type !== 'function_call') continue;
                const fn = agent._actions[i.name] ?? agent._functions[i.name];
                if (!fn) funcs.push({ name: i.name, func: this.service.unknownFunction, args: i.arguments, ctx: context, id: i.x?.claude_tool_use_id });
                else funcs.push({ name: i.name, func: fn, args: i.arguments, ctx: context, id: i.x?.claude_tool_use_id });
            }
            if (funcs.length > 0) {
                const msg = { role: 'system', components: [] };
                for (const i of funcs) {
                    const res = await i.func.call(i.args, i.ctx);
                    msg.components.push({
                        type: 'function_response',
                        name: i.name,
                        result: res.result,
                        meta: res.meta,
                        x: { claude_tool_use_id: i.id }
                    });
                }
                conversation.conversation.push(msg);
                return conversation;
            }
        }

        const body = await this._buildBody(agent, conversation, context, options);

        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        const baseUrl = this.service?.baseUrl ?? 'https://api.anthropic.com/v1';
        const authKey = options.auth ?? this.options.auth ?? '';

        for (let i = 0; i < maxActions; i++) {
            const res = await request('POST', `${baseUrl}/messages`, JSON.stringify(body), {
                'x-api-key': authKey,
                'anthropic-version': options.anthropicVersion ?? this.options.anthropicVersion ?? '2023-06-01',
                'content-type': 'application/json'
            });

            if (res.statusCode !== 200) throw _requestError(res);

            const data = await res.json();

            // update meta
            meta.model = data.model ?? meta.model;
            meta.inputTotal += data.usage?.input_tokens ?? 0;
            meta.outputTotal += data.usage?.output_tokens ?? 0;

            if (!data.content?.length) break;

            // collect assistant turn for the next loop iteration
            const actionParts = []; // raw Claude blocks for re-injection
            const reactionParts = []; // tool_result blocks
            let hasAction = false;
            let hasUnhandledFunction = false;

            for (const block of data.content) {
                switch (block.type) {
                    case 'text':
                        msg.components.push({ type: 'text', content: block.text });
                        actionParts.push(block);
                        break;

                    case 'thinking':
                        msg.components.push({
                            type: 'thought',
                            content: block.thinking,
                            x: { claude_signature: block.signature }
                        });
                        actionParts.push(block);
                        break;

                    case 'redacted_thinking':
                        msg.components.push({
                            type: 'thought',
                            content: '',
                            x: { claude_redacted: true, claude_redacted_data: block.data }
                        });
                        actionParts.push(block);
                        break;

                    case 'tool_use': {
                        actionParts.push(block);
                        const toolName = block.name; // sanitized name from Claude

                        if (agent._actions[toolName] || agent._actions[block.name]) {
                            const fn = agent._actions[toolName] ?? agent._actions[block.name];
                            const result = await fn.call(block.input, context);

                            msg.components.push({
                                type: 'action',
                                name: toolName,
                                action: block.input,
                                reaction: result.result,
                                reaction_attachments: result.attachments ?? [],
                                meta: result.meta,
                                x: { claude_tool_use_id: block.id }
                            });

                            reactionParts.push({
                                type: 'tool_result',
                                tool_use_id: block.id,
                                content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result ?? null)
                            });

                            hasAction = true;
                        } else {
                            // normal function call — return to caller
                            msg.components.push({
                                type: 'function_call',
                                name: toolName,
                                arguments: block.input,
                                x: { claude_tool_use_id: block.id }
                            });

                            reactionParts.push({
                                type: 'tool_result',
                                tool_use_id: block.id,
                                content: JSON.stringify(
                                    options.canceledResult ?? this.options.canceledResult
                                    ?? { status: 'EXECUTION_CANCELED', message: 'Please run this function again.' }
                                )
                            });

                            hasUnhandledFunction = true;
                        }
                        break;
                    }
                }
            }

            // inject assistant turn + tool results into next request
            if (actionParts.length > 0) {
                _pushMessage(body.messages, 'assistant', actionParts);
            }
            if (reactionParts.length > 0) {
                _pushMessage(body.messages, 'user', reactionParts);
            }

            // continue loop only when all actions were handled
            if (data.stop_reason === 'tool_use' && hasAction && !hasUnhandledFunction) continue;
            break;
        }

        if (msg.components.length > 0) conversation.conversation.push(msg);
        conversation.meta = meta;
        return conversation;
    }

    // stream interact
    async *streamInteract(agent, conversation, context, options = {}) {
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, { ...this.options?.agent, ...agent });
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        // execute pending function calls if last turn is model with function_call components
        if (conversation.last?.role === 'model') {
            const funcs = [];
            for (const i of conversation.last.components) {
                if (i.type === 'function_call') {
                    funcs.push({
                        name: i.name,
                        func: agent._functions[i.name] || agent._actions[i.name] || this.service.unknownFunction,
                        args: i.arguments,
                        ctx: context,
                        id: i.x?.claude_tool_use_id
                    });
                }
            }
            if (funcs.length > 0) {
                const msg = { role: 'system', components: [] };
                for (const i of funcs) {
                    if (!i.func || typeof i.func.call !== 'function') {
                        throw new Error(`Function "${i.name}" is not registered on this agent.`);
                    }
                    const res = await i.func.call(i.args, i.ctx);
                    const component = {
                        type: 'function_response',
                        name: i.name,
                        result: res.result,
                        meta: res.meta,
                        x: { claude_tool_use_id: i.id }
                    };
                    msg.components.push(component);
                    yield { type: 'component', component };
                }
                conversation.conversation.push(msg);
                yield { type: 'end', conversation };
                return conversation;
            }
        }

        const body = await this._buildBody(agent, conversation, context, options);
        body.stream = true;

        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        const baseUrl = this.service?.baseUrl ?? 'https://api.anthropic.com/v1';
        const authKey = options.auth ?? this.options.auth ?? '';

        for (let i = 0; i < maxActions; i++) {
            const res = await request('POST', `${baseUrl}/messages`, JSON.stringify(body), {
                'x-api-key': authKey,
                'anthropic-version': options.anthropicVersion ?? this.options.anthropicVersion ?? '2023-06-01',
                'content-type': 'application/json'
            });

            if (res.statusCode !== 200) throw _requestError(res);

            const sse = res.sse();

            const requestMeta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };

            // per-stream state
            const blocks = {}; // index → { component, actionPart, partialJson? }
            let lastComponent = null;
            let stopReason = null;
            let hasAction = false;
            let hasUnhandledFunction = false;

            const actionParts = [];   // raw Claude blocks for next request
            const reactionParts = []; // tool_result blocks

            for await (const event of sse) {
                if (!event.data || event.data === '[DONE]') continue;

                let data;
                try { data = JSON.parse(event.data); } catch { continue; }

                switch (data.type) {
                    case 'message_start':
                        requestMeta.model = data.message?.model ?? requestMeta.model;
                        requestMeta.inputTotal = data.message?.usage?.input_tokens ?? 0;
                        requestMeta.outputTotal = data.message?.usage?.output_tokens ?? 0;
                        break;

                    case 'content_block_start': {
                        const idx = data.index;
                        const cb = data.content_block;

                        if (cb.type === 'text') {
                            const component = { type: 'text', content: cb.text ?? '' };
                            blocks[idx] = { component, actionPart: { type: 'text', text: cb.text ?? '' } };
                            msg.components.push(component);
                            yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                            lastComponent = component;
                        } else if (cb.type === 'thinking') {
                            const component = { type: 'thought', content: cb.thinking ?? '', x: { claude_signature: '' } };
                            blocks[idx] = { component, actionPart: { type: 'thinking', thinking: cb.thinking ?? '', signature: '' } };
                            msg.components.push(component);
                            yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                            lastComponent = component;
                        } else if (cb.type === 'redacted_thinking') {
                            const component = { type: 'thought', content: '', x: { claude_redacted: true, claude_redacted_data: cb.data ?? '' } };
                            blocks[idx] = { component, actionPart: { type: 'redacted_thinking', data: cb.data ?? '' } };
                            msg.components.push(component);
                            yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                            lastComponent = component;
                        } else if (cb.type === 'tool_use') {
                            // defer yielding until we have the full input
                            blocks[idx] = {
                                id: cb.id,
                                name: cb.name,
                                partialJson: '',
                                component: null,
                                actionPart: { type: 'tool_use', id: cb.id, name: cb.name, input: {} }
                            };
                        }
                        break;
                    }

                    case 'content_block_delta': {
                        const idx = data.index;
                        const delta = data.delta;
                        const entry = blocks[idx];
                        if (!entry) break;

                        if (delta.type === 'text_delta') {
                            entry.component.content += delta.text;
                            entry.actionPart.text += delta.text;
                            yield { type: 'continue', content: delta.text, component: entry.component, meta: requestMeta };
                        } else if (delta.type === 'thinking_delta') {
                            entry.component.content += delta.thinking;
                            entry.actionPart.thinking += delta.thinking;
                            yield { type: 'continue', content: delta.thinking, component: entry.component, meta: requestMeta };
                        } else if (delta.type === 'signature_delta') {
                            entry.component.x.claude_signature = delta.signature;
                            entry.actionPart.signature = delta.signature;
                        } else if (delta.type === 'input_json_delta') {
                            entry.partialJson += delta.partial_json;
                        }
                        break;
                    }

                    case 'content_block_stop': {
                        const idx = data.index;
                        const entry = blocks[idx];
                        if (!entry) break;

                        if (entry.partialJson !== undefined) {
                            // tool_use block complete — parse input and yield
                            let input = {};
                            try { input = JSON.parse(entry.partialJson); } catch { input = {}; }
                            entry.actionPart.input = input;

                            const toolName = entry.name;

                            if (agent._actions[toolName]) {
                                // run as action immediately
                                const component = {
                                    type: 'action',
                                    name: toolName,
                                    action: input,
                                    x: { claude_tool_use_id: entry.id }
                                };
                                msg.components.push(component);
                                yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                                lastComponent = component;

                                const result = await agent._actions[toolName].call(input, context);
                                component.reaction = result.result;
                                component.reaction_attachments = result.attachments ?? [];
                                component.meta = result.meta;
                                yield { type: 'continue', reaction: result.result, component, meta: requestMeta };

                                actionParts.push(entry.actionPart);
                                reactionParts.push({
                                    type: 'tool_result',
                                    tool_use_id: entry.id,
                                    content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result ?? null)
                                });

                                hasAction = true;
                            } else {
                                // normal function call
                                const component = {
                                    type: 'function_call',
                                    name: toolName,
                                    arguments: input,
                                    x: { claude_tool_use_id: entry.id }
                                };
                                msg.components.push(component);
                                yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                                lastComponent = component;

                                actionParts.push(entry.actionPart);
                                reactionParts.push({
                                    type: 'tool_result',
                                    tool_use_id: entry.id,
                                    content: JSON.stringify(
                                        options.canceledResult ?? this.options.canceledResult
                                        ?? { status: 'EXECUTION_CANCELED', message: 'Please run this function again.' }
                                    )
                                });

                                hasUnhandledFunction = true;
                            }
                        } else if (entry.component && entry.actionPart) {
                            // text / thinking block complete
                            actionParts.push(entry.actionPart);
                        }
                        break;
                    }

                    case 'message_delta':
                        stopReason = data.delta?.stop_reason ?? stopReason;
                        requestMeta.outputTotal = data.usage?.output_tokens ?? requestMeta.outputTotal;
                        break;

                    case 'message_stop':
                        break;

                    case 'error':
                        throw new Error(`Claude stream error: ${JSON.stringify(data.error)}`);
                }
            }

            // inject assistant turn + reactions into next request
            if (actionParts.length > 0) _pushMessage(body.messages, 'assistant', actionParts);
            if (reactionParts.length > 0) _pushMessage(body.messages, 'user', reactionParts);

            // accumulate metadata
            meta.model = requestMeta.model || meta.model;
            meta.inputTotal += requestMeta.inputTotal;
            meta.outputTotal += requestMeta.outputTotal;
            meta.x = Object.assign(meta.x, requestMeta.x);

            // continue loop only when all tool uses were handled as actions
            if (stopReason === 'tool_use' && hasAction && !hasUnhandledFunction) continue;
            break;
        }

        if (msg.components.length > 0) conversation.conversation.push(msg);
        conversation.meta = meta;
        yield { type: 'end', conversation, meta };
        return conversation;
    }
}

// push message into messages array, merging consecutive same-role turns
function _pushMessage(messages, role, parts) {
    if (parts.length === 0) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
        // merge: Claude accepts arrays of content blocks
        if (!Array.isArray(last.content)) last.content = [{ type: 'text', text: last.content }];
        last.content.push(...parts);
    } else {
        messages.push({ role, content: parts });
    }
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = ClaudeModel;