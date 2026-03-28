/*
JustAI/src/client.js

Simple AI API package for Node.js.

by JustNode Dev Team / JustApple
*/

// dependencies
const OpenAIService = require('./openai/service.js');
const GeminiService = require('./gemini/service.js');
const AIService = require('./service.js');

// the client for AI APIs
class AIClient {
    constructor(key, options = {}) {
        this.key = key;
        
        if (options.service === 'gemini') {
            this.service = new GeminiService(this);
        } else if (options.servive instanceof AIService) {
            this.service = new options.service(this);
        } else { // default: OpenAI
            this.service = new OpenAIService(this);
        }
    }
}