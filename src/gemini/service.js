/*
@jnode/ai/gemini/service.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const GeminiModel = require('./model.js');

// gemini service
class GeminiService {
    constructor(baseUrl = 'https://generativelanguage.googleapis.com/v1beta', options = {}) {
        this.baseUrl = baseUrl;
        this.options = options;
    }

    model(name, options) {
        return new GeminiModel(this, name, { ...this.options, ...options });
    }
}

// export
module.exports = GeminiService;