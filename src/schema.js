/*
JustAI/src/schema.js

Simple AI API package for Node.js.

by JustNode Dev Team / JustApple
*/

// basic schema
class Schema {
    constructor(type, description, options = {}) {
        this.type = type;
        this.description = description;
        this.options = {};
    }

    toJSON() {
        return { type: this.type, description: this.description, ...(this.options) };
    }
}

// string schema
class StringSchema extends Schema {
    constructor(description, options) {
        super('STRING', description, options);
    }
}

// number schema
class NumberSchema extends Schema {
    constructor(description, options) {
        super('NUMBER', description, options);
    }
}

// integer schema
class IntegerSchema extends Schema {
    constructor(description, options) {
        super('INTEGER', description, options);
    }
}

// boolean schema
class BooleanSchema extends Schema {
    constructor(description, options) {
        super('BOOLEAN', description, options);
    }
}

// array schema
class ArraySchema extends Schema {
    constructor(itemSchema, description, options = {}) {
        options.items = itemSchema;
        super('ARRAY', description, options);
    }
}

// object schema
class ObjectSchema extends Schema {
    constructor(properties = {}, description, options = {}) {
        options.properties = properties;
        super('OBJECT', description, options);
    }
}

// null schema
class NullSchema extends Schema {
    constructor(description, options) {
        super('NULL', description, options);
    }
}

// any of schema
class AnyOfSchema extends Schema {
    constructor(schemas = [], description, options = {}) {
        options.anyOf = schemas;
        super(undefined, description, options);
    }
}

module.exports = {
    Schema,
    StringSchema,
    NumberSchema,
    IntegerSchema,
    BooleanSchema,
    ArraySchema,
    ObjectSchema,
    NullSchema,
    AnyOfSchema
};