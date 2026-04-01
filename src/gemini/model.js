/*
@jnode/ai/gemini/model.js
v2

Simple AI API package for Node.js.

by Gemini (I'm not sure if they all works fine, but seems everything is correct. - from JA)
*/

// dependencies
const AIAgent = require('./../agent.js');
const AIConversation = require('./../conversation.js');
const { request } = require('@jnode/request');

// gemini model
class GeminiModel {
    constructor(service, name, options = {}) {
        if (typeof service === 'string') {
            options = name || {};
            name = service;
            service = null;
        }
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
            description: 'Gemini model.',
            features: {
                reasoning: true,
                multimodalCapabilities: [
                    'image/png',
                    'image/jpeg',
                    'image/webp',
                    'image/heic',
                    'image/heif',
                    'video/mp4',
                    'video/mpeg',
                    'video/mov',
                    'video/avi',
                    'video/x-flv',
                    'video/mpg',
                    'video/webm',
                    'video/wmv',
                    'video/3gpp',
                    'audio/wav',
                    'audio/mp3',
                    'audio/aiff',
                    'audio/aac',
                    'audio/ogg',
                    'audio/flac',
                    'text/plain',
                    'text/html',
                    'text/css',
                    'text/javascript',
                    'application/x-javascript',
                    'text/x-typescript',
                    'application/x-typescript',
                    'text/csv',
                    'text/markdown',
                    'text/x-python',
                    'application/x-python-code',
                    'application/json',
                    'text/xml',
                    'application/rtf',
                    'text/rtf',
                    'application/pdf'
                ],
                actions: ['@googleSearch', '@codeExecution']
            },
            inputPrice: null,
            outputPrice: null,
            inputLimit: null,
            outputLimit: null,
            x: {
                provider: 'gemini'
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
        body.contents = this._conversationToContents(conversation.conversation, agent, toolRegistry);

        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            const data = await this._request(body, options);

            const candidate = data.candidates?.[0];
            const content = candidate?.content;
            if (!content && !candidate) break;

            meta.model = data.modelVersion ?? meta.model;
            meta.inputTotal += data.usageMetadata?.promptTokenCount ?? 0;
            meta.outputTotal += data.usageMetadata?.candidatesTokenCount ?? 0;
            meta.x = Object.assign(meta.x, {
                finishReason: candidate?.finishReason,
                safetyRatings: candidate?.safetyRatings,
                usageMetadata: data.usageMetadata
            });

            let ends = true;
            const actionMsg = { role: 'model', parts: [] };
            const reactionMsg = { role: 'user', parts: [] };

            if (content?.parts) {
                for (let part of content.parts) {
                    actionMsg.parts.push(part);

                    if (part.text) {
                        msg.components.push({ type: 'text', content: part.text });
                    }

                    if (part.executable_code) {
                        msg.components.push({
                            type: 'thought',
                            content: `Code Execution: \n\`\`\`${part.executable_code.language}\n${part.executable_code.code}\n\`\`\``,
                            x: { executable_code: part.executable_code }
                        });
                    }

                    if (part.code_execution_result) {
                        msg.components.push({
                            type: 'thought',
                            content: `Result: ${part.code_execution_result.outcome}\n${part.code_execution_result.output}`,
                            x: { code_execution_result: part.code_execution_result }
                        });
                    }

                    if (part.function_call) {
                        const call = part.function_call;
                        const originalName = toolRegistry.byApiName.get(call.name)?.name ?? call.name;
                        const args = typeof call.args === 'string' ? _parseToolArguments(call.args) : call.args;

                        const action = agent._actions[originalName];
                        if (action) {
                            const result = await action.call(args, context);
                            msg.components.push({
                                type: 'action',
                                name: originalName,
                                action: args,
                                reaction: result.result,
                                meta: result.meta
                            });

                            reactionMsg.parts.push({
                                function_response: {
                                    name: call.name,
                                    response: _formatFunctionResponse(result.result)
                                }
                            });
                            ends = false;
                        } else {
                            msg.components.push({
                                type: 'function_call',
                                name: originalName,
                                arguments: args
                            });
                        }
                    }
                }
            }

            if (actionMsg.parts.length > 0) {
                body.contents.push(actionMsg);
            }
            if (reactionMsg.parts.length > 0) {
                body.contents.push(reactionMsg);
            }

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

            if (info.name.startsWith('@')) continue;

            const apiName = _toolApiName(info.name, registry.byApiName);
            registry.byApiName.set(apiName, {
                name: info.name,
                apiName,
                item,
                info
            });

            registry.tools.push({
                name: apiName,
                description: info.description || 'Function',
                parameters: info.parameters || { type: 'object', properties: {} }
            });
        }

        return registry;
    }

    _buildRequestBody(agent, options, toolRegistry) {
        const body = {};

        const generationConfig = {};
        if (agent.temperature !== undefined) generationConfig.temperature = agent.temperature;
        if (agent.topP !== undefined) generationConfig.topP = agent.topP;
        if (agent.topK !== undefined) generationConfig.topK = agent.topK;
        if (agent.seed !== undefined) generationConfig.seed = agent.seed;
        if (agent.outputLimit !== undefined) generationConfig.maxOutputTokens = agent.outputLimit;
        if (agent.stopStrings !== undefined) generationConfig.stopSequences = agent.stopStrings;
        if (agent.presencePenalty !== undefined) generationConfig.presencePenalty = agent.presencePenalty;
        if (agent.frequencyPenalty !== undefined) generationConfig.frequencyPenalty = agent.frequencyPenalty;

        if (agent.responseSchema) {
            generationConfig.responseMimeType = 'application/json';
            generationConfig.responseSchema = _mapResponseSchema(agent.responseSchema);
        }

        const thinkingConfig = _mapThinkingConfig(agent.thinkingLevel);
        if (thinkingConfig) {
            generationConfig.thinkingConfig = thinkingConfig;
        }

        if (agent.instructions) {
            body.systemInstruction = {
                parts: [{ text: agent.instructions }]
            };
        }

        const tools = [];
        let functionDeclarations = [];

        for (let t of toolRegistry.tools) {
            functionDeclarations.push(t);
        }

        if (functionDeclarations.length > 0) {
            tools.push({ functionDeclarations });
        }

        if (agent._actions['@googleSearch']) {
            tools.push({ googleSearch: {} });
        }
        if (agent._actions['@codeExecution']) {
            tools.push({ codeExecution: {} });
        }

        if (tools.length > 0) {
            body.tools = tools;
            body.toolConfig = options.toolConfig ?? this.options.toolConfig;
        }

        Object.assign(body, this.options.x?.request ?? {}, agent.x?.request ?? {}, options.x?.request ?? {});
        return body;
    }

    _conversationToContents(conversation, agent, toolRegistry) {
        const contents = [];
        let currentRole = null;
        let currentParts = [];

        const pushContent = () => {
            if (currentParts.length > 0) {
                contents.push({
                    role: currentRole,
                    parts: currentParts
                });
                currentParts = [];
            }
        };

        for (let msg of conversation) {
            let role = msg.role === 'model' ? 'model' : 'user';

            if (currentRole !== role && currentParts.length > 0) {
                pushContent();
            }
            currentRole = role;

            for (let part of msg.components) {
                if (part.type === 'text' || part.type === 'thought') {
                    if (part.content) currentParts.push({ text: part.content });
                    continue;
                }

                if (part.type === 'file') {
                    const mapped = _mapUserFilePart(part);
                    if (mapped) currentParts.push(mapped);
                    continue;
                }

                if (part.type === 'function_call') {
                    const apiName = [...toolRegistry.byApiName.values()].find((i) => i.name === part.name)?.apiName ?? part.name;
                    currentParts.push({
                        function_call: {
                            name: apiName,
                            args: part.arguments || {}
                        }
                    });
                    continue;
                }

                if (part.type === 'action') {
                    const apiName = [...toolRegistry.byApiName.values()].find((i) => i.name === part.name)?.apiName ?? part.name;
                    currentParts.push({
                        function_call: {
                            name: apiName,
                            args: part.action || {}
                        }
                    });
                    pushContent();

                    contents.push({
                        role: 'user',
                        parts: [{
                            function_response: {
                                name: apiName,
                                response: _formatFunctionResponse(part.reaction)
                            }
                        }]
                    });
                    continue;
                }

                if (part.type === 'function_response') {
                    const apiName = [...toolRegistry.byApiName.values()].find((i) => i.name === part.name)?.apiName ?? part.name;
                    currentParts.push({
                        function_response: {
                            name: apiName,
                            response: _formatFunctionResponse(part.result)
                        }
                    });
                    continue;
                }
            }
        }

        pushContent();

        const mergedContents = [];
        for (let content of contents) {
            if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === content.role) {
                mergedContents[mergedContents.length - 1].parts.push(...content.parts);
            } else {
                mergedContents.push(content);
            }
        }

        return mergedContents;
    }

    async _request(body, options = {}) {
        let authHeader = options.auth ?? this.options.auth ?? this.service?.options?.auth;
        let apiKey = authHeader;

        let url = `${this.service?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'}/models/${encodeURIComponent(this.name)}:generateContent`;

        const headers = {
            'Content-Type': 'application/json'
        };

        if (apiKey) {
            if (apiKey.startsWith('Bearer ')) apiKey = apiKey.slice(7);
            headers['x-goog-api-key'] = apiKey;
        } else if (process.env.GEMINI_API_KEY) {
            headers['x-goog-api-key'] = process.env.GEMINI_API_KEY;
        }

        const res = await request('POST', url, JSON.stringify(body), headers);

        if (res.statusCode !== 200) throw _requestError(res);
        return await res.json();
    }
}

function _mapThinkingConfig(level) {
    if (typeof level === 'number') return { thinkingBudget: level };
    if (level === 'low') return { thinkingLevel: 'LOW' };
    if (level === 'medium') return { thinkingLevel: 'MEDIUM' };
    if (level === 'high') return { thinkingLevel: 'HIGH' };
    if (level === 'none') return { thinkingLevel: 'MINIMAL' };
    return null;
}

function _mapResponseSchema(schema) {
    if (schema.type && schema.type !== 'json_schema') return schema;
    if (schema.json_schema?.schema) return schema.json_schema.schema;
    return schema;
}

function _mapUserFilePart(part) {
    const mediaType = part.mediaType ?? part.media_type;
    const data = Buffer.isBuffer(part.data) ? part.data.toString('base64') : part.data;

    if (part.uri && part.uri.startsWith('https://generativelanguage.googleapis.com/')) {
        return {
            file_data: {
                mime_type: mediaType,
                file_uri: part.uri
            }
        };
    } else if (data) {
        return {
            inline_data: {
                mime_type: mediaType,
                data: data
            }
        };
    }
    return null;
}

function _toolApiName(name, registry = new Map()) {
    let base = String(name ?? 'tool')
        .replace(/^@+/, 'action_')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || 'tool';

    if (/^[0-9-]/.test(base)) base = 'fn_' + base;

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

function _formatFunctionResponse(res) {
    if (typeof res === 'object' && res !== null && !Array.isArray(res)) return res;
    return { result: res ?? null };
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = GeminiModel;
