/*
@jnode/ai/gemini/model.js
v2

Simple AI API package for Node.js.

by JustApple (I used to use Gemini to generate these, but it's code is stupid)
*/

// dependencies
const AIAgent = require('./../agent.js');
const AIConversation = require('./../conversation.js');
const { request } = require('@jnode/request');

// constants
const THINKING_LEVELS = {
    low: 'LOW',
    medium: 'MEDIUM',
    high: 'HIGH',
    none: 'MINIMAL'
};
const CONTENT_ROLE = {
    user: 'user',
    model: 'model',
    system: 'user'
};

// gemini model
class GeminiModel {
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
                actions: ['@google_search', '@code_execution', '@url_context', '@google_maps']
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

        // get info
        const info = await this.getInfo();

        // generate request body
        const body = {
            generationConfig: {}
        };

        // basic config
        body.generationConfig.temperature = agent.temperature;
        body.generationConfig.topP = agent.topP;
        body.generationConfig.topK = agent.topK;
        body.generationConfig.seed = agent.seed;
        body.generationConfig.maxOutputTokens = agent.outputLimit;
        body.generationConfig.stopSequences = agent.stopStrings;
        body.generationConfig.presencePenalty = agent.presencePenalty;
        body.generationConfig.frequencyPenalty = agent.frequencyPenalty;
        body.generationConfig.thinkingConfig = { thinkingLevel: THINKING_LEVELS[agent.thinkingLevel] };
        body.generationConfig.responseMimeType = agent.responseSchema ? 'application/json' : 'text/plain';
        body.generationConfig.responseJsonSchema = agent.responseSchema;
        Object.assign(body.generationConfig, agent.x['gemini_generationConfig']); // assign generation config

        // instructions
        body.systemInstruction = agent.instructions && { parts: [{ text: agent.instructions }] };

        // actions and functions
        const functions = [];
        body.tools = [];

        for (let i of agent.actions) {
            let fnInfo = i.getInfo();
            if (fnInfo instanceof Promise) fnInfo = await fnInfo;

            // native actions
            if (fnInfo.name.startsWith('@') && info.features.actions.includes(fnInfo.name)) {
                switch (fnInfo.name) {
                    case '@google_search':
                        body.tools.push({ googleSearch: fnInfo.config ?? {} });
                        break;
                    case '@code_execution':
                        body.tools.push({ codeExecution: fnInfo.config ?? {} });
                        break;
                    case '@url_context':
                        body.tools.push({ urlContext: fnInfo.config ?? {} });
                        break;
                    case '@google_maps':
                        body.tools.push({ googleMaps: fnInfo.config ?? {} });
                        break;
                }
            } else if (fnInfo.name.startsWith('@')) continue; // unsupported native action, skip
            else functions.push(fnInfo);
        }

        for (let i of agent.functions) {
            let fnInfo = i.getInfo();
            if (fnInfo instanceof Promise) fnInfo = await fnInfo;
            functions.push(fnInfo);
        }

        if (functions.length > 0) body.tools.push({ functionDeclarations: functions });

        // build conversation
        body.contents = [];
        const conv = conversation.conversation;
        for (let i = 0; i < conv.length; i++) {
            let content = (body.contents[body.contents.length - 1]?.role === CONTENT_ROLE[conv[i].role]) ?
                body.contents.pop() :
                { role: CONTENT_ROLE[conv[i].role], parts: [] }; // new message if different role

            for (let j of conv[i].components) {
                switch (j.type) {
                    case 'text':
                        content.parts.push({ text: j.content, thoughtSignature: j.x?.gemini_thoughtSignature });
                        break;
                    case 'file':
                        const mediaType = j.mediaType ?? j.media_type;
                        if (!info.features.multimodalCapabilities.includes(mediaType)) {
                            if (mediaType === 'text/plain') content.parts.push({ text: j.data.toString() });
                            continue;
                        }

                        if (j.uri) { // uri data
                            content.parts.push({
                                fileData: {
                                    mimeType: mediaType,
                                    fileUri: j.uri
                                }
                            });
                        } else if (j.data) { // inline data
                            content.parts.push({
                                inlineData: {
                                    mimeType: mediaType,
                                    data: Buffer.isBuffer(j.data) ? j.data.toString('base64') : j.data
                                }
                            });
                        }

                        break;
                    case 'action': // action component
                        if (typeof j.name === 'string' && j.name.startsWith('@')) {
                            if (j.name === '@executable_code') { // code execution action
                                content.parts.push({
                                    executableCode: j.action,
                                    thoughtSignature: j.x?.gemini_thoughtSignature
                                });

                                content.parts.push({
                                    codeExecutionResult: j.reaction,
                                    thoughtSignature: j.x?.gemini_thoughtSignature
                                });
                            } else continue;
                        } else { // function like action
                            content.parts.push({ functionCall: { name: j.name, args: j.action } });
                            body.contents.push(content);

                            content = { role: 'user', parts: [] }; // new user content for function response
                            content.parts.push({
                                functionResponse: {
                                    name: j.name, response: j.reaction,
                                    parts: (j.attachments ?? []).map(e => ({
                                        inlineData: {
                                            mimeType: e.media_type,
                                            data: Buffer.isBuffer(e.data) ? e.data.toString('base64') : e.data
                                        }
                                    })),
                                    ...j.x?.gemini_functionResponse
                                }
                            });
                            body.contents.push(content);

                            content = { role: 'model', parts: [] }; // new content for next components
                        }
                        break;
                    case 'function_call': // function call component
                        content.parts.push({ functionCall: { name: j.name, args: j.arguments }, thoughtSignature: j.x?.gemini_thoughtSignature ?? 'skip_thought_signature_validator' });
                        break;
                    case 'function_response': // function response component
                        content.parts.push({
                            functionResponse: {
                                name: j.name, response: j.result,
                                parts: (j.attachments ?? []).map(e => ({
                                    inlineData: {
                                        mimeType: e.media_type,
                                        data: Buffer.isBuffer(e.data) ? e.data.toString('base64') : e.data
                                    }
                                })),
                                ...j.x?.gemini_functionResponse
                            }
                        });
                        break;
                    case 'thought': // thought component
                        content.parts.push({ thought: true, text: j.content, thoughtSignature: j.x?.gemini_thoughtSignature });
                        break;
                }
            }

            if (content.parts.length > 0) body.contents.push(content);
        }

        // addition fields
        Object.assign(body, agent.x['gemini_body']);

        // start response
        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            const res = await request('POST', `${this.service.baseUrl}/models/${encodeURIComponent(this.name)}:generateContent`, JSON.stringify(body), {
                'x-goog-api-key': options.auth ?? this.options.auth,
                'Content-Type': 'application/json'
            });

            if (res.statusCode !== 200) throw _requestError(res);

            const data = await res.json();

            // update metadata
            meta.model = data.modelVersion;
            meta.inputTotal += data.usageMetadata?.promptTokenCount;
            meta.outputTotal += data.usageMetadata?.candidatesTokenCount;
            meta.price += data.usageMetadata?.totalTokenCount; // do not use this field

            // push conversation
            let ends = true;
            const candidate = data.candidates?.[0];
            if (candidate?.content) {
                const actionContent = { role: 'model', parts: [] };
                const reactionContent = { role: 'user', parts: [] };

                for (let j of candidate.content.parts) {
                    if (j.text) { // text or thought component
                        msg.components.push({
                            type: j.thought ? 'thought' : 'text',
                            content: j.text,
                            x: { gemini_thoughtSignature: j.thoughtSignature }
                        });
                        actionContent.parts.push(j);
                    } else if (j.inlineData) { // inline file data
                        msg.components.push({
                            type: 'file',
                            mediaType: j.inlineData.mimeType,
                            data: j.inlineData.data
                        });
                        actionContent.parts.push(j);
                    } else if (j.fileData) { // file uri data
                        msg.components.push({
                            type: 'file',
                            mediaType: j.fileData.mimeType,
                            uri: j.fileData.fileUri
                        });
                        actionContent.parts.push(j);
                    } else if (j.functionCall) {
                        if (agent._actions[j.functionCall.name]) { // run as action
                            const result = await agent._actions[j.functionCall.name].call(j.functionCall.args, context);

                            msg.components.push({
                                type: 'action',
                                name: j.functionCall.name,
                                action: j.functionCall.args,
                                reaction: result.result,
                                reaction_attachments: result.attachments ?? [],
                                meta: result.meta,
                                x: j.x ?? {}
                            });

                            actionContent.parts.push(j);
                            reactionContent.parts.push({
                                functionResponse: {
                                    name: j.functionCall.name,
                                    response: result.result,
                                    parts: (j.attachments ?? []).map(e => ({
                                        inlineData: {
                                            mimeType: e.media_type,
                                            data: Buffer.isBuffer(e.data) ? e.data.toString('base64') : e.data
                                        }
                                    })),
                                }
                            });

                            ends = false; // generate again after action executed
                        } else { // normal function call
                            msg.components.push({
                                type: 'function_call',
                                name: j.functionCall.name,
                                arguments: j.functionCall.args,
                                x: {
                                    gemini_thoughtSignature: j.x?.gemini_thoughtSignature ?? 'skip_thought_signature_validator'
                                }
                            });
                            actionMsg.components.push(j);
                        }
                    } else if (j.functionResponse) { // function response
                        msg.components.push({
                            type: 'function_response',
                            name: j.functionResponse.name,
                            result: j.functionResponse.response,
                            attachments: (j.functionResponse.parts ?? []).map(e => ({
                                media_type: e.inlineData.mimeType,
                                data: e.inlineData.data
                            })),
                            x: j.x?.gemini_functionResponse
                        });
                        actionContent.parts.push(j);
                    } else if (j.executableCode) { // code execution
                        msg.components.push({
                            type: 'action',
                            name: '@executable_code',
                            action: j.executableCode,
                            x: { gemini_thoughtSignature: j.x?.gemini_thoughtSignature }
                        });
                        actionContent.parts.push(j);
                    } else if (j.codeExecutionResult) { // code execution result
                        msg.components[msg.components.length - 1].reaction = j.codeExecutionResult;
                        actionContent.parts.push(j);
                    }
                }
                if (actionContent.parts.length > 0) body.contents.push(actionContent);
                if (reactionContent.parts.length > 0) body.contents.push(reactionMsg);
            } else break;

            // ends
            if (ends) break;
        }

        // push to body
        if (msg.components.length > 0) {
            conversation.conversation.push(msg);
        }

        // set meta to conversation and return
        conversation.meta = meta;
        return conversation;
    }
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = GeminiModel;
