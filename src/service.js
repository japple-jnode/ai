/*
JustAI/src/service.js

Simple AI API package for Node.js.

by JustNode Dev Team / JustApple
*/

// dependencies
const model = require('./model.js');

// AI API service
class AIService {
    constructor(client, baseUrl = 'https://example.com') {
        this.client = client;
        this.baseUrl = baseUrl;
    }
    
    interactiveModel(name, options = {}) {
        return new model.InteractiveModel(this, name, options);
    }
}