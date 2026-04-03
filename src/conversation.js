/*
@jnode/ai/conversation.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// universal interactive model conversation
class AIConversation {
    constructor(agent, conversation = []) {
        this.agent = agent;

        // parsed conversation
        this.conversation = AIConversation.parse(conversation);
    }

    // parse conversation
    static parse(conversation = []) {
        if (typeof conversation === 'string') { // single turn simple prompt
            return [{
                role: 'user',
                components: [{
                    type: 'text',
                    content: conversation
                }]
            }];
        } else if (Array.isArray(conversation)) { // full conversation or single turn components
            // length check
            if (conversation.length === 0) return [];

            if (conversation[0].type) { // single turn components
                return [{
                    role: 'user',
                    components: conversation
                }];
            } else { // full conversation
                return conversation;
            }
        } else if (typeof conversation === 'object') { // single turn message or component
            if (conversation.type) { // single turn component
                return [{
                    role: 'user',
                    components: [conversation]
                }];
            } else { // single turn message
                return [conversation];
            }
        } else {
            return [];
        }
    }

    // last message
    get last() {
        return this.conversation[this.conversation.length - 1] || null;
    }

    // interact with current conversation
    interact(conversation, context, options = {}) {
        this.conversation.push(...AIConversation.parse(conversation));
        return this.agent.interact(this, context, options);
    }

    // stream interact with current conversation
    streamInteract(conversation, context, options = {}) {
        this.conversation.push(...AIConversation.parse(conversation));
        return this.agent.streamInteract(this, context, options);
    }

    // push new conversation
    push(conversation) {
        this.conversation.push(...AIConversation.parse(conversation));
    }

    // clone conversation
    clone() {
        return new AIConversation(this.agent, [...this.conversation]);
    }
}

// export
module.exports = AIConversation;