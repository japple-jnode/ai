/*
@jnode/ai/pollinations/model.js
v2

Simple AI API package for Node.js.

by Polly
*/

// dependencies
const AIAgent = require('./../agent.js');
const AIConversation = require('./../conversation.js');
const { request } = require('@jnode/request');

// pollinations model
class PollinationsModel {
    constructor(service, name, options = {}) {
        this.service = service;
        this.name = name;
        this.options = options;
        this._info = options.info;
    }

    async getInfo() {
        if (this._info) return this._info;

        // fetch from pollinations models endpoint
        const res = await request('GET', `${this.service.baseUrl} /v1/models`, null, {
            'Authorization': this.options.auth ? `Bearer ${this.options.auth} ` : undefined
        });

        if (res.statusCode !== 200) throw _requestError(res);

        const models = await res.json();
        const modelData = models.find(m => m.id === this.name || m.name === this.name);

        if (!modelData) {
            throw new Error(`Model "${this.name}" not found in Pollinations`);
        }

        this._info = {
            type: 'interactive',
            name: this.name,
            altNames: [],
            updated: null,
            released: null,
            description: modelData.description || `Pollinations ${this.name} `,
            features: {
                reasoning: modelData.supports_reasoning || false,
                multimodalCapabilities: modelData.supports_vision ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] : [],
                actions: [] // Pollinations doesn't have native actions like @code_execution
            },
            inputPrice: null,
            outputPrice: null,
            inputLimit: modelData.context_window,
            outputLimit: modelData.max_tokens,
            x: {
                provider: 'pollinations',
                ...modelData
            }
        };

        return this._info;
    }

    // build OpenAI-compatible request body
    async _buildBody(agent, conversation, context, options) {
        const body = {
            model: this.name,
            messages: []
        };

        // generation config
        if (agent.temperature !== undefined) body.temperature = agent.temperature;
        if (agent.topP !== undefined) body.top_p = agent.topP;
        if (agent.outputLimit !== undefined) body.max_tokens = agent.outputLimit;
        if (agent.stopStrings !== undefined) body.stop = agent.stopStrings;
        if (agent.presencePenalty !== undefined) body.presence_penalty = agent.presencePenalty;
        if (agent.frequencyPenalty !== undefined) body.frequency_penalty = agent.frequencyPenalty;
        if (agent.seed !== undefined) body.seed = agent.seed;

        // reasoning/thinking (for supported models like o3-mini, deepseek, etc.)
        if (agent.thinkingLevel && agent.thinkingLevel !== 'none') {
            const levelMap = { 'low': 'low', 'medium': 'medium', 'high': 'high' };
            if (levelMap[agent.thinkingLevel]) body.reasoning_effort = levelMap[agent.thinkingLevel];
        }

        // structured output
        if (agent.responseSchema) {
            body.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: 'json_response',
                    schema: agent.responseSchema,
                    strict: true
                }
            };
        }

        // system instructions
        if (agent.instructions) {
            body.messages.push({ role: 'system', content: agent.instructions });
        }

        // build messages from conversation components
        const conv = conversation.conversation;
        for (const turn of conv) {
            const role = turn.role === 'model' ? 'assistant' : turn.role;
            let content = '';
            const imageUrls = [];

            for (const comp of turn.components) {
                switch (comp.type) {
                    case 'text':
                        content += comp.content;
                        break;
                    case 'file': {
                        const mediaType = comp.mediaType || comp.media_type;
                        if (mediaType?.startsWith('image/')) {
                            // Pollinations supports image URLs or base64
                            const imageUrl = comp.uri || `data:${mediaType};base64,${comp.data}`;
                            imageUrls.push({ type: 'image_url', image_url: { url: imageUrl } });
                        } else if (mediaType === 'text/plain' && comp.data) {
                            content += comp.data.toString();
                        }
                        break;
                    }
                    case 'function_call': {
                        // tool_calls handled separately
                        break;
                    }
                    case 'function_response': {
                        // tool results handled separately
                        break;
                    }
                    // action/thought components don't map directly to OpenAI format
                }
            }

            // Build message content (text or multimodal array)
            if (imageUrls.length > 0) {
                body.messages.push({
                    role,
                    content: [
                        { type: 'text', text: content || ' ' },
                        ...imageUrls
                    ]
                });
            } else if (content) {
                body.messages.push({ role, content });
            }
        }

        // tools/functions - Pollinations supports OpenAI-style tool calling
        const tools = [];
        for (const action of agent.actions) {
            const info = await (action.getInfo instanceof Promise ? action.getInfo : Promise.resolve(action.getInfo()));
            if (!info.name.startsWith('@')) { // skip native actions
                tools.push({
                    type: 'function',
                    function: {
                        name: info.name,
                        description: info.description,
                        parameters: info.parameters || { type: 'object', properties: {} }
                    }
                });
            }
        }
        for (const fn of agent.functions) {
            const info = await (fn.getInfo instanceof Promise ? fn.getInfo : Promise.resolve(fn.getInfo()));
            tools.push({
                type: 'function',
                function: {
                    name: info.name,
                    description: info.description,
                    parameters: info.parameters || { type: 'object', properties: {} }
                }
            });
        }
        if (tools.length > 0) body.tools = tools;

        // tool_choice if specific function requested
        if (options.toolChoice) body.tool_choice = options.toolChoice;

        return body;
    }

    // interact - non-streaming
    async interact(agent, conversation, context, options = {}) {
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, agent);
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        // execute pending function calls if conversation ends with model turn
        if (conversation.last?.role === 'model') {
            const funcs = [];
            for (const comp of conversation.last.components) {
                if (comp.type === 'function_call') {
                    const fn = agent._functions[comp.name] || agent._actions[comp.name];
                    if (fn) funcs.push({ name: comp.name, func: fn, args: comp.arguments, ctx: context });
                }
            }
            if (funcs.length > 0) {
                const msg = { role: 'system', components: [] };
                for (const f of funcs) {
                    const res = await f.func.call(f.args, f.ctx);
                    msg.components.push({
                        type: 'function_response',
                        name: f.name,
                        result: res.result,
                        meta: res.meta
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

        for (let i = 0; i < maxActions; i++) {
            const auth = this.options.auth ? `Bearer ${this.options.auth}` : undefined;
            const res = await request('POST', `${this.service.baseUrl}/v1/chat/completions`, JSON.stringify(body), {
                'Authorization': auth,
                'Content-Type': 'application/json'
            });

            if (res.statusCode !== 200) throw _requestError(res);

            const data = await res.json();

            // update meta
            meta.model = data.model || this.name;
            meta.inputTotal += data.usage?.prompt_tokens || 0;
            meta.outputTotal += data.usage?.completion_tokens || 0;

            const choice = data.choices?.[0];
            if (!choice?.message) break;

            const message = choice.message;
            let ends = true;

            // text content
            if (message.content) {
                msg.components.push({ type: 'text', content: message.content });
            }

            // refusal
            if (message.refusal) {
                msg.components.push({ type: 'text', content: message.refusal, x: { refusal: true } });
            }

            // tool calls / function calls
            if (message.tool_calls?.length > 0) {
                for (const tc of message.tool_calls) {
                    if (tc.type === 'function') {
                        let args;
                        try { args = JSON.parse(tc.function.arguments); } catch { args = tc.function.arguments; }

                        if (agent._actions[tc.function.name]) {
                            // execute as action
                            const result = await agent._actions[tc.function.name].call(args, context);
                            msg.components.push({
                                type: 'action',
                                name: tc.function.name,
                                action: args,
                                reaction: result.result,
                                reaction_attachments: result.attachments || [],
                                meta: result.meta,
                                x: { tool_call_id: tc.id }
                            });

                            // add tool result for next iteration
                            body.messages.push({
                                role: 'assistant',
                                content: null,
                                tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } }]
                            });
                            body.messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
                            });

                            ends = false; // continue loop after action
                        } else {
                            // return as function_call to caller
                            msg.components.push({
                                type: 'function_call',
                                name: tc.function.name,
                                arguments: args,
                                x: { tool_call_id: tc.id }
                            });
                        }
                    }
                }
            }

            if (ends) break;
        }

        if (msg.components.length > 0) {
            conversation.conversation.push(msg);
        }
        conversation.meta = meta;
        return conversation;
    }

    // stream interact - async generator
    async *streamInteract(agent, conversation, context, options = {}) {
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, agent);
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        // execute pending function calls first
        if (conversation.last?.role === 'model') {
            const funcs = [];
            for (const comp of conversation.last.components) {
                if (comp.type === 'function_call' && (agent._functions[comp.name] || agent._actions[comp.name])) {
                    funcs.push({
                        name: comp.name,
                        func: agent._functions[comp.name] || agent._actions[comp.name],
                        args: comp.arguments,
                        ctx: context
                    });
                }
            }
            if (funcs.length > 0) {
                const msg = { role: 'system', components: [] };
                for (const f of funcs) {
                    const res = await f.func.call(f.args, f.ctx);
                    const component = {
                        type: 'function_response',
                        name: f.name,
                        result: res.result,
                        meta: res.meta
                    };
                    msg.components.push(component);
                    yield { type: 'component', component };
                }
                conversation.conversation.push(msg);
                yield { type: 'end', conversation };
                return;
            }
        }

        const body = await this._buildBody(agent, conversation, context, options);
        body.stream = true;
        body.stream_options = { include_usage: true };

        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            const auth = this.options.auth ? `Bearer ${this.options.auth}` : undefined;
            const res = await request('POST', `${this.service.baseUrl}/v1/chat/completions`, JSON.stringify(body), {
                'Authorization': auth,
                'Content-Type': 'application/json'
            });

            if (res.statusCode !== 200) throw _requestError(res);

            const sse = res.sse();
            const requestMeta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };

            let lastComponent = null;
            let activeToolCalls = {}; // index -> { id, name, args }
            let ends = true;

            for await (const event of sse) {
                if (!event.data || event.data === '[DONE]') continue;

                let data;
                try { data = JSON.parse(event.data); } catch { continue; }

                // update metadata
                if (data.model) requestMeta.model = data.model;
                if (data.usage) {
                    requestMeta.inputTotal = data.usage.prompt_tokens ?? requestMeta.inputTotal;
                    requestMeta.outputTotal = data.usage.completion_tokens ?? requestMeta.outputTotal;
                }

                const choice = data.choices?.[0];
                if (!choice?.delta) continue;

                const delta = choice.delta;

                // text content streaming
                if (delta.content != null) {
                    if (lastComponent && lastComponent.type === 'text') {
                        lastComponent.content += delta.content;
                        yield { type: 'continue', content: delta.content, component: lastComponent, meta: requestMeta };
                    } else {
                        const component = { type: 'text', content: delta.content };
                        msg.components.push(component);
                        yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                        lastComponent = component;
                    }
                }

                // refusal
                if (delta.refusal != null) {
                    if (lastComponent && lastComponent.type === 'text' && lastComponent.x?.refusal) {
                        lastComponent.content += delta.refusal;
                        yield { type: 'continue', content: delta.refusal, component: lastComponent, meta: requestMeta };
                    } else {
                        const component = { type: 'text', content: delta.refusal, x: { refusal: true } };
                        msg.components.push(component);
                        yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                        lastComponent = component;
                    }
                }

                // tool calls (accumulate)
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        if (data.usage) {
                            requestMeta.inputTotal = data.usage.prompt_tokens ?? requestMeta.inputTotal;
                            requestMeta.outputTotal = data.usage.completion_tokens ?? requestMeta.outputTotal;
                        }

                        const choice = data.choices?.[0];
                        if (!choice?.delta) continue;

                        const delta = choice.delta;

                        // text content streaming
                        if (delta.content != null) {
                            if (lastComponent && lastComponent.type === 'text') {
                                lastComponent.content += delta.content;
                                yield { type: 'continue', content: delta.content, component: lastComponent, meta: requestMeta };
                            } else {
                                const component = { type: 'text', content: delta.content };
                                msg.components.push(component);
                                yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                                lastComponent = component;
                            }
                        }

                        // refusal
                        if (delta.refusal != null) {
                            if (lastComponent && lastComponent.type === 'text' && lastComponent.x?.refusal) {
                                lastComponent.content += delta.refusal;
                                yield { type: 'continue', content: delta.refusal, component: lastComponent, meta: requestMeta };
                            } else {
                                const component = { type: 'text', content: delta.refusal, x: { refusal: true } };
                                msg.components.push(component);
                                yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                                lastComponent = component;
                            }
                        }

                        // tool calls (accumulate)
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (!activeToolCalls[tc.index]) {
                                    activeToolCalls[tc.index] = {
                                        id: tc.id,
                                        name: tc.function?.name || '',
                                        arguments: tc.function?.arguments || ''
                                    };
                                } else {
                                    if (tc.id) activeToolCalls[tc.index].id = tc.id;
                                    if (tc.function?.name) activeToolCalls[tc.index].name += tc.function.name;
                                    if (tc.function?.arguments) activeToolCalls[tc.index].arguments += tc.function.arguments;
                                }
                            }
                        }

                        // finish reason
                        if (choice.finish_reason === 'tool_calls') {
                            // process accumulated tool calls
                            const toolCalls = Object.keys(activeToolCalls)
                                .sort((a, b) => Number(a) - Number(b))
                                .map(k => activeToolCalls[k]);

                            for (const tc of toolCalls) {
                                let args;
                                try { args = JSON.parse(tc.arguments); } catch { args = tc.arguments; }

                                if (agent._actions[tc.name]) {
                                    // yield action component
                                    const component = {
                                        type: 'action',
                                        name: tc.name,
                                        action: args,
                                        x: { tool_call_id: tc.id }
                                    };
                                    msg.components.push(component);
                                    yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                                    lastComponent = component;

                                    // execute action
                                    const result = await agent._actions[tc.name].call(args, context);
                                    component.reaction = result.result;
                                    component.reaction_attachments = result.attachments || [];
                                    component.meta = result.meta;

                                    yield { type: 'continue', reaction: result.result, component, meta: requestMeta };

                                    // add to conversation for next iteration
                                    body.messages.push({
                                        role: 'assistant',
                                        content: null,
                                        tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }]
                                    });
                                    body.messages.push({
                                        role: 'tool',
                                        tool_call_id: tc.id,
                                        content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
                                    });

                                    ends = false;
                                } else {
                                    // function call to caller
                                    const component = {
                                        type: 'function_call',
                                        name: tc.name,
                                        arguments: args,
                                        x: { tool_call_id: tc.id }
                                    };
                                    msg.components.push(component);
                                    yield { type: 'component', component, last: lastComponent, meta: requestMeta };
                                    lastComponent = component;
                                }
                            }
                            activeToolCalls = {};
                        }
                    }

                    // accumulate metadata
                    meta.model = requestMeta.model || meta.model;
                    meta.inputTotal += requestMeta.inputTotal;
                    meta.outputTotal += requestMeta.outputTotal;
                    meta.x = Object.assign(meta.x, requestMeta.x);

                    if (ends) break;
                }

                if (msg.components.length > 0) {
                    conversation.conversation.push(msg);
                }
                conversation.meta = meta;
                yield { type: 'end', conversation, meta };
            }
        }
    }
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

module.exports = PollinationsModel;
