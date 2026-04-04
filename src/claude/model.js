/*
@jnode/ai/claude/model.js
v2

Simple AI API package for Node.js.

by Claude
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
                actions: ['@code_execution'] // there should be more, add them!
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

    // build body
    async _buildBody(agent, conversation, context, options) {

    }

    // interact
    async interact(agent, conversation, context, options = {}) {

    }

    // stream interact
    async *streamInteract(agent, conversation, context, options = {}) {

    }
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = ClaudeModel;