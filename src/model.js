/*
@jnode/ai/model.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const AIAgent = require('./agent.js');
const AIConversation = require('./conversation.js');
const { request } = require('@jnode/request');

// jai model
class AIModel {
    constructor(service, name, options = {}) {
        this.service = service;
        this.name = name;
        this.options = options;
    }

    async getInfo(options = {}) {
        if (this._info) return this._info;

        const res = await request('GET', `${this.service.baseUrl}/models/${encodeURIComponent(this.name)}`, null, {
            'Authorization': options.auth ?? this.options.auth
        });

        if (res.statusCode !== 200) throw _requestError(res);

        const data = await res.json();

        // all service must follow this format
        // basic info
        const info = {
            type: data.type, // model type
            name: data.name, // unique model name
            altNames: data.alt_names, // alternative model names
            updated: data.updated, // model last update time, UNIX timestamp in ms
            released: data.released, // model release date, UNIX timestamp in ms
            description: data.description, // human-readable description about the model
            x: data.x ?? {}
        };

        // interactive and media model's attributes
        if (data.type === 'interactive') { // interactive model attributes
            info.features = {
                reasoning: data.features.reasoning ?? false, // supports reasoning (thinking)
                multimodalCapabilities: data.features.multimodal_capabilities ?? [], // supported multimodal file types
                actions: data.features.actions ?? [] // supported standard native actions
            };

            info.inputPrice = data.input_price; // input price per token in nano-points
            info.outputPrice = data.output_price; // output price per token in nano-points
            info.inputLimit = data.input_limit; // max input tokens
            info.outputLimit = data.output_limit; // max output tokens

        } else if (data.type === 'media') { // media model attributes
            info.requestPrice = data.request_price; // price per request in nano-points
        }

        this._info = info;

        return info;
    }

    async _buildBody(agent, conversation, context, options) {
        // get info
        const info = await this.getInfo();

        // generate request body
        const body = {};

        // basic config
        body.temperature = agent.temperature; // temperature, 0.0~2.0
        body.top_p = agent.topP; // top p, 0.0~1.0
        body.top_k = agent.topK; // top k, >= 1
        body.seed = agent.seed; // seed
        body.max_tokens = agent.outputLimit; // max output token limit
        body.stop = agent.stopStrings; // strings that will make model stop outputting
        body.logprobs = agent.logprobs; // logprobs
        body.frequency_penalty = agent.frequencyPenalty; // frequency penalty, -2.0~2.0
        body.presence_penalty = agent.presencePenalty; // presence penalty, -2.0~2.0
        body.thinking_level = agent.thinkingLevel; // thinking level, "none" / "low" / "medium" / "high"
        body.response_schema = agent.responseSchema; // response schema in JSON Schema for formatted JSON output
        body.instructions = agent.instructions; // core instructions, commonly called system prompt

        // actions and functions
        body.actions = [];
        body.functions = [];

        for (let i of agent.actions) {
            let fnInfo = i.getInfo();
            if (fnInfo instanceof Promise) fnInfo = await fnInfo;

            // native actions
            if (fnInfo.name.startsWith('@') && info.features.actions.includes(fnInfo.name)) body.actions.push(fnInfo);
            else if (fnInfo.name.startsWith('@')) continue; // unsupported native action, skip
            else body.functions.push(fnInfo);
        }

        for (let i of agent.functions) {
            let fnInfo = i.getInfo();
            if (fnInfo instanceof Promise) fnInfo = await fnInfo;
            body.functions.push(fnInfo);
        }

        // clean up conversation
        body.conversation = [];
        const conv = conversation.conversation;
        for (let i = 0; i < conv.length; i++) {
            let msg = (body.conversation[body.conversation.length - 1]?.role === conv[i].role) ?
                body.conversation.pop() :
                { role: conv[i].role, components: [] }; // new message if different role

            for (let j of conv[i].components) {
                switch (j.type) {
                    case 'text': // text component
                        msg.components.push({ type: 'text', content: j.content, x: j.x ?? {} });
                        break;
                    case 'file': // file component
                        // check multimodal capabilities
                        const mediaType = j.mediaType ?? j.media_type;
                        if (!info.features.multimodalCapabilities.includes(mediaType)) {
                            if (mediaType === 'text/plain') msg.components.push({ type: 'text', content: j.data.toString(), x: j.x ?? {} });
                            continue;
                        }

                        msg.components.push({
                            type: 'file',
                            media_type: mediaType,
                            uri: j.uri,
                            data: Buffer.isBuffer(j.data) ? j.data.toString('base64') : j.data,
                            x: j.x ?? {}
                        });
                        break;
                    case 'action': // action component
                        if (typeof j.name === 'string' && j.name.startsWith('@')) {
                            msg.components.push({
                                type: 'action',
                                name: j.name,
                                action: j.action,
                                reaction: j.reaction,
                                reaction_attachments: j.reactionAttachments ?? j.reaction_attachments,
                                meta: j.meta,
                                x: j.x ?? {}
                            });
                        } else { // function like action
                            msg.components.push({ type: 'function_call', name: j.name, arguments: j.action, x: j.x ?? {} });
                            body.conversation.push(msg);

                            msg = { role: 'system', components: [] }; // new system message for function response
                            msg.components.push({ type: 'function_response', name: j.name, result: j.reaction, attachments: j.attachments, x: j.x ?? {} });
                            body.conversation.push(msg);

                            msg = { role: conv[i].role, components: [] }; // new message for next components
                        }
                        break;
                    case 'function_call': // function call component
                        msg.components.push({ type: 'function_call', name: j.name, arguments: j.arguments, x: j.x ?? {} });
                        break;
                    case 'function_response': // function response component
                        msg.components.push({ type: 'function_response', name: j.name, result: j.result, attachments: j.attachments, x: j.x ?? {} });
                        break;
                    case 'thought': // thought component
                        msg.components.push({ type: 'thought', content: j.content, x: j.x ?? {} });
                        break;
                }
            }

            if (msg.components.length > 0) body.conversation.push(msg);
        }

        return body;
    }

    // interact with interactive model, every parameter must be followed
    async interact(agent, conversation, context, options = {}) {
        // init
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, agent);
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        // function executing if conversations ends with model turn with function call component
        if (conversation.last?.role === 'model') {
            const funcs = [];
            for (let i of conversation.last.components) {
                if (i.type === 'function_call' && (agent._functions[i.name] || agent._actions[i.name])) { // run as action if action exists
                    funcs.push({
                        name: i.name,
                        func: agent._functions[i.name] || agent._actions[i.name],
                        args: i.arguments,
                        ctx: context
                    });
                }
            }

            // execute functions
            if (funcs.length > 0) {
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
                        meta: res.meta
                    });
                }
                conversation.conversation.push(msg);
                return conversation;
            }
        }

        // build body
        const body = await this._buildBody(agent, conversation, context, options);

        // start response
        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            const res = await request('POST', `${this.service.baseUrl}/models/${encodeURIComponent(this.name)}/interact`, JSON.stringify(body), {
                'Authorization': options.auth ?? this.options.auth,
                'Content-Type': 'application/json'
            });

            if (res.statusCode !== 200) throw _requestError(res);

            const data = await res.json();

            // update metadata
            meta.model = data.model;
            meta.inputTotal += data.input_total;
            meta.outputTotal += data.output_total;
            meta.price += data.price;
            meta.x = Object.assign(meta.x, data.x);

            // push conversation
            let ends = true;
            if (data.message) {
                const actionMsg = { role: 'model', components: [] };
                const reactionMsg = { role: 'system', components: [] };
                for (let j of data.message.components) {
                    switch (j.type) {
                        case 'text': // text component
                        case 'file': // file component
                        case 'action': // action component
                        case 'function_response': // function response component
                        case 'thought': // thought component
                            msg.components.push(j);
                            actionMsg.components.push(j);
                            break;
                        case 'function_call': // function call component
                            if (agent._actions[j.name]) { // run as action
                                const result = await agent._actions[j.name].call(j.arguments, context);

                                msg.components.push({
                                    type: 'action',
                                    name: j.name,
                                    action: j.arguments,
                                    reaction: result.result,
                                    reaction_attachments: result.attachments ?? [],
                                    meta: result.meta,
                                    x: j.x ?? {}
                                });

                                actionMsg.components.push(j);
                                reactionMsg.components.push({ type: 'function_response', name: j.name, result: result.result, x: j.x ?? {} });

                                ends = false; // generate again after action executed
                            } else { // normal function call
                                msg.components.push(j);
                                actionMsg.components.push(j);
                            }

                            break;
                    }
                }
                if (actionMsg.components.length > 0) body.conversation.push(actionMsg);
                if (reactionMsg.components.length > 0) body.conversation.push(reactionMsg);
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
        // init
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, agent);
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        // function executing if conversations ends with model turn with function call component
        if (conversation.last?.role === 'model') {
            const funcs = [];
            for (let i of conversation.last.components) {
                if (i.type === 'function_call' && (agent._functions[i.name] || agent._actions[i.name])) { // run as action if action exists
                    funcs.push({
                        name: i.name,
                        func: agent._functions[i.name] || agent._actions[i.name],
                        args: i.arguments,
                        ctx: context
                    });
                }
            }

            // execute functions
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
                        meta: res.meta
                    };
                    msg.components.push(component);
                    yield { type: 'component', component: component };
                }
                conversation.conversation.push(msg);
                yield { type: 'end', conversation };
                return conversation;
            }
        }

        // build body
        const body = await this._buildBody(agent, conversation, context, options);

        // start response
        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            const res = await request('POST', `${this.service.baseUrl}/models/${encodeURIComponent(this.name)}/stream_interact`, JSON.stringify(body), {
                'Authorization': options.auth ?? this.options.auth,
                'Content-Type': 'application/json'
            });

            if (res.statusCode !== 200) throw _requestError(res);

            const sse = res.sse();

            // update metadata
            meta.model = data.model;
            meta.inputTotal += data.input_total;
            meta.outputTotal += data.output_total;
            meta.price += data.price;
            meta.x = Object.assign(meta.x, data.x);

            // push conversation
            let ends = true;
            if (data.message) {
                const actionMsg = { role: 'model', components: [] };
                const reactionMsg = { role: 'system', components: [] };
                for (let j of data.message.components) {
                    switch (j.type) {
                        case 'text': // text component
                        case 'file': // file component
                        case 'action': // action component
                        case 'function_response': // function response component
                        case 'thought': // thought component
                            msg.components.push(j);
                            actionMsg.components.push(j);
                            break;
                        case 'function_call': // function call component
                            if (agent._actions[j.name]) { // run as action
                                const result = await agent._actions[j.name].call(j.arguments, context);

                                msg.components.push({
                                    type: 'action',
                                    name: j.name,
                                    action: j.arguments,
                                    reaction: result.result,
                                    reaction_attachments: result.attachments ?? [],
                                    meta: result.meta,
                                    x: j.x ?? {}
                                });

                                actionMsg.components.push(j);
                                reactionMsg.components.push({ type: 'function_response', name: j.name, result: result.result, x: j.x ?? {} });

                                ends = false; // generate again after action executed
                            } else { // normal function call
                                msg.components.push(j);
                                actionMsg.components.push(j);
                            }

                            break;
                    }
                }
                if (actionMsg.components.length > 0) body.conversation.push(actionMsg);
                if (reactionMsg.components.length > 0) body.conversation.push(reactionMsg);
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
module.exports = AIModel;