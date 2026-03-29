/*
@jnode/ai/openai-chat/model.js
v2

Simple AI API package for Node.js.

by Codex (I'm not sure if they all works fine, but seems everything is correct. - from JA)
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

    async interact(agent, conversation, context, options = {}) {
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, agent);
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        if (conversation.last?.role === 'model') {
            const funcs = [];
            for (let i of conversation.last.components) {
                if (i.type !== 'function_call') continue;

                const fn = agent._actions[i.name] ?? agent._functions[i.name];
                if (!fn) continue;

                funcs.push({
                    name: i.name,
                    func: fn,
                    args: i.arguments,
                    ctx: context
                });
            }

            if (funcs.length > 0) {
                const msg = { role: 'system', components: [] };
                for (let i of funcs) {
                    const res = await i.func.call(i.args, i.ctx);
                    msg.components.push({
                        type: 'function_response',
                        name: i.name,
                        result: res.result,
                        meta: res.meta
                    });
                }
                conversation.conversation.push(msg);
                return conversation;
            }
        }

        const toolRegistry = await this._buildToolRegistry(agent);
        const body = this._buildRequestBody(agent, options, toolRegistry);
        body.messages = this._conversationToMessages(conversation.conversation, agent, toolRegistry);

        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            const data = await this._request(body, options);
            const choice = data.choices?.[0];
            const assistant = choice?.message;
            if (!assistant) break;

            meta.model = data.model ?? meta.model;
            meta.inputTotal += data.usage?.prompt_tokens ?? 0;
            meta.outputTotal += data.usage?.completion_tokens ?? 0;
            meta.x = Object.assign(meta.x, {
                id: data.id,
                object: data.object,
                created: data.created,
                serviceTier: data.service_tier,
                systemFingerprint: data.system_fingerprint,
                finishReason: choice.finish_reason,
                usage: data.usage
            });

            const actionMsg = this._assistantMessageToApi(assistant, toolRegistry);
            const reactionMsgs = [];
            let ends = true;

            if (assistant.content) {
                msg.components.push(...this._assistantContentToComponents(assistant.content));
            }

            if (assistant.refusal) {
                msg.components.push({
                    type: 'text',
                    content: assistant.refusal,
                    x: { refusal: true }
                });
            }

            if (assistant.audio) {
                msg.components.push({
                    type: 'file',
                    media_type: 'audio/wav',
                    data: assistant.audio.data,
                    x: {
                        openai: {
                            audio: assistant.audio
                        }
                    }
                });
            }

            if (Array.isArray(assistant.tool_calls)) {
                for (let call of assistant.tool_calls) {
                    if (call.type !== 'function' || !call.function?.name) continue;

                    const originalName = toolRegistry.byApiName.get(call.function.name)?.name ?? call.function.name;
                    const args = _parseToolArguments(call.function.arguments);
                    const action = agent._actions[originalName];
                    const fnComponent = {
                        type: 'function_call',
                        name: originalName,
                        arguments: args,
                        x: {
                            openai: {
                                toolCallId: call.id,
                                type: call.type
                            }
                        }
                    };

                    if (action) {
                        const result = await action.call(args, context);
                        msg.components.push({
                            type: 'action',
                            name: originalName,
                            action: args,
                            reaction: result.result,
                            meta: result.meta,
                            x: fnComponent.x
                        });

                        reactionMsgs.push({
                            role: 'tool',
                            tool_call_id: call.id,
                            content: _serializeToolResult(result.result)
                        });

                        ends = false;
                    } else {
                        msg.components.push(fnComponent);
                    }
                }
            } else if (assistant.function_call?.name) {
                const originalName = toolRegistry.byApiName.get(assistant.function_call.name)?.name ?? assistant.function_call.name;
                msg.components.push({
                    type: 'function_call',
                    name: originalName,
                    arguments: _parseToolArguments(assistant.function_call.arguments)
                });
            }

            if (actionMsg) body.messages.push(actionMsg);
            if (reactionMsgs.length > 0) body.messages.push(...reactionMsgs);
            if (ends) break;
        }

        if (msg.components.length > 0) {
            conversation.conversation.push(msg);
        }

        conversation.meta = meta;
        return conversation;
    }

    async _buildToolRegistry(agent) {
        const registry = {
            tools: [],
            byApiName: new Map()
        };

        const sources = [...agent.actions, ...agent.functions];
        for (let item of sources) {
            let info = item.getInfo();
            if (info instanceof Promise) info = await info;

            const apiName = _toolApiName(info.name, registry.byApiName);
            registry.byApiName.set(apiName, {
                name: info.name,
                apiName,
                item,
                info
            });

            registry.tools.push({
                type: 'function',
                function: {
                    name: apiName,
                    description: info.description,
                    parameters: info.parameters,
                    strict: info.x?.strict
                }
            });
        }

        return registry;
    }

    _buildRequestBody(agent, options, toolRegistry) {
        const body = {
            model: this.name
        };

        if (agent.temperature !== undefined) body.temperature = agent.temperature;
        if (agent.topP !== undefined) body.top_p = agent.topP;
        if (agent.seed !== undefined) body.seed = agent.seed;
        if (agent.outputLimit !== undefined) body.max_completion_tokens = agent.outputLimit;
        if (agent.stopStrings !== undefined) body.stop = agent.stopStrings;
        if (agent.logprobs !== undefined) body.logprobs = agent.logprobs;
        if (agent.frequencyPenalty !== undefined) body.frequency_penalty = agent.frequencyPenalty;
        if (agent.presencePenalty !== undefined) body.presence_penalty = agent.presencePenalty;

        const reasoningEffort = _mapThinkingLevel(agent.thinkingLevel);
        if (reasoningEffort) body.reasoning_effort = reasoningEffort;

        if (agent.responseSchema) body.response_format = _mapResponseSchema(agent.responseSchema);

        if (toolRegistry.tools.length > 0) {
            body.tools = toolRegistry.tools;
            body.tool_choice = options.toolChoice ?? this.options.toolChoice ?? 'auto';
            body.parallel_tool_calls = options.parallelToolCalls ?? this.options.parallelToolCalls ?? true;
        }

        Object.assign(body, this.options.x?.request ?? {}, agent.x?.request ?? {}, options.x?.request ?? {});
        return body;
    }

    _conversationToMessages(conversation, agent, toolRegistry) {
        const messages = [];
        const pendingToolCalls = [];

        if (agent.instructions) {
            messages.push({
                role: this.options.instructionsRole ?? 'developer',
                content: agent.instructions
            });
        }

        for (let msg of conversation) {
            if (msg.role === 'model') {
                const assistant = this._modelMessageToApi(msg, toolRegistry, pendingToolCalls);
                if (assistant) messages.push(assistant.message);
                if (assistant?.toolResponses?.length) messages.push(...assistant.toolResponses);
                continue;
            }

            if (msg.role === 'system') {
                const mapped = this._systemMessageToApi(msg, pendingToolCalls);
                if (mapped.length > 0) messages.push(...mapped);
                continue;
            }

            const userMessage = this._userMessageToApi(msg);
            if (userMessage) messages.push(userMessage);
        }

        return messages;
    }

    _userMessageToApi(msg) {
        const content = [];

        for (let part of msg.components) {
            if (part.type === 'text') {
                if (part.content) content.push({ type: 'text', text: part.content });
                continue;
            }

            if (part.type === 'file') {
                const mapped = _mapUserFilePart(part);
                if (mapped) content.push(mapped);
            }
        }

        if (content.length === 0) return null;
        return {
            role: 'user',
            content: (content.length === 1 && content[0].type === 'text') ? content[0].text : content
        };
    }

    _systemMessageToApi(msg, pendingToolCalls) {
        const messages = [];
        const systemTexts = [];

        for (let part of msg.components) {
            if (part.type === 'function_response') {
                const pending = pendingToolCalls.shift();
                if (!pending) continue;

                messages.push({
                    role: 'tool',
                    tool_call_id: pending.id,
                    content: _serializeToolResult(part.result)
                });
                continue;
            }

            if (part.type === 'text' && part.content) {
                systemTexts.push({ type: 'text', text: part.content });
            }
        }

        if (systemTexts.length > 0) {
            messages.unshift({
                role: 'system',
                content: (systemTexts.length === 1) ? systemTexts[0].text : systemTexts
            });
        }

        return messages;
    }

    _modelMessageToApi(msg, toolRegistry, pendingToolCalls) {
        const content = [];
        const toolCalls = [];
        const toolResponses = [];

        for (let part of msg.components) {
            if (part.type === 'text' || part.type === 'thought') {
                if (part.content) content.push({ type: 'text', text: part.content });
                continue;
            }

            if (part.type === 'action' || part.type === 'function_call') {
                const originalName = part.name;
                const apiName = [...toolRegistry.byApiName.values()].find((i) => i.name === originalName)?.apiName ?? _toolApiName(originalName);
                const toolCallId = part.x?.openai?.toolCallId ?? `call_${pendingToolCalls.length + toolCalls.length + 1}_${apiName}`;
                const args = (part.type === 'action') ? part.action : part.arguments;

                toolCalls.push({
                    id: toolCallId,
                    type: 'function',
                    function: {
                        name: apiName,
                        arguments: _stringifyArguments(args)
                    }
                });

                if (part.type === 'action') {
                    toolResponses.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        content: _serializeToolResult(part.reaction)
                    });
                } else {
                    pendingToolCalls.push({
                        id: toolCallId,
                        name: originalName
                    });
                }
            }
        }

        if (content.length === 0 && toolCalls.length === 0) return null;

        return {
            message: {
                role: 'assistant',
                content: (content.length === 0) ? null : ((content.length === 1) ? content[0].text : content),
                tool_calls: (toolCalls.length > 0) ? toolCalls : undefined
            },
            toolResponses
        };
    }

    _assistantMessageToApi(assistant, toolRegistry) {
        const content = [];

        if (assistant.content) {
            if (typeof assistant.content === 'string') {
                content.push({ type: 'text', text: assistant.content });
            } else if (Array.isArray(assistant.content)) {
                for (let part of assistant.content) {
                    if (part.type === 'text' && part.text) content.push(part);
                    else if (typeof part.text === 'string') content.push({ type: 'text', text: part.text });
                }
            }
        }

        const toolCalls = [];
        if (Array.isArray(assistant.tool_calls)) {
            for (let call of assistant.tool_calls) {
                if (call.type !== 'function' || !call.function?.name) continue;

                const originalName = toolRegistry.byApiName.get(call.function.name)?.name ?? call.function.name;
                toolCalls.push({
                    id: call.id,
                    type: 'function',
                    function: {
                        name: call.function.name,
                        arguments: call.function.arguments ?? '{}'
                    },
                    x: {
                        originalName
                    }
                });
            }
        }

        if (content.length === 0 && toolCalls.length === 0) return null;

        return {
            role: 'assistant',
            content: (content.length === 0) ? null : ((content.length === 1) ? content[0].text : content),
            tool_calls: (toolCalls.length > 0) ? toolCalls.map(({ x, ...call }) => call) : undefined
        };
    }

    _assistantContentToComponents(content) {
        if (typeof content === 'string') {
            return content ? [{ type: 'text', content }] : [];
        }

        if (!Array.isArray(content)) return [];

        const components = [];
        for (let part of content) {
            if (part.type === 'text' && part.text) {
                components.push({ type: 'text', content: part.text });
            } else if (part.type === 'refusal' && part.refusal) {
                components.push({ type: 'text', content: part.refusal, x: { refusal: true } });
            }
        }

        return components;
    }

    async _request(body, options = {}) {
        const res = await request('POST', `${this.service.baseUrl}/chat/completions`, JSON.stringify(body), {
            'Authorization': options.auth ?? this.options.auth,
            'Content-Type': 'application/json'
        });

        if (res.statusCode !== 200) throw _requestError(res);
        return await res.json();
    }
}

function _mapThinkingLevel(level) {
    if (!level) return null;

    switch (level) {
        case 'none':
            return 'none';
        case 'low':
            return 'low';
        case 'medium':
            return 'medium';
        case 'high':
            return 'high';
        default:
            return level;
    }
}

function _mapResponseSchema(schema) {
    if (schema.type) return schema;

    return {
        type: 'json_schema',
        json_schema: {
            name: schema.name ?? 'response',
            description: schema.description,
            schema: schema.schema ?? schema,
            strict: schema.strict
        }
    };
}

function _mapUserFilePart(part) {
    const mediaType = part.mediaType ?? part.media_type;
    const data = Buffer.isBuffer(part.data) ? part.data.toString('base64') : part.data;

    if (!mediaType) return null;

    if (mediaType.startsWith('image/')) {
        const url = part.uri ?? `data:${mediaType};base64,${data}`;
        return {
            type: 'image_url',
            image_url: {
                url,
                detail: part.detail ?? part.x?.detail
            }
        };
    }

    if (mediaType === 'audio/wav' || mediaType === 'audio/mp3') {
        return {
            type: 'input_audio',
            input_audio: {
                data,
                format: mediaType.endsWith('wav') ? 'wav' : 'mp3'
            }
        };
    }

    if (mediaType === 'text/plain' || mediaType === 'application/pdf') {
        return {
            type: 'file',
            file: {
                file_data: data,
                filename: part.filename ?? _filenameFromUri(part.uri)
            }
        };
    }

    return null;
}

function _filenameFromUri(uri) {
    if (!uri) return 'file';
    try {
        return path.basename(new URL(uri).pathname) || 'file';
    } catch {
        return path.basename(uri) || 'file';
    }
}

function _toolApiName(name, registry = new Map()) {
    const base = String(name ?? 'tool')
        .replace(/^@+/, 'action_')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || 'tool';

    let candidate = base;
    let index = 2;
    while (registry.has(candidate)) {
        const suffix = `_${index++}`;
        candidate = `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    }
    return candidate;
}

function _parseToolArguments(args) {
    if (typeof args !== 'string') return args ?? {};
    try {
        return JSON.parse(args);
    } catch {
        return args;
    }
}

function _stringifyArguments(args) {
    if (typeof args === 'string') return args;
    return JSON.stringify(args ?? {});
}

function _serializeToolResult(result) {
    if (typeof result === 'string') return result;
    if (result === undefined) return 'null';
    return JSON.stringify(result);
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = OAIChatModel;
