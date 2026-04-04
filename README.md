
# `@jnode/ai`

Simple AI API package for Node.js.

## Installation

```
npm i @jnode/ai
```

## Quick start

### Import

```js
const { AIService, AIModel, AIConversation, AIAgent, AIFunction } = require('@jnode/ai');
const { OAIChatService } = require('@jnode/ai/openai-chat');
const { GeminiService } = require('@jnode/ai/gemini');
const { ClaudeService } = require('@jnode/ai/claude');
```

### Start a simple conversation

```js
const { OAIChatService, AIAgent } = require('@jnode/ai/openai-chat');

const service = new OAIChatService({ auth: 'sk-your-openai-api-key' });
const model = service.model('gpt-4o');

const agent = new AIAgent(model, {
  instructions: 'You are a helpful assistant.'
});

(async () => {
  const conversation = await agent.interact('Hello, how are you?');
  console.log(conversation.last.components[0].content);
})();
```

### Stream interact with tools

```js
const { GeminiService } = require('@jnode/ai/gemini');
const { AIAgent, AIFunction } = require('@jnode/ai');

const service = new GeminiService({ auth: 'your-gemini-api-key' });
const model = service.model('gemini-2.5-flash');

const agent = new AIAgent(model, {
  functions:[
    new AIFunction(
      'get_weather',
      'Get current weather for a location.',
      {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location']
      },
      async (args) => {
        return { weather: 'Sunny', temp: 25, location: args.location };
      }
    )
  ]
});

(async () => {
  const stream = agent.streamInteract('What is the weather in Taipei?');
  
  for await (const event of stream) {
    if (event.type === 'continue' && event.content) {
      process.stdout.write(event.content);
    }
  }
})();
```

## How it works?

Our world-leading **AI Agent** framework brings you a simple, fast, and extensible development experience across different AI providers.

Here's what `@jnode/ai` will do:

1. Define an **agent** with a **model** and specific configurations.
2. Build a **conversation** with the agent.
3. Use the **agent** or **conversation** to interact with the underlying model, executing built-in or custom **functions** automatically.

Pretty simple, isn't it?

Further, an **agent** holds configuration (like system instructions and generation options), and interactions seamlessly return or stream updated **conversation**s containing standard components (text, file, tool calls, and thoughts) allowing you to freely switch between models such as Claude, Gemini, and OpenAI.

------

# Reference

## Class: `ai.AIService`

A base class representing an AI service provider. Providers like `OAIChatService`, `GeminiService`, and `ClaudeService` extend or implement this interface.

### `new ai.AIService([options])`

- `options` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  - `baseUrl` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) The base URL for the API.
  - `auth` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Default authorization key/token.
  - Any provider-specific options.

### `service.model(name[, options])`

- `name` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) The unique model name (e.g., `'gpt-4o'`).
- `options`[\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) Options to override service-level options.
- Returns:[\<AIModel\>](#class-aiaimodel)

### `service.listModels([options])`

- `options`[\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) Request options overriding service auth.
- Returns: [\<Promise\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) Resolves to a list of models.

## Class: `ai.AIModel`

Represents an interactive AI model. Extended by provider-specific models like `OAIChatModel`, `GeminiModel`, and `ClaudeModel`.

### `new ai.AIModel(service, name[, options])`

- `service`[\<AIService\>](#class-aiaiservice) The parent service instance.
- `name`[\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Model name.
- `options` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) Model-specific options.

### `model.getInfo([options])`

- `options` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
- Returns:[\<Promise\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) Resolves to a structured object describing the model's metadata and capabilities (e.g., `features.reasoning`, `features.multimodalCapabilities`, `features.actions`).

### `model.interact(agent, conversation, context[, options])`

- `agent`[\<AIAgent\>](#class-aiaiaagent) | [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) The agent to base generation configs on.
- `conversation` [\<AIConversation\>](#class-aiaiconversation) | [\<Array\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array) | [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) The current message context.
- `context` [\<any\>] Context passed to underlying tool functions and actions.
- `options` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  - `auth` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Request authorization.
  - `maxActions` [\<number\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type) Maximum function execution loop steps before yielding back to the user. **Default:** `24`.
  - `canceledResult` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) Payload returned if a function execution gets intercepted/canceled.
- Returns: [\<Promise\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) Resolves to an [\<AIConversation\>](#class-aiaiconversation) containing the new messages and updated `meta`.

### `model.streamInteract(agent, conversation, context[, options])`

- Same parameters as[`model.interact()`](#modelinteractagent-conversation-context-options).
- Returns:[\<AsyncGenerator\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator) Yields stream events like `{ type: 'component', component }`, `{ type: 'continue', content }`, and `{ type: 'end', conversation }`.

## Class: `ai.AIAgent`

Holds the unified generation settings and tools.

### `new ai.AIAgent(model[, agent])`

- `model` [\<AIModel\>](#class-aiaimodel) The default model interface.
- `agent` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  - `temperature` [\<number\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type) Generation temperature `0.0`~`2.0`.
  - `topP` | `top_p` [\<number\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type) Top P `0.0`~`1.0`.
  - `topK` | `top_k` [\<number\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type) Top K `>= 1`.
  - `seed` [\<number\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type) Random seed.
  - `outputLimit` | `output_limit` [\<number\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type) Max output tokens limit.
  - `stopStrings` | `stop_strings` [\<string[]\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Array of stop sequences.
  - `logprobs` [\<boolean\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type) Enable log probabilities.
  - `frequencyPenalty` | `frequency_penalty` [\<number\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type) Frequency penalty `-2.0`~`2.0`.
  - `presencePenalty` | `presence_penalty` [\<number\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type) Presence penalty `-2.0`~`2.0`.
  - `thinkingLevel` | `thinking_level`[\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Extended reasoning level: `'none'`, `'low'`, `'medium'`, `'high'`.
  - `responseSchema` | `response_schema` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) JSON schema for structured JSON output.
  - `instructions` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) System prompt/core instructions.
  - `actions` [\<Array\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array) Array of inline functions or native actions.
  - `functions` [\<Array\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array) Array of tool functions.
  - `x`[\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) Platform/model specific data escapes.

### `agent.interact(conversation, context[, options])`

Shorthand for calling `interact()` on the agent's attached model.

### `agent.streamInteract(conversation, context[, options])`

Shorthand for calling `streamInteract()` on the agent's attached model.

## Class: `ai.AIConversation`

Represents a parsed conversation history format with unified components. Internally uses `role` and an array of `components` containing types like `text`, `thought`, `file`, `function_call`, `function_response`, and `action`.

### `new ai.AIConversation(agent[, conversation])`

- `agent` [\<AIAgent\>](#class-aiaiaagent) The agent handling the conversation context.
- `conversation` [\<Array\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array) |[\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Can be a single prompt string, a single component, an array of components, or an array of full message turns.

### `Static method: AIConversation.parse(conversation)`

- `conversation` [\<Array\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array) | [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
- Returns: [\<Array\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array) A correctly formatted conversation array of turns.

### `conversation.last`

- Type: [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) | `null`

Gets the last message turn in the conversation.

### `conversation.interact(conversation, context[, options])`

Pushes new conversation turns and interacts using the associated agent.

### `conversation.streamInteract(conversation, context[, options])`

Pushes new conversation turns and stream interacts using the associated agent.

### `conversation.push(conversation)`

Appends newly parsed message turns to the history.

### `conversation.clone()`

Returns a new instance of `AIConversation` cloning the same history and attached agent.

## Class: `ai.AIFunction`

### `new ai.AIFunction(name, description, parameters, fn[, options])`

- `name` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Function name.
- `description` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Function description.
- `parameters` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) JSON schema defining parameters.
- `fn` [\<Function\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function) The execution handler: `async (args, ctx) => any`. Can return raw data or an `AIFunctionResponse`.
- `options` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  - `response` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) Response JSON schema (optional).
  - `x` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) Provider-specific data.

### `function.getInfo()`

Returns function descriptors formatted for requests.

### `function.call(args, ctx)`

Executes the function safely, automatically wrapping raw results or errors in an `AIFunctionResponse`.

## Class: `ai.AIFunctionToolkit`

### `new ai.AIFunctionToolkit(functions)`

- `functions` [\<Array\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array) Array of `AIFunction` instances. When passed into an agent config, it will automatically unpack all tools from `.kit`.

## Class: `ai.AIRemoteFunction`

A remote network boundary API for evaluating standard `AIFunction` objects on remote servers.

### `new ai.AIRemoteFunction(url, config[, options])`

- `url` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Remote API server URL.
- `config` [\<any\>] Passed configurations.
- `options` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) Local cached descriptors and authorization headers.

## Class: `ai.AINativeAction`

A wrapper class explicitly to pass-through capabilities integrated at the LLM provider side (such as built-in search/code-execution).

### `new ai.AINativeAction(name, config)`

- `name` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) E.g., `'@google_search'` or `'@code_execution'`. Must start with `@`.
- `config`[\<any\>] Tool-specific configurations matching the native provider settings.

## Class: `ai.AIFunctionResponse`

Represents normalized tool/function execution result boundaries.

### `new ai.AIFunctionResponse(status, name, result[, attachments, meta])`

- `status` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Response status (e.g., `'success'`, `'error'`, or `'blocked'`).
- `name` [\<string\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type) Function execution name.
- `result` [\<any\>] Data payload directly serialized.
- `attachments` [\<Array\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
- `meta` [\<Object\>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

## Provider Interfaces

`@jnode/ai` currently builds in standard sub-modules connecting official endpoints:

- **OpenAI Chat** (`@jnode/ai/openai-chat`) exports `OAIChatService` and `OAIChatModel`.
- **Gemini** (`@jnode/ai/gemini`) exports `GeminiService` and `GeminiModel`.
- **Claude** (`@jnode/ai/claude`) exports `ClaudeService` and `ClaudeModel`.
