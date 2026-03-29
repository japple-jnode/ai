/*
@jnode/ai/service.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const AIModel = require('./model.js');

// basic jai service
class AIService {
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl;
        this.options = options;
    }

    model(name, options) {
        return new AIModel(this, name, { ...this.options, ...options });
    }
}

// export
module.exports = AIService;