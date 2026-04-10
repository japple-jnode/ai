/*
@jnode/ai/claude/service.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const ClaudeModel = require('./model.js');
const { unknownFunction } = require('./../function.js');

// claude service
class ClaudeService {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com/v1';
        this.options = options;
        this.unknownFunction = options.unknownFunction ?? unknownFunction;
    }

    model(name, options) {
        return new ClaudeModel(name, { ...this.options, ...options });
    }
}

// export
module.exports = ClaudeService;