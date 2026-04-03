/*
@jnode/ai/openai-chat/model.js
v2

Simple AI API package for Node.js.

by Gemini (base methods)
   Codex  (syntax fix)
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

    // build body
    async _buildBody(agent, conversation, context, options) {
        const body = {
            model: this.name,
            messages: []
        };

        if (agent.temperature !== undefined) body.temperature = agent.temperature;
        if (agent.topP !== undefined) body.top_p = agent.topP;
        if (agent.outputLimit !== undefined) body.max_completion_tokens = agent.outputLimit;
        if (agent.stopStrings !== undefined) body.stop = agent.stopStrings;
        if (agent.presencePenalty !== undefined) body.presence_penalty = agent.presencePenalty;
        if (agent.frequencyPenalty !== undefined) body.frequency_penalty = agent.frequencyPenalty;
        if (agent.seed !== undefined) body.seed = agent.seed;

        if (agent.thinkingLevel !== undefined) {
            const levelMap = { 'low': 'low', 'medium': 'medium', 'high': 'high' };
            if (levelMap[agent.thinkingLevel]) body.reasoning_effort = levelMap[agent.thinkingLevel];
        }

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

        const tools = [];
        for (let i of agent.actions) {
            let fnInfo = i.getInfo();
            if (fnInfo instanceof Promise) fnInfo = await fnInfo;
            if (fnInfo.name.startsWith('@')) continue;
            tools.push({
                type: 'function',
                function: {
                    name: fnInfo.name,
                    description: fnInfo.description,
                    parameters: fnInfo.parameters
                }
            });
        }
        for (let i of agent.functions) {
            let fnInfo = i.getInfo();
            if (fnInfo instanceof Promise) fnInfo = await fnInfo;
            tools.push({
                type: 'function',
                function: {
                    name: fnInfo.name,
                    description: fnInfo.description,
                    parameters: fnInfo.parameters
                }
            });
        }
        if (tools.length > 0) body.tools = tools;

        if (agent.instructions) {
            body.messages.push({
                role: 'developer',
                content: agent.instructions
            });
        }

        const conv = conversation.conversation;
        for (let i = 0; i < conv.length; i++) {
            let baseRole = conv[i].role === 'model' ? 'assistant' : (conv[i].role === 'system' ? 'system' : 'user');

            let msg = { role: baseRole, content: [] };
            let pendingToolResponses = [];

            const pushMsg = () => {
                if (msg.content.length === 1 && msg.content[0].type === 'text') {
                    msg.content = msg.content[0].text;
                } else if (msg.content.length === 0) {
                    msg.content = null;
                }

                if (msg.content !== null || msg.tool_calls || msg.audio) {
                    body.messages.push(msg);
                }

                if (pendingToolResponses.length > 0) {
                    body.messages.push(...pendingToolResponses);
                    pendingToolResponses = [];
                }

                msg = { role: baseRole, content: [] };
            };

            for (let j of conv[i].components) {
                switch (j.type) {
                    case 'text':
                        if (msg.tool_calls && msg.tool_calls.length > 0) pushMsg();
                        msg.content.push({ type: 'text', text: j.content });
                        break;
                    case 'file':
                        if (msg.tool_calls && msg.tool_calls.length > 0) pushMsg();

                        if (baseRole === 'assistant' && j.x?.openai_audio_id) {
                            msg.audio = { id: j.x.openai_audio_id };
                            continue;
                        }

                        const mediaType = j.mediaType ?? j.media_type;
                        if (mediaType.startsWith('image/')) {
                            let url = j.uri;
                            if (!url && j.data) {
                                let base64 = Buffer.isBuffer(j.data) ? j.data.toString('base64') : j.data;
                                url = `data:${mediaType};base64,${base64}`;
                            }
                            msg.content.push({ type: 'image_url', image_url: { url } });
                        } else if (mediaType.startsWith('audio/')) {
                            let data = j.data;
                            if (Buffer.isBuffer(data)) data = data.toString('base64');
                            let format = mediaType.split('/')[1] === 'mp3' ? 'mp3' : 'wav';
                            msg.content.push({ type: 'input_audio', input_audio: { data, format } });
                        } else if (mediaType === 'text/plain') {
                            msg.content.push({ type: 'text', text: j.data.toString() });
                        }
                        break;
                    case 'action':
                        if (typeof j.name === 'string' && !j.name.startsWith('@')) {
                            if (!msg.tool_calls) msg.tool_calls = [];
                            const callId = j.x?.openai_tool_call_id || `call_${Math.random().toString(36).substr(2, 9)}`;
                            msg.tool_calls.push({
                                id: callId,
                                type: 'function',
                                function: {
                                    name: j.name,
                                    arguments: typeof j.action === 'string' ? j.action : JSON.stringify(j.action)
                                }
                            });
                            pendingToolResponses.push({
                                role: 'tool',
                                tool_call_id: callId,
                                content: typeof j.reaction === 'string' ? j.reaction : JSON.stringify(j.reaction)
                            });
                        }
                        break;
                    case 'function_call':
                        if (!msg.tool_calls) msg.tool_calls = [];
                        msg.tool_calls.push({
                            id: j.x?.openai_tool_call_id || `call_${Math.random().toString(36).substr(2, 9)}`,
                            type: 'function',
                            function: {
                                name: j.name,
                                arguments: typeof j.arguments === 'string' ? j.arguments : JSON.stringify(j.arguments)
                            }
                        });
                        break;
                    case 'function_response':
                        pendingToolResponses.push({
                            role: 'tool',
                            tool_call_id: j.x?.openai_tool_call_id || `call_${Math.random().toString(36).substr(2, 9)}`,
                            content: typeof j.result === 'string' ? j.result : JSON.stringify(j.result)
                        });
                        break;
                }
            }

            pushMsg();
        }

        if (agent.x?.openai_body) {
            Object.assign(body, agent.x.openai_body);
        }

        return body;
    }

    // interact
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
                    ctx: context,
                    id: i.x?.openai_tool_call_id
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
                        meta: res.meta,
                        x: { openai_tool_call_id: i.id }
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
            let auth = options.auth ?? this.options.auth;
            if (auth && !auth.startsWith('Bearer ')) auth = 'Bearer ' + auth;

            const res = await request('POST', `${this.service.baseUrl}/chat/completions`, JSON.stringify(body), {
                'Authorization': auth,
                'Content-Type': 'application/json'
            });

            if (res.statusCode !== 200) throw _requestError(res);

            const data = await res.json();

            meta.model = data.model;
            meta.inputTotal += data.usage?.prompt_tokens ?? 0;
            meta.outputTotal += data.usage?.completion_tokens ?? 0;
            if (data.system_fingerprint) meta.x.system_fingerprint = data.system_fingerprint;

            let ends = true;
            const choice = data.choices?.[0];
            if (choice?.message) {
                const actionMsg = { role: 'assistant', content: null, tool_calls: [] };
                const reactionMsgs = [];

                if (choice.message.content) {
                    msg.components.push({
                        type: 'text',
                        content: choice.message.content
                    });
                    actionMsg.content = choice.message.content;
                }

                if (choice.message.refusal) {
                    msg.components.push({
                        type: 'text',
                        content: choice.message.refusal,
                        x: { openai_refusal: true }
                    });
                    if (!actionMsg.content) actionMsg.content = choice.message.refusal;
                }

                if (choice.message.audio) {
                    msg.components.push({
                        type: 'file',
                        mediaType: 'audio/wav',
                        data: choice.message.audio.data,
                        x: { openai_audio_id: choice.message.audio.id }
                    });
                    if (choice.message.audio.transcript) {
                        msg.components.push({
                            type: 'text',
                            content: choice.message.audio.transcript,
                            x: { openai_audio_transcript: true }
                        });
                    }
                    actionMsg.audio = { id: choice.message.audio.id };
                }

                let hasUnhandledFunction = false;
                let hasAction = false;

                if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                    for (let tc of choice.message.tool_calls) {
                        if (tc.type === 'function') {
                            actionMsg.tool_calls.push(tc);

                            let args;
                            try {
                                args = JSON.parse(tc.function.arguments);
                            } catch (e) {
                                args = tc.function.arguments;
                            }

                            if (agent._actions[tc.function.name]) { // run as action
                                const result = await agent._actions[tc.function.name].call(args, context);

                                msg.components.push({
                                    type: 'action',
                                    name: tc.function.name,
                                    action: args,
                                    reaction: result.result,
                                    reaction_attachments: result.attachments ?? [],
                                    meta: result.meta,
                                    x: { openai_tool_call_id: tc.id }
                                });

                                reactionMsgs.push({
                                    role: 'tool',
                                    tool_call_id: tc.id,
                                    content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
                                });

                                hasAction = true;
                            } else { // normal function call
                                msg.components.push({
                                    type: 'function_call',
                                    name: tc.function.name,
                                    arguments: args,
                                    x: { openai_tool_call_id: tc.id }
                                });

                                reactionMsgs.push({
                                    role: 'tool',
                                    tool_call_id: tc.id,
                                    content: JSON.stringify(options.canceledResult ?? this.options.canceledResult ?? { status: 'EXECUTION_CANCELED', message: 'Please run this function again.' })
                                });
                                hasUnhandledFunction = true;
                            }
                        }
                    }
                }

                if (actionMsg.content !== null || actionMsg.tool_calls?.length > 0 || actionMsg.audio) {
                    if (actionMsg.tool_calls && actionMsg.tool_calls.length === 0) delete actionMsg.tool_calls;
                    body.messages.push(actionMsg);
                }

                if (reactionMsgs.length > 0) {
                    body.messages.push(...reactionMsgs);
                }

                if (hasAction && !hasUnhandledFunction) {
                    ends = false; // generate again after action executed
                }
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

    // stream interact
    async *streamInteract(agent, conversation, context, options = {}) {
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, agent);
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        // function executing if conversations ends with model turn with function call component
        if (conversation.last?.role === 'model') {
            const funcs = [];
            for (let i of conversation.last.components) {
                if (i.type === 'function_call' && (agent._functions[i.name] || agent._actions[i.name])) {
                    funcs.push({
                        name: i.name,
                        func: agent._functions[i.name] || agent._actions[i.name],
                        args: i.arguments,
                        ctx: context,
                        id: i.x?.openai_tool_call_id
                    });
                }
            }

            if (funcs.length > 0) {
                const msg = { role: 'system', components: [] };
                for (let i of funcs) {
                    if (!i.func || typeof i.func.call !== 'function') {
                        throw new Error(`Function "${i.name}" is not registered on this agent.`);
                    }

                    const res = await i.func.call(i.args, i.ctx);
                    const component = {
                        type: 'function_response',
                        name: i.name,
                        result: res.result,
                        meta: res.meta,
                        x: { openai_tool_call_id: i.id }
                    };
                    msg.components.push(component);
                    yield { type: 'component', component: component };
                }
                conversation.conversation.push(msg);
                yield { type: 'end', conversation };
                return conversation;
            }
        }

        const body = await this._buildBody(agent, conversation, context, options);
        body.stream = true;
        body.stream_options = { include_usage: true };

        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            let auth = options.auth ?? this.options.auth;
            if (auth && !auth.startsWith('Bearer ')) auth = 'Bearer ' + auth;

            const res = await request('POST', `${this.service.baseUrl}/chat/completions`, JSON.stringify(body), {
                'Authorization': auth,
                'Content-Type': 'application/json'
            });

            if (res.statusCode !== 200) throw _requestError(res);

            const sse = res.sse();
            const requestMeta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };

            let ends = true;
            let actionMsg = { role: 'assistant', content: '', tool_calls: [] };
            let reactionMsgs = [];

            let lastComponent = null;
            let activeToolCalls = {}; // index -> component

            for await (let event of sse) {
                if (!event.data || event.data === '[DONE]') continue;
                let data;
                try {
                    data = JSON.parse(event.data);
                } catch (err) {
                    continue;
                }

                if (data.model) requestMeta.model = data.model;
                if (data.system_fingerprint) requestMeta.x.system_fingerprint = data.system_fingerprint;
                if (data.usage) {
                    requestMeta.inputTotal = data.usage.prompt_tokens ?? requestMeta.inputTotal;
                    requestMeta.outputTotal = data.usage.completion_tokens ?? requestMeta.outputTotal;
                }

                if (!data.choices || data.choices.length === 0) continue;

                const choice = data.choices[0];
                const delta = choice.delta;

                if (!delta) continue;

                // Handle text content
                if (delta.content != null) {
                    if (lastComponent && lastComponent.type === 'text' && !lastComponent.x?.openai_refusal) {
                        lastComponent.content += delta.content;
                        actionMsg.content += delta.content;
                        yield { type: 'continue', content: delta.content, component: lastComponent, meta: requestMeta };
                    } else {
                        const component = {
                            type: 'text',
                            content: delta.content
                        };
                        msg.components.push(component);
                        yield { type: 'component', component: component, last: lastComponent, meta: requestMeta };
                        lastComponent = component;
                        actionMsg.content += delta.content;
                    }
                }

                // Handle refusal
                if (delta.refusal != null) {
                    if (lastComponent && lastComponent.type === 'text' && lastComponent.x?.openai_refusal) {
                        lastComponent.content += delta.refusal;
                        actionMsg.content += delta.refusal;
                        yield { type: 'continue', content: delta.refusal, component: lastComponent, meta: requestMeta };
                    } else {
                        const component = {
                            type: 'text',
                            content: delta.refusal,
                            x: { openai_refusal: true }
                        };
                        msg.components.push(component);
                        yield { type: 'component', component: component, last: lastComponent, meta: requestMeta };
                        lastComponent = component;
                        actionMsg.content += delta.refusal;
                    }
                }

                // Handle tool_calls
                if (delta.tool_calls) {
                    for (let tc of delta.tool_calls) {
                        if (!activeToolCalls[tc.index]) {
                            const component = {
                                type: 'function_call',
                                name: tc.function?.name ?? '',
                                arguments: tc.function?.arguments ?? '',
                                x: { openai_tool_call_id: tc.id }
                            };
                            activeToolCalls[tc.index] = component;
                            msg.components.push(component);
                            yield { type: 'component', component: component, last: lastComponent, meta: requestMeta };
                            lastComponent = component;
                        } else {
                            const component = activeToolCalls[tc.index];
                            if (tc.function?.name) component.name += tc.function.name;
                            if (tc.function?.arguments) {
                                component.arguments += tc.function.arguments;
                                yield { type: 'continue', content: tc.function.arguments, component: component, meta: requestMeta };
                            }
                        }
                    }
                }
            }

            // After stream ends, process activeToolCalls for Actions vs Function Calls
            let hasAction = false;
            let hasUnhandledFunction = false;

            const toolCallValues = Object.values(activeToolCalls);
            if (toolCallValues.length > 0) {
                for (let tc of toolCallValues) {
                    actionMsg.tool_calls.push({
                        id: tc.x.openai_tool_call_id,
                        type: 'function',
                        function: {
                            name: tc.name,
                            arguments: tc.arguments
                        }
                    });

                    let args;
                    try {
                        args = JSON.parse(tc.arguments);
                    } catch (e) {
                        args = tc.arguments;
                    }

                    if (agent._actions[tc.name]) {
                        tc.type = 'action';
                        tc.action = args;

                        const result = await agent._actions[tc.name].call(args, context);

                        tc.reaction = result.result;
                        tc.reaction_attachments = result.attachments ?? [];
                        tc.meta = result.meta;

                        reactionMsgs.push({
                            role: 'tool',
                            tool_call_id: tc.x.openai_tool_call_id,
                            content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
                        });

                        hasAction = true;
                    } else { // normal function call
                        reactionMsgs.push({
                            role: 'tool',
                            tool_call_id: tc.x.openai_tool_call_id,
                            content: JSON.stringify(options.canceledResult ?? this.options.canceledResult ?? { status: 'EXECUTION_CANCELED', message: 'Please run this function again.' })
                        });
                        hasUnhandledFunction = true;
                    }
                }
            }
            if (actionMsg.content || actionMsg.tool_calls?.length > 0) {
                if (actionMsg.tool_calls && actionMsg.tool_calls.length === 0) delete actionMsg.tool_calls;
                body.messages.push(actionMsg);
            }

            if (reactionMsgs.length > 0) {
                body.messages.push(...reactionMsgs);
            }

            // metadata update
            meta.model = requestMeta.model || meta.model;
            meta.inputTotal += requestMeta.inputTotal;
            meta.outputTotal += requestMeta.outputTotal;
            meta.x = Object.assign(meta.x, requestMeta.x);

            // ends
            if (hasAction && !hasUnhandledFunction) {
                ends = false; // generate again after action executed
            }

            if (ends) break;
        }

        // push to conversation
        if (msg.components.length > 0) {
            conversation.conversation.push(msg);
        }

        // set meta to conversation and return
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
