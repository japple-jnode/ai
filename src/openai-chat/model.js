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
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = OAIChatModel;
