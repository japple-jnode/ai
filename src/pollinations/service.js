/*
@jnode/ai/pollinations/service.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const PollinationsModel = require('./model.js');

// openai chat completion service
class PollinationsService {
    constructor(baseUrl = 'https://gen.pollinations.ai/', options = {}) {
        this.baseUrl = baseUrl;
        this.options = options;
    }

    model(name, options) {
        return new PollinationsModel(this, name, { ...this.options, ...options });
    }
}

// export
module.exports = PollinationsService;