/*
@jnode/ai/gemini/service.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const GeminiChatModel = require('./model.js');

// openai chat completion service
class GeminiService {
    constructor(baseUrl = 'https://generativelanguage.googleapis./v1beta', options = {}) {
        this.baseUrl = baseUrl;
        this.options = options;
    }

    model(name, options) {
        return new GeminiChatModel(name, { ...this.options, ...options });
    }
}

// export
module.exports = GeminiService;