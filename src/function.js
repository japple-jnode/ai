/*
@jnode/ai/function.js
v2

Simple AI API package for Node.js.

by JustApple
*/

// dependencies
const { request } = require('@jnode/request');

// universal interactive model function
class AIFunction {
    constructor(name, description, parameters, fn, options = {}) {
        this.name = name; // function name, e.g. "get_weather"
        this.description = description; // function description
        this.parameters = parameters; // function call parameters in JSON Schema
        this.fn = fn; // the actual function to execute, fn(args, ctx)
        this.response = options.response; // function response schema in JSON Schema, optional
        this.x = options.x ?? {}; // platform/model specific data
    }

    // get info, may be async function
    getInfo() {
        return {
            name: this.name,
            description: this.description,
            parameters: this.parameters,
            response: this.response
        };
    }

    // call function, may (and commonly) is async function
    async call(args, ctx) {
        try {
            const result = await this.fn(args, ctx);
            return (result instanceof AIFunctionResponse) ? result : new AIFunctionResponse('success', this.name, result);
        } catch (err) {
            return (err.result instanceof AIFunctionResponse) ? err.result : new AIFunctionResponse(
                'error',
                this.name,
                err.result,
                { error: err.message, stack: err.stack }
            );
        }
    }
}

// universal interactive model function toolkit
class AIFunctionToolkit {
    constructor(functions = []) {
        this.kit = functions; // array of AIFunction
    }
}

// jai remote function
class AIRemoteFunction {
    constructor(url, config, options = {}) {
        this.url = url; // remote function URL
        this.config = config;
        this.authorization = options.authorization;
        this.name = options.name;
        this.description = options.description;
        this.parameters = options.parameters;
        this.response = options.response;
        this.x = options.x ?? {};
    }

    // get info from remote server
    async getInfo() {
        if (this._info) return this._info;

        const res = await request('GET', this.url, null, {
            'Authorization': this.authorization
        });

        if (res.statusCode !== 200) throw _requestError(res);

        const data = await res.json();

        this._info = {
            name: this.name ?? data.name,
            description: this.description ?? data.description,
            parameters: this.parameters ?? data.parameters,
            response: this.response ?? data.response,
            x: { ...this.x, ...data.x }
        };

        return this._info;
    }

    // call remote function
    async call(args, ctx) {
        const res = await request('POST', this.url + '/call', JSON.stringify({
            config: this.config,
            arguments: args,
            context: ctx
        }), {
            'Authorization': this.authorization,
            'Content-Type': 'application/json'
        });

        if (res.statusCode !== 200) throw _requestError(res);

        const data = await res.json();

        return new AIFunctionResponse(
            data.status,
            this.name,
            data.result,
            data.meta
        );
    }
}

// native actions
class AINativeAction {
    constructor(name = '', config) {
        this.name = name.startsWith('@') ? name : '@' + name; // native action name must start with '@'
        this.config = config;
    }

    // get info
    getInfo() {
        return {
            name: this.name,
            config: this.config
        };
    }
}

// function response
class AIFunctionResponse {
    constructor(status, name, result, attachments = [], meta = {}) {
        this.status = status; // "success", "error" or "blocked"
        this.name = name; // function name
        this.result = result; // function result
        this.attachments = attachments; // function result attachment files
        this.meta = meta; // additional meta info
    }
}

// error wfrom http request
function _requestError(res) {
    const err = new Error(`Request failed with code ${res.statusCode}.`);
    err.res = res;
    return err;
}

// export
module.exports = {
    AIFunction,
    AIFunctionToolkit,
    AIRemoteFunction,
    AINativeAction,
    AIFunctionResponse
};