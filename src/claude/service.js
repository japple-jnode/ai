/*
@jnode/ai/claude/service.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const ClaudeModel = require('./model.js');

// claude service
class ClaudeService {
    constructor(baseUrl = 'https://api.anthropic.com/v1', options = {}) {
        this.baseUrl = baseUrl;
        this.options = options;
    }

    model(name, options) {
        return new ClaudeModel(name, { ...this.options, ...options });
    }
}

// export
module.exports = ClaudeService;