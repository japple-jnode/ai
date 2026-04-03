/*
@jnode/ai/service.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const AIModel = require('./model.js');
const { request } = require('@jnode/request');

// basic jai service
class AIService {
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl;
        this.options = options;
    }

    model(name, options) {
        return new AIModel(this, name, { ...this.options, ...options });
    }

    async listModels(options) {
        const res = await request('GET', `${this.baseUrl}/models`, null, {
            'Authorization': options.auth ?? this.options.auth
        });

        if (res.statusCode !== 200) throw _requestError(res);


    }
}

function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = AIService;