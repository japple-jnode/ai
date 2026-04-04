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
    constructor(options = {}) {
        this.baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
        this.options = options;
    }

    model(name, options) {
        return new GeminiModel(this, name, { ...this.options, ...options });
    }
}

// export
module.exports = GeminiService;