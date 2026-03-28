/*
JustAI/src/model.js

Simple AI API package for Node.js.

by JustNode Dev Team / JustApple
*/

// interactive model - text, chat and multimodal model
class InteractiveModel {
    constructor(service, name = '', options = {}) {
        this.service = service;
        this.name = name;
        
        // system instruction, system prompt
        this.instruction = options.instruction ?? options.systemInstruction ?? options.system;
        
        // model options
        this.temperature = options.temperature ?? options.temp;
        this.topP = options.topP ?? options.top_p;
        this.topK = options.topK ?? options.top_k;
        this.maxOutput = options.maxOutput ?? options.maxOutputTokens ?? options.max_output ?? options.max_output_tokens ?? options.maxTokens ?? options.max_tokens ?? options.max;
        this.stopSequences = options.stopSequences ?? options.stop_sequences ?? options.stop;
        
        // 
    }
}