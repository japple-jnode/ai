/*
@jnode/ai/openai-chat/service.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const OAIChatModel = require('./model.js');

// openai chat completion service
class OAIChatService {
    constructor(baseUrl = 'https://api.openai.com/v1', options = {}) {
        this.baseUrl = baseUrl;
        this.options = options;
    }

    model(name, options) {
        return new OAIChatModel(this, name, { ...this.options, ...options });
    }
}

// export
module.exports = OAIChatService;