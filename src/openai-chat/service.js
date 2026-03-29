/*
@jnode/ai/openai-chat/service.js
v2

Simple AI API package for Node.js.

by JustNode Dev Team / JustApple
*/

// dependencies
const OAIChatModel = require('./model.js');

// openai chat completion service
class OAIChatService {
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl;
        this.options = options;
    }

    model(name, options) {
        return new OAIChatModel(this, name, { ...this.options, ...options });
    }
}

// export
module.exports = OAIChatService;