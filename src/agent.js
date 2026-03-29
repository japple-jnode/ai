/*
@jnode/ai/agent.js
v2

Simple AI API package for Node.js.

by JustNode Dev Team / JustApple
*/

// universal interactive model agent config
class AIAgent {
    constructor(model, agent = {}) {
        this.model = model;

        // agent options, must be accepted in any service

        // generation configs
        this.temperature = agent.temperature; // temperature, 0.0~2.0
        this.topP = agent.topP ?? agent.top_p; // top p, 0.0~1.0
        this.topK = agent.topK ?? agent.top_k; // top k, >= 1
        this.seed = agent.seed; // seed
        this.outputLimit = agent.outputLimit ?? agent.output_limit; // max output token limit
        this.stopStrings = agent.stopStrings ?? agent.stop_strings; // strings that will make model stop outputting
        this.logprobs = agent.logprobs; // logprobs
        this.frequencyPenalty = agent.frequencyPenalty ?? agent.frequency_penalty; // frequency penalty, -2.0~2.0
        this.presencePenalty = agent.presencePenalty ?? agent.presence_penalty; // presence penalty, -2.0~2.0
        this.thinkingLevel = agent.thinkingLevel ?? agent.thinking_level; // thinking level, "none" / "low" / "medium" / "high"
        this.responseSchema = agent.responseSchema ?? agent.response_schema; // response schema in JSON Schema for formatted JSON output

        // core instructions, commonly called system prompt
        this.instructions = agent.instructions;

        // actions array, also called inline functions, commonly for native tools like search or code running
        this.actions = [];
        this._actions = {};
        if (Array.isArray(agent.actions)) {
            for (let i of agent.actions) {
                if (Array.isArray(i.kit)) { // expand toolkit actions
                    this.actions.push(...i.kit);
                    for (let j of i.kit) this._actions[j.name] = j;
                } else {
                    this.actions.push(i);
                    this._actions[i.name] = i;
                }
            }
        }

        // functions array, also called tools
        this.functions = [];
        this._functions = {};
        if (Array.isArray(agent.functions)) {
            for (let i of agent.functions) {
                if (Array.isArray(i.kit)) { // expand toolkit functions
                    this.functions.push(...i.kit);
                    for (let j of i.kit) this._functions[j.name] = j;
                } else {
                    this.functions.push(i);
                    this._functions[i.name] = i; // functions are also actions
                }
            }
        }

        // platform/model specific data
        this.x = agent.x ?? {};
    }

    // interact with current agent
    interact(conversation, context, options = {}) {
        return this.model.interact(this, conversation, context, options);
    }
}

// export
module.exports = AIAgent;