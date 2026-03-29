/*
@jnode/ai
v2

Simple AI API package for Node.js.

by JustApple
*/

// export
module.exports = {
    AIService: require('./service.js'),
    AIModel: require('./model.js'),
    AIConversation: require('./conversation.js'),
    AIAgent: require('./agent.js'),
    ...require('./function.js')
};