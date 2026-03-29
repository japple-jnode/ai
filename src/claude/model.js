/*
@jnode/ai/claude/model.js
v2

Simple AI API package for Node.js.

by Claude (I need someone to test it out, I'm too poor to buy credits for Claude API)
*/

// dependencies
const AIAgent = require('./../agent.js');
const AIConversation = require('./../conversation.js');
const { request } = require('@jnode/request');

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
    }

    // -------------------------------------------------------------------------
    // getInfo — hard-coded capabilities (Claude has no public model-info REST
    // endpoint that maps cleanly to the AIModel schema).
    // -------------------------------------------------------------------------
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
                reasoning: true, // extended-thinking support
                multimodalCapabilities: [
                    'image/png',
                    'image/jpeg',
                    'image/webp',
                    'image/gif',
                    'application/pdf'
                ],
                actions: [] // Claude has no built-in native actions in this schema
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

    // -------------------------------------------------------------------------
    // interact — main entry point, mirrors AIModel.interact conventions
    // -------------------------------------------------------------------------
    async interact(agent, conversation, context, options = {}) {
        if (!(agent instanceof AIAgent)) agent = new AIAgent(this, agent);
        if (!(conversation instanceof AIConversation)) conversation = new AIConversation(agent, conversation);

        // If the conversation already ends on a model turn that contains pending
        // function_call components, execute them and return so the caller can
        // continue the loop (same pattern as GeminiModel / OAIChatModel).
        if (conversation.last?.role === 'model') {
            const funcs = [];
            for (let i of conversation.last.components) {
                if (i.type !== 'function_call') continue;

                const fn = agent._actions[i.name] ?? agent._functions[i.name];
                if (!fn) continue;

                funcs.push({ name: i.name, func: fn, args: i.arguments, ctx: context });
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

        const info = await this.getInfo();
        const toolRegistry = await this._buildToolRegistry(agent);
        const body = this._buildRequestBody(agent, options, toolRegistry);
        body.messages = this._conversationToMessages(conversation.conversation, toolRegistry);

        const maxActions = options.maxActions ?? this.options.maxActions ?? 24;
        const meta = { model: this.name, inputTotal: 0, outputTotal: 0, price: 0, x: {} };
        const msg = { role: 'model', components: [] };

        for (let i = 0; i < maxActions; i++) {
            const data = await this._request(body, options);

            meta.model = data.model ?? meta.model;
            meta.inputTotal += data.usage?.input_tokens ?? 0;
            meta.outputTotal += data.usage?.output_tokens ?? 0;
            meta.x = Object.assign(meta.x, {
                id: data.id,
                type: data.type,
                stopReason: data.stop_reason,
                stopSequence: data.stop_sequence,
                usage: data.usage
            });

            let ends = true;
            const actionBlocks = []; // Claude-API content blocks for next turn (assistant)
            const reactionBlocks = []; // tool_result content blocks for next turn (user)

            for (let block of (data.content ?? [])) {
                switch (block.type) {
                    // ── plain text ─────────────────────────────────────────
                    case 'text':
                        if (block.text) {
                            msg.components.push({ type: 'text', content: block.text });
                            actionBlocks.push({ type: 'text', text: block.text });
                        }
                        break;

                    // ── extended thinking ──────────────────────────────────
                    case 'thinking':
                        if (block.thinking) {
                            msg.components.push({
                                type: 'thought',
                                content: block.thinking,
                                x: { signature: block.signature }
                            });
                            actionBlocks.push(block); // must echo back verbatim
                        }
                        break;

                    // ── redacted thinking (pass-through) ───────────────────
                    case 'redacted_thinking':
                        actionBlocks.push(block);
                        break;

                    // ── tool use (function / action call) ──────────────────
                    case 'tool_use': {
                        const apiName = block.name;
                        const originalName = toolRegistry.byApiName.get(apiName)?.name ?? apiName;
                        const args = block.input ?? {};

                        actionBlocks.push(block); // always echo the tool_use block

                        const action = agent._actions[originalName];
                        if (action) {
                            // execute as an inline action
                            const result = await action.call(args, context);

                            msg.components.push({
                                type: 'action',
                                name: originalName,
                                action: args,
                                reaction: result.result,
                                meta: result.meta,
                                x: { claude: { toolUseId: block.id } }
                            });

                            reactionBlocks.push({
                                type: 'tool_result',
                                tool_use_id: block.id,
                                content: _serializeToolResult(result.result)
                            });

                            ends = false; // need another generation after this action
                        } else {
                            // expose as a pending function_call for the caller
                            msg.components.push({
                                type: 'function_call',
                                name: originalName,
                                arguments: args,
                                x: { claude: { toolUseId: block.id } }
                            });
                        }
                        break;
                    }
                }
            }

            // Append the assistant turn and, if there were actions, the user
            // tool-result turn to the running message array for the next loop.
            if (actionBlocks.length > 0) {
                body.messages.push({ role: 'assistant', content: actionBlocks });
            }
            if (reactionBlocks.length > 0) {
                body.messages.push({ role: 'user', content: reactionBlocks });
            }

            if (ends) break;
        }

        if (msg.components.length > 0) {
            conversation.conversation.push(msg);
        }

        conversation.meta = meta;
        return conversation;
    }

    // -------------------------------------------------------------------------
    // _buildToolRegistry
    // -------------------------------------------------------------------------
    async _buildToolRegistry(agent) {
        const registry = {
            tools: [],
            byApiName: new Map()
        };

        // actions and functions both become Claude tools (native @actions are
        // skipped — Claude has none in this schema)
        const sources = [...agent.actions, ...agent.functions];
        for (let item of sources) {
            let info = item.getInfo();
            if (info instanceof Promise) info = await info;

            if (info.name.startsWith('@')) continue; // native actions — not supported

            const apiName = _toolApiName(info.name, registry.byApiName);
            registry.byApiName.set(apiName, { name: info.name, apiName, item, info });

            registry.tools.push({
                name: apiName,
                description: info.description || 'Function.',
                input_schema: info.parameters || { type: 'object', properties: {} }
            });
        }

        return registry;
    }

    // -------------------------------------------------------------------------
    // _buildRequestBody
    // -------------------------------------------------------------------------
    _buildRequestBody(agent, options, toolRegistry) {
        const body = {
            model: this.name
        };

        // generation parameters
        if (agent.temperature !== undefined) body.temperature = agent.temperature;
        if (agent.topP !== undefined) body.top_p = agent.topP;
        if (agent.topK !== undefined) body.top_k = agent.topK;
        if (agent.outputLimit !== undefined) body.max_tokens = agent.outputLimit;
        if (agent.stopStrings !== undefined) body.stop_sequences = Array.isArray(agent.stopStrings)
            ? agent.stopStrings
            : [agent.stopStrings];

        // max_tokens is required by the Claude API
        if (body.max_tokens === undefined) body.max_tokens = 8192;

        // system prompt
        if (agent.instructions) body.system = agent.instructions;

        // tools
        if (toolRegistry.tools.length > 0) {
            body.tools = toolRegistry.tools;
            body.tool_choice = options.toolChoice ?? this.options.toolChoice ?? { type: 'auto' };
        }

        // extended thinking
        const thinking = _mapThinkingConfig(agent.thinkingLevel);
        if (thinking) body.thinking = thinking;

        // merge any provider-specific overrides
        Object.assign(body, this.options.x?.request ?? {}, agent.x?.request ?? {}, options.x?.request ?? {});

        return body;
    }

    // -------------------------------------------------------------------------
    // _conversationToMessages — convert internal conversation to Claude format
    //
    // Claude requires strict user/assistant alternation.  The internal format
    // uses:
    //   role 'user'   → Claude role 'user'
    //   role 'model'  → Claude role 'assistant'
    //   role 'system' → function responses → folded into next 'user' turn
    //
    // -------------------------------------------------------------------------
    _conversationToMessages(conversation, toolRegistry) {
        const messages = [];

        for (let msg of conversation) {
            if (msg.role === 'model') {
                const apiMsg = this._modelMessageToApi(msg, toolRegistry);
                if (apiMsg) messages.push(apiMsg);
                continue;
            }

            if (msg.role === 'system') {
                // system messages in this framework carry function_response
                // components — map them to tool_result blocks in a user turn.
                const userMsg = this._systemMessageToApi(msg);
                if (userMsg) messages.push(userMsg);
                continue;
            }

            // user / any other role
            const userMsg = this._userMessageToApi(msg, toolRegistry);
            if (userMsg) messages.push(userMsg);
        }

        // Claude requires strict alternation; merge adjacent same-role turns.
        return _mergeAdjacentRoles(messages);
    }

    // ── per-role converters ───────────────────────────────────────────────────

    _userMessageToApi(msg, toolRegistry) {
        const content = [];

        for (let part of msg.components) {
            switch (part.type) {
                case 'text':
                    if (part.content) content.push({ type: 'text', text: part.content });
                    break;

                case 'file': {
                    const mapped = _mapUserFilePart(part);
                    if (mapped) content.push(mapped);
                    break;
                }

                // A user message may carry pre-serialised action reactions from history
                case 'action': {
                    const apiName = [...(toolRegistry?.byApiName?.values() ?? [])].find(i => i.name === part.name)?.apiName ?? part.name;
                    content.push({
                        type: 'tool_result',
                        tool_use_id: part.x?.claude?.toolUseId ?? `${apiName}_result`,
                        content: _serializeToolResult(part.reaction)
                    });
                    break;
                }

                case 'function_response':
                    content.push({
                        type: 'tool_result',
                        tool_use_id: part.x?.claude?.toolUseId ?? `${part.name}_result`,
                        content: _serializeToolResult(part.result)
                    });
                    break;
            }
        }

        if (content.length === 0) return null;
        return { role: 'user', content };
    }

    _systemMessageToApi(msg) {
        // System messages from the framework are primarily function responses.
        const content = [];

        for (let part of msg.components) {
            if (part.type === 'function_response') {
                content.push({
                    type: 'tool_result',
                    tool_use_id: part.x?.claude?.toolUseId ?? `${part.name}_result`,
                    content: _serializeToolResult(part.result)
                });
            } else if (part.type === 'text' && part.content) {
                content.push({ type: 'text', text: part.content });
            }
        }

        if (content.length === 0) return null;
        return { role: 'user', content };
    }

    _modelMessageToApi(msg, toolRegistry) {
        const content = [];

        for (let part of msg.components) {
            switch (part.type) {
                case 'text':
                    if (part.content) content.push({ type: 'text', text: part.content });
                    break;

                case 'thought':
                    // Reconstruct thinking block; signature must be preserved if present.
                    content.push({
                        type: 'thinking',
                        thinking: part.content,
                        signature: part.x?.signature ?? ''
                    });
                    break;

                case 'function_call': {
                    const apiName = [...(toolRegistry?.byApiName?.values() ?? [])].find(i => i.name === part.name)?.apiName ?? _toolApiName(part.name);
                    content.push({
                        type: 'tool_use',
                        id: part.x?.claude?.toolUseId ?? `toolu_${apiName}`,
                        name: apiName,
                        input: part.arguments ?? {}
                    });
                    break;
                }

                case 'action': {
                    // action = function_call that was immediately executed; we
                    // emit a tool_use block for the assistant turn here.
                    const apiName = [...(toolRegistry?.byApiName?.values() ?? [])].find(i => i.name === part.name)?.apiName ?? _toolApiName(part.name);
                    content.push({
                        type: 'tool_use',
                        id: part.x?.claude?.toolUseId ?? `toolu_${apiName}`,
                        name: apiName,
                        input: part.action ?? {}
                    });
                    break;
                }
            }
        }

        if (content.length === 0) return null;
        return { role: 'assistant', content };
    }

    // -------------------------------------------------------------------------
    // _request — POST to the Anthropic Messages endpoint
    // -------------------------------------------------------------------------
    async _request(body, options = {}) {
        const baseUrl = this.service?.baseUrl ?? 'https://api.anthropic.com/v1';
        const auth = options.auth ?? this.options.auth ?? this.service?.options?.auth;

        const headers = {
            'Content-Type': 'application/json',
            'anthropic-version': options.anthropicVersion ?? this.options.anthropicVersion ?? '2023-06-01'
        };

        if (auth) {
            // Support both "Bearer sk-..." and bare "sk-..." styles
            if (auth.startsWith('Bearer ') || auth.startsWith('bearer ')) {
                headers['x-api-key'] = auth.slice(auth.indexOf(' ') + 1);
            } else {
                headers['x-api-key'] = auth;
            }
        } else if (process.env.ANTHROPIC_API_KEY) {
            headers['x-api-key'] = process.env.ANTHROPIC_API_KEY;
        }

        // Enable extended thinking beta header when requested
        if (body.thinking) {
            headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
        }

        const res = await request('POST', `${baseUrl}/messages`, JSON.stringify(body), headers);

        if (res.statusCode !== 200) throw _requestError(res);
        return await res.json();
    }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Map agent.thinkingLevel to a Claude extended-thinking config object.
 *   'none'   → disabled
 *   'low'    → budget_tokens: 1024
 *   'medium' → budget_tokens: 8000
 *   'high'   → budget_tokens: 16000
 *   number   → budget_tokens: <number>
 */
function _mapThinkingConfig(level) {
    if (!level || level === 'none') return null;
    if (typeof level === 'number') return { type: 'enabled', budget_tokens: level };
    if (level === 'low') return { type: 'enabled', budget_tokens: 1024 };
    if (level === 'medium') return { type: 'enabled', budget_tokens: 8000 };
    if (level === 'high') return { type: 'enabled', budget_tokens: 16000 };
    return null;
}

/**
 * Map a JAI file component to a Claude content block.
 * Claude supports: image (base64 or URL) and document (PDF, plain-text).
 */
function _mapUserFilePart(part) {
    const mediaType = part.mediaType ?? part.media_type;
    if (!mediaType) return null;

    const data = Buffer.isBuffer(part.data) ? part.data.toString('base64') : part.data;

    if (mediaType.startsWith('image/')) {
        if (part.uri && !part.uri.startsWith('data:')) {
            return {
                type: 'image',
                source: { type: 'url', url: part.uri }
            };
        }
        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type: mediaType,
                data: data ?? ''
            }
        };
    }

    if (mediaType === 'application/pdf' || mediaType === 'text/plain') {
        return {
            type: 'document',
            source: {
                type: 'base64',
                media_type: mediaType,
                data: data ?? ''
            }
        };
    }

    return null;
}

/**
 * Sanitise a function name so it is valid as a Claude tool name.
 * Claude tool names: ^[a-zA-Z0-9_-]{1,64}$
 */
function _toolApiName(name, registry = new Map()) {
    const base = String(name ?? 'tool')
        .replace(/^@+/, 'action_')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/, '')
        .slice(0, 64) || 'tool';

    let candidate = base;
    let index = 2;
    while (registry.has(candidate)) {
        const suffix = `_${index++}`;
        candidate = `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    }
    return candidate;
}

/** Serialise a tool result to a string for Claude's tool_result content. */
function _serializeToolResult(result) {
    if (typeof result === 'string') return result;
    if (result === undefined || result === null) return 'null';
    return JSON.stringify(result);
}

/**
 * Claude enforces strict role alternation (user → assistant → user …).
 * Merge consecutive messages that share the same role by concatenating their
 * content arrays.
 */
function _mergeAdjacentRoles(messages) {
    const merged = [];
    for (let m of messages) {
        if (merged.length > 0 && merged[merged.length - 1].role === m.role) {
            const prev = merged[merged.length - 1];
            // content may be a string or array
            const prevContent = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: prev.content }];
            const nextContent = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
            prev.content = [...prevContent, ...nextContent];
        } else {
            merged.push({ ...m, content: Array.isArray(m.content) ? [...m.content] : m.content });
        }
    }
    return merged;
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = ClaudeModel;