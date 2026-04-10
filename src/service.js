/*
@jnode/ai/service.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const AIModel = require('./model.js');
const { request } = require('@jnode/request');
const { unknownFunction } = require('./../function.js');

// basic jai service
class AIService {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl ?? 'https://ai.justapple.tw/api';
        this.options = options;
        this.unknownFunction = options.unknownFunction ?? unknownFunction;
    }

    model(name, options) {
        return new AIModel(this, name, { ...this.options, ...options });
    }

    async listModels(options) {
        const res = await request('GET', `${this.baseUrl}/models`, null, {
            'Authorization': options.auth ?? this.options.auth
        });

        if (res.statusCode !== 200) throw _requestError(res);

        return await res.json();
    }
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = AIService;