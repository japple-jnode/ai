/*
@jnode/ai/openai-chat/model.js
v2

Simple AI API package for Node.js.

by Codex
*/

// dependencies
const path = require('path');
const AIAgent = require('./../agent.js');
const AIConversation = require('./../conversation.js');
const { request } = require('@jnode/request');

// openai chat completion model
class OAIChatModel {
    constructor(service, name, options = {}) {
        this.service = service;
        this.name = name;
        this.options = options;
        this._info = options.info;
    }

    async getInfo() {
        if (this._info) return this._info;

        this._info = {
            type: 'interactive',
            name: this.name,
            altNames: [],
            updated: null,
            released: null,
            description: 'OpenAI Chat Completions model.',
            features: {
                reasoning: true,
                multimodalCapabilities: [
                    'image/png',
                    'image/jpeg',
                    'image/webp',
                    'image/gif',
                    'audio/wav',
                    'audio/mp3',
                    'text/plain',
                    'application/pdf'
                ],
                actions: []
            },
            inputPrice: null,
            outputPrice: null,
            inputLimit: null,
            outputLimit: null,
            x: {
                provider: 'openai-chat'
            }
        };

        return this._info;
    }

    async _executePendingFunctions(agent, conversation, context) {
        if (conversation.last?.role !== 'model') return null;

        const funcs = [];
        for (let i of conversation.last.components) {
            if (i.type !== 'function_call') continue;

            const fn = agent._actions[i.name] ?? agent._functions[i.name];
            if (!fn) continue;

            funcs.push({
                name: i.name,
                func: fn,
                args: i.arguments,
                ctx: context,
                x: i.x ?? {}
            });
        }

        if (funcs.length === 0) return null;

        const msg = { role: 'system', components: [] };
        for (let i of funcs) {
            if (!i.func || typeof i.func.call !== 'function') {
                throw new Error(`Function "${i.name}" is not registered on this agent.`);
            }

            const res = await i.func.call(i.args, i.ctx);
            msg.components.push({
                type: 'function_response',
                name: i.name,
                result: res.result,
                attachments: res.attachments,
                meta: res.meta,
                x: i.x
            });
        }

        conversation.conversation.push(msg);
        return msg;
    }

    async _buildToolRegistry(agent) {
        const registry = {
            tools: [],
            byOriginalName: new Map(),
            byApiName: new Map()
        };

        const sources = [...agent.actions, ...agent.functions];
        for (let item of sources) {
            let info = item.getInfo();
            if (info instanceof Promise) info = await info;

            if (typeof info?.name !== 'string' || info.name.startsWith('@')) continue;

            if (registry.byOriginalName.has(info.name)) continue;

            const apiName = _toolApiName(info.name, registry.byApiName);
            const entry = { item, info, name: info.name, apiName };
            registry.byOriginalName.set(info.name, entry);
            registry.byApiName.set(apiName, entry);

            registry.tools.push({
                type: 'function',
                function: {
                    name: apiName,
                    description: info.description || 'Function.',
                    parameters: info.parameters || { type: 'object', properties: {} }
                }
            });
        }

        return registry;
    }

    async _buildBody(agent, conversation, context, options = {}) {
        const info = await this.getInfo();
        const toolRegistry = await this._buildToolRegistry(agent);
        const body = {
            model: this.name,
            messages: this._conversationToMessages(conversation.conversation, toolRegistry, info)
        };

        if (agent.temperature !== undefined) body.temperature = agent.temperature;
        if (agent.topP !== undefined) body.top_p = agent.topP;
        if (agent.seed !== undefined) body.seed = agent.seed;
        if (agent.stopStrings !== undefined) body.stop = agent.stopStrings;
        if (agent.frequencyPenalty !== undefined) body.frequency_penalty = agent.frequencyPenalty;
        if (agent.presencePenalty !== undefined) body.presence_penalty = agent.presencePenalty;
        if (agent.logprobs !== undefined) body.logprobs = agent.logprobs;
        if (agent.outputLimit !== undefined) body.max_completion_tokens = agent.outputLimit;

        if (agent.responseSchema) {
            body.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: _schemaName(agent.responseSchema),
                    schema: agent.responseSchema
                }
            };
        }

        if (toolRegistry.tools.length > 0) {
            body.tools = toolRegistry.tools;
            body.tool_choice = 'auto';
            body.parallel_tool_calls = true;
        }

        if (typeof agent.instructions === 'string' && agent.instructions.length > 0) {
            body.messages.unshift({
                role: 'system',
                content: [{ type: 'text', text: agent.instructions }]
            });
        }

        Object.assign(body, this.options.body ?? {});
        Object.assign(body, agent.x?.openaiChatBody ?? agent.x?.openai_chat_body ?? {});
        Object.assign(body, options.body ?? {});

        return { body, toolRegistry };
    }

    _conversationToMessages(conversation, toolRegistry, info) {
        const messages = [];
        const pendingToolCalls = new Map();

        for (let msg of conversation) {
            if (!msg || !Array.isArray(msg.components)) continue;

            if (msg.role === 'user') {
                const apiMsg = this._userMessageToApi(msg, info);
                if (apiMsg) messages.push(apiMsg);
                continue;
            }

            if (msg.role === 'model') {
                const converted = this._modelMessageToApi(msg, toolRegistry);
                if (converted.message) messages.push(converted.message);
                if (converted.pending.length > 0) {
                    for (let item of converted.pending) {
                        if (!pendingToolCalls.has(item.name)) pendingToolCalls.set(item.name, []);
                        pendingToolCalls.get(item.name).push(item);
                    }
                }
                if (converted.toolMessages.length > 0) messages.push(...converted.toolMessages);
                continue;
            }

            if (msg.role === 'system') {
                const converted = this._systemMessageToApi(msg, pendingToolCalls);
                if (converted.length > 0) messages.push(...converted);
            }
        }

        return messages;
    }

    _userMessageToApi(msg, info) {
        const content = [];

        for (let part of msg.components) {
            if (part.type === 'text' && part.content) {
                content.push({ type: 'text', text: part.content });
            } else if (part.type === 'file') {
                const mapped = _mapUserFilePart(part, info);
                if (mapped) content.push(mapped);
            }
        }

        if (content.length === 0) return null;
        return { role: 'user', content };
    }

    _modelMessageToApi(msg, toolRegistry) {
        const content = [];
        const toolCalls = [];
        const pending = [];
        const toolMessages = [];

        for (let part of msg.components) {
            switch (part.type) {
                case 'text':
                    if (part.content) content.push({ type: 'text', text: part.content });
                    break;
                case 'action':
                case 'function_call': {
                    const entry = toolRegistry.byOriginalName.get(part.name);
                    const apiName = entry?.apiName ?? _toolApiName(part.name);
                    const toolCallId = _componentToolCallId(part) ?? _fallbackToolCallId(apiName);
                    toolCalls.push({
                        id: toolCallId,
                        type: 'function',
                        function: {
                            name: apiName,
                            arguments: _stringifyArguments(part.action ?? part.arguments)
                        }
                    });
                    pending.push({ id: toolCallId, name: part.name, apiName });

                    if (part.type === 'action') {
                        toolMessages.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            content: _serializeToolResult(part.reaction)
                        });
                    }
                    break;
                }
            }
        }

        if (content.length === 0 && toolCalls.length === 0) {
            return { message: null, pending, toolMessages };
        }

        const message = { role: 'assistant' };
        if (content.length > 0) message.content = content;
        if (toolCalls.length > 0) message.tool_calls = toolCalls;

        return { message, pending, toolMessages };
    }

    _systemMessageToApi(msg, pendingToolCalls) {
        const messages = [];

        for (let part of msg.components) {
            if (part.type === 'function_response') {
                const explicitId = _componentToolCallId(part);
                const pending = pendingToolCalls.get(part.name)?.shift();
                const toolCallId = explicitId ?? pending?.id ?? _fallbackToolCallId(_toolApiName(part.name));

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    content: _serializeToolResult(part.result)
                });
            } else if (part.type === 'text' && part.content) {
                messages.push({
                    role: 'system',
                    content: [{ type: 'text', text: part.content }]
                });
            }
        }

        return messages;
    }

    async _request(body, options = {}) {
        const baseUrl = this.service?.baseUrl ?? 'https://api.openai.com/v1';
        const auth = options.auth ?? this.options.auth ?? this.service?.options?.auth ?? process.env.OPENAI_API_KEY;
        const headers = {
            'Content-Type': 'application/json'
        };

        if (auth) {
            headers['Authorization'] = auth.startsWith('Bearer ') || auth.startsWith('bearer ') ? auth : `Bearer ${auth}`;
        }

        const res = await request('POST', `${baseUrl}/chat/completions`, JSON.stringify(body), headers);
        if (res.statusCode !== 200) throw _requestError(res);
        return res;
    }

    async interact(agent, conversation, context, options = {}) {
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, agent);
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        const functionMsg = await this._executePendingFunctions(agent, conversation, context);
        if (functionMsg) return conversation;

        const { body, toolRegistry } = await this._buildBody(agent, conversation, context, options);

        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            const res = await this._request(body, options);
            const data = await res.json();
            const choice = data.choices?.[0];
            if (!choice?.message) break;

            _updateMeta(meta, data, choice);

            let ends = true;
            const actionMsg = { role: 'assistant' };
            const reactionMessages = [];
            const actionContent = [];
            const actionToolCalls = [];

            const message = choice.message;
            const text = _messageText(message);
            if (text) {
                const component = { type: 'text', content: text };
                msg.components.push(component);
                actionContent.push({ type: 'text', text });
            }

            const toolCalls = _extractToolCalls(message);
            for (let toolCall of toolCalls) {
                const originalName = toolRegistry.byApiName.get(toolCall.function.name)?.name ?? toolCall.function.name;
                const toolCallId = toolCall.id || _fallbackToolCallId(toolCall.function.name);
                const args = _parseArguments(toolCall.function.arguments);
                const x = _toolCallX(toolCallId);

                actionToolCalls.push({
                    id: toolCallId,
                    type: 'function',
                    function: {
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments ?? ''
                    }
                });

                if (agent._actions[originalName]) {
                    const result = await agent._actions[originalName].call(args, context);
                    msg.components.push({
                        type: 'action',
                        name: originalName,
                        action: args,
                        reaction: result.result,
                        reaction_attachments: result.attachments ?? [],
                        meta: result.meta,
                        x
                    });

                    reactionMessages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        content: _serializeToolResult(result.result)
                    });

                    ends = false;
                } else {
                    msg.components.push({
                        type: 'function_call',
                        name: originalName,
                        arguments: args,
                        x
                    });

                    reactionMessages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        content: _serializeToolResult(options.canceledResult ?? this.options.canceledResult ?? {
                            status: 'EXECUTION_CANCELED',
                            message: 'Please run this function again.'
                        })
                    });
                }
            }

            if (actionContent.length > 0 || actionToolCalls.length > 0) {
                if (actionContent.length > 0) actionMsg.content = actionContent;
                if (actionToolCalls.length > 0) actionMsg.tool_calls = actionToolCalls;
                body.messages.push(actionMsg);
            }

            if (reactionMessages.length > 0) body.messages.push(...reactionMessages);

            if (ends) break;
        }

        if (msg.components.length > 0) conversation.conversation.push(msg);
        conversation.meta = meta;
        return conversation;
    }

    async *streamInteract(agent, conversation, context, options = {}) {
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, agent);
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        const functionMsg = await this._executePendingFunctions(agent, conversation, context);
        if (functionMsg) {
            for (let component of functionMsg.components) {
                yield { type: 'component', component: component };
            }
            yield { type: 'end', conversation };
            return conversation;
        }

        const { body, toolRegistry } = await this._buildBody(agent, conversation, context, options);

        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            const res = await this._request({
                ...body,
                stream: true,
                stream_options: { include_usage: true }
            }, options);

            const sse = res.sse();
            const requestMeta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
            const currentToolCalls = [];
            const actionContent = [];
            const actionToolCalls = [];
            const reactionMessages = [];
            let last;
            let textComponent = null;
            let ends = true;

            for await (let event of sse) {
                if (!event?.data || event.data === '[DONE]') break;

                const data = JSON.parse(event.data);
                const choice = data.choices?.[0];
                _updateMeta(requestMeta, data, choice);

                const delta = choice?.delta ?? {};

                if (delta.content) {
                    if (!textComponent) {
                        textComponent = { type: 'text', content: delta.content };
                        msg.components.push(textComponent);
                        actionContent.push({ type: 'text', text: textComponent.content });
                        yield { type: 'component', component: textComponent, last: last, meta: requestMeta };
                        last = textComponent;
                    } else {
                        textComponent.content += delta.content;
                        actionContent[actionContent.length - 1].text = textComponent.content;
                        yield { type: 'continue', content: delta.content, component: textComponent, meta: requestMeta };
                    }
                }

                if (delta.refusal) {
                    if (!textComponent) {
                        textComponent = { type: 'text', content: delta.refusal };
                        msg.components.push(textComponent);
                        actionContent.push({ type: 'text', text: textComponent.content });
                        yield { type: 'component', component: textComponent, last: last, meta: requestMeta };
                        last = textComponent;
                    } else {
                        textComponent.content += delta.refusal;
                        actionContent[actionContent.length - 1].text = textComponent.content;
                        yield { type: 'continue', content: delta.refusal, component: textComponent, meta: requestMeta };
                    }
                }

                for (let toolCallDelta of delta.tool_calls ?? []) {
                    const index = toolCallDelta.index ?? 0;
                    if (!currentToolCalls[index]) {
                        currentToolCalls[index] = {
                            id: '',
                            type: 'function',
                            function: {
                                name: '',
                                arguments: ''
                            }
                        };
                    }

                    if (toolCallDelta.id) currentToolCalls[index].id = toolCallDelta.id;
                    if (toolCallDelta.type) currentToolCalls[index].type = toolCallDelta.type;
                    if (toolCallDelta.function?.name) currentToolCalls[index].function.name += toolCallDelta.function.name;
                    if (toolCallDelta.function?.arguments) currentToolCalls[index].function.arguments += toolCallDelta.function.arguments;
                }
            }

            for (let toolCall of currentToolCalls) {
                if (!toolCall?.function?.name) continue;

                const originalName = toolRegistry.byApiName.get(toolCall.function.name)?.name ?? toolCall.function.name;
                const toolCallId = toolCall.id || _fallbackToolCallId(toolCall.function.name);
                const args = _parseArguments(toolCall.function.arguments);
                const x = _toolCallX(toolCallId);

                actionToolCalls.push({
                    id: toolCallId,
                    type: 'function',
                    function: {
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments ?? ''
                    }
                });

                if (agent._actions[originalName]) {
                    const result = await agent._actions[originalName].call(args, context);
                    const component = {
                        type: 'action',
                        name: originalName,
                        action: args,
                        reaction: result.result,
                        reaction_attachments: result.attachments ?? [],
                        meta: result.meta,
                        x
                    };
                    msg.components.push(component);
                    yield { type: 'component', component: component, last: last, meta: requestMeta };
                    last = component;

                    reactionMessages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        content: _serializeToolResult(result.result)
                    });

                    ends = false;
                } else {
                    const component = {
                        type: 'function_call',
                        name: originalName,
                        arguments: args,
                        x
                    };
                    msg.components.push(component);
                    yield { type: 'component', component: component, last: last, meta: requestMeta };
                    last = component;

                    reactionMessages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        content: _serializeToolResult(options.canceledResult ?? this.options.canceledResult ?? {
                            status: 'EXECUTION_CANCELED',
                            message: 'Please run this function again.'
                        })
                    });
                }
            }

            if (actionContent.length > 0 || actionToolCalls.length > 0) {
                const actionMsg = { role: 'assistant' };
                if (actionContent.length > 0) actionMsg.content = actionContent;
                if (actionToolCalls.length > 0) actionMsg.tool_calls = actionToolCalls;
                body.messages.push(actionMsg);
            }

            if (reactionMessages.length > 0) body.messages.push(...reactionMessages);

            meta.model = requestMeta.model;
            meta.inputTotal += requestMeta.inputTotal;
            meta.outputTotal += requestMeta.outputTotal;
            meta.price += requestMeta.price;
            meta.x = Object.assign(meta.x, requestMeta.x);

            if (ends) break;
        }

        if (msg.components.length > 0) conversation.conversation.push(msg);
        conversation.meta = meta;
        yield { type: 'end', conversation, meta };
        return conversation;
    }
}


function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = OAIChatModel;
