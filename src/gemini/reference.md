# Gemini API — HTTP Reference

> **Base URL:** `https://generativelanguage.googleapis.com`  
> **API version:** `v1beta` (stable features also available at `v1`)  
> **Last updated from source:** 2026-03-23  
> **Reference source:** <https://ai.google.dev/api>

---

## Authentication

All requests must include the API key either as a header or a query parameter.

**Preferred — header:**

```http
x-goog-api-key: $GEMINI_API_KEY
```

**Alternative — query parameter:**

```
?key=$GEMINI_API_KEY
```

Obtain a key at [Google AI Studio](https://aistudio.google.com/apikey).

---

## Primary Endpoint Categories

| Category | Transport | Description |
|---|---|---|
| `generateContent` | REST (HTTP/JSON) | Single-shot generation, full response |
| `streamGenerateContent` | SSE | Streamed generation chunks |
| `BidiGenerateContent` | WebSocket | Real-time bi-directional (Live API) |
| `batchGenerateContent` | REST | Batch of generateContent requests |
| `embedContent` | REST | Text → embedding vector |
| `countTokens` | REST | Count tokens before sending |
| `media.upload` / `files.*` | REST | File API — upload & manage media |
| `models.*` | REST | List / get model metadata |
| `cachedContents.*` | REST | Context caching |
| `models.predict` | REST | Imagen / Veo specialized generation |

---

## 1. Content Generation

### 1.1 `generateContent` — Standard (non-streaming)

```http
POST /v1beta/models/{model}:generateContent
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

**Path parameter:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `model` | string | ✅ | Model identifier, e.g. `models/gemini-2.5-flash` |

**Request body:**

```jsonc
{
  "contents": [                      // required — array of Content objects
    {
      "role": "user",                // "user" | "model"
      "parts": [
        { "text": "string" },                              // text part
        { "inline_data": { "mime_type": "image/jpeg",
                           "data": "<base64>" } },         // inline media
        { "file_data":   { "mime_type": "video/mp4",
                           "file_uri": "https://..." } }   // File API ref
      ]
    }
  ],
  "systemInstruction": {             // optional
    "parts": [{ "text": "You are a helpful assistant." }]
  },
  "tools": [                         // optional
    {
      "functionDeclarations": [
        {
          "name": "string",
          "description": "string",
          "parameters": { /* JSON Schema */ }
        }
      ]
    },
    { "codeExecution": {} },         // built-in code execution
    { "googleSearch": {} }           // grounding with Google Search
  ],
  "toolConfig": {                    // optional
    "functionCallingConfig": {
      "mode": "AUTO" | "ANY" | "NONE",
      "allowedFunctionNames": ["fn1"]
    }
  },
  "generationConfig": {              // optional
    "temperature": 1.0,
    "topP": 0.95,
    "topK": 40,
    "maxOutputTokens": 8192,
    "stopSequences": ["END"],
    "responseMimeType": "text/plain" | "application/json",
    "responseSchema": { /* JSON Schema — for structured output */ },
    "thinkingConfig": {
      "thinkingBudget": 1024         // tokens budget for thinking models
    },
    "candidateCount": 1,
    "seed": 42
  },
  "safetySettings": [                // optional
    {
      "category": "HARM_CATEGORY_HATE_SPEECH",
      "threshold": "BLOCK_MEDIUM_AND_ABOVE"
    }
  ],
  "cachedContent": "cachedContents/{id}" // optional — context cache ref
}
```

**Response body (`GenerateContentResponse`):**

```jsonc
{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [{ "text": "..." }]
      },
      "finishReason": "STOP",        // STOP | MAX_TOKENS | SAFETY | OTHER
      "safetyRatings": [ ... ],
      "index": 0
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 12,
    "candidatesTokenCount": 80,
    "totalTokenCount": 92,
    "thoughtsTokenCount": 0          // present for thinking models
  },
  "modelVersion": "gemini-2.5-flash",
  "responseId": "abc123"
}
```

**Minimal cURL example:**

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{
    "contents": [{ "parts": [{ "text": "Explain quantum entanglement." }] }]
  }'
```

---

### 1.2 `streamGenerateContent` — Streaming (SSE)

```http
POST /v1beta/models/{model}:streamGenerateContent
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

**Request body:** Identical to `generateContent`.

**Response:** A stream of Server-Sent Events, each containing a `GenerateContentResponse` chunk. Each chunk shares the same `responseId`.

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{ "contents": [{ "parts": [{ "text": "Tell me a story." }] }] }'
```

---

### 1.3 Multi-turn Chat (REST pattern)

The REST API is stateless. Manage history client-side by appending `Content` objects alternating `"user"` / `"model"` roles:

```jsonc
{
  "contents": [
    { "role": "user",  "parts": [{ "text": "Hello." }] },
    { "role": "model", "parts": [{ "text": "Hi! How can I help?" }] },
    { "role": "user",  "parts": [{ "text": "What is 2 + 2?" }] }
  ]
}
```

---

## 2. Models

### 2.1 List Models

```http
GET /v1beta/models?key=$GEMINI_API_KEY
```

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `pageSize` | integer | Max models per page (default 50, max 1000) |
| `pageToken` | string | Token from previous response for pagination |

**Response:**

```jsonc
{
  "models": [
    {
      "name": "models/gemini-2.5-flash",
      "baseModelId": "gemini-2.5-flash",
      "version": "2.5",
      "displayName": "Gemini 2.5 Flash",
      "description": "...",
      "inputTokenLimit": 1048576,
      "outputTokenLimit": 65536,
      "supportedGenerationMethods": ["generateContent", "countTokens"],
      "thinking": true,
      "temperature": 1.0,
      "maxTemperature": 2.0,
      "topP": 0.95,
      "topK": 40
    }
  ],
  "nextPageToken": "..."
}
```

### 2.2 Get Model

```http
GET /v1beta/models/{model}?key=$GEMINI_API_KEY
```

Returns a single `Model` object (same schema as above).

---

## 3. File API

Used to upload media files (images, audio, video, PDFs, text) for reuse across requests.

### 3.1 Upload a File (Resumable)

**Step 1 — Initiate upload:**

```http
POST /upload/v1beta/files?key=$GEMINI_API_KEY
Content-Type: application/json
X-Goog-Upload-Protocol: resumable
X-Goog-Upload-Command: start
X-Goog-Upload-Header-Content-Length: {NUM_BYTES}
X-Goog-Upload-Header-Content-Type: {MIME_TYPE}

{ "file": { "display_name": "my-file" } }
```

Response headers contain `x-goog-upload-url` — save it.

**Step 2 — Upload bytes:**

```http
POST {upload_url}
Content-Length: {NUM_BYTES}
X-Goog-Upload-Offset: 0
X-Goog-Upload-Command: upload, finalize

<binary file data>
```

Response body contains the `File` object including its `uri`.

### 3.2 List Files

```http
GET /v1beta/files?key=$GEMINI_API_KEY
```

### 3.3 Get File

```http
GET /v1beta/files/{name}?key=$GEMINI_API_KEY
```

### 3.4 Delete File

```http
DELETE /v1beta/files/{name}?key=$GEMINI_API_KEY
```

### File Object Schema

```jsonc
{
  "name": "files/abc123",
  "displayName": "my-file",
  "mimeType": "image/jpeg",
  "sizeBytes": "204800",
  "createTime": "2026-01-01T00:00:00Z",
  "updateTime": "2026-01-01T00:00:00Z",
  "expirationTime": "2026-01-03T00:00:00Z",  // files expire after 48 hours
  "sha256Hash": "...",
  "uri": "https://generativelanguage.googleapis.com/v1beta/files/abc123",
  "state": "ACTIVE"  // PROCESSING | ACTIVE | FAILED
}
```

**Reference an uploaded file in a prompt:**

```jsonc
{
  "parts": [
    { "text": "Describe this image." },
    { "file_data": { "mime_type": "image/jpeg", "file_uri": "https://..." } }
  ]
}
```

---

## 4. Embeddings

### 4.1 Embed Single Content

```http
POST /v1beta/models/{model}:embedContent
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

**Request body:**

```jsonc
{
  "content": {
    "parts": [{ "text": "Hello World!" }]
  },
  "taskType": "RETRIEVAL_QUERY",   // optional — see TaskType enum below
  "title": "string",               // optional — only for RETRIEVAL_DOCUMENT
  "outputDimensionality": 256      // optional — truncate embedding dimension
}
```

**TaskType enum values:**

| Value | Use case |
|---|---|
| `RETRIEVAL_QUERY` | Embed a search query |
| `RETRIEVAL_DOCUMENT` | Embed a document for retrieval |
| `SEMANTIC_SIMILARITY` | Measure text similarity |
| `CLASSIFICATION` | Text classification |
| `CLUSTERING` | Cluster texts |
| `QUESTION_ANSWERING` | Q&A |
| `FACT_VERIFICATION` | Fact checking |

**Response (`EmbedContentResponse`):**

```jsonc
{
  "embedding": {
    "values": [0.013, -0.027, ...]  // float array
  }
}
```

**Recommended model:** `gemini-embedding-001` (supports `outputDimensionality`)

### 4.2 Batch Embed Contents

```http
POST /v1beta/models/{model}:batchEmbedContents
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

**Request body:**

```jsonc
{
  "requests": [
    { "content": { "parts": [{ "text": "First string" }] } },
    { "content": { "parts": [{ "text": "Second string" }] } }
  ]
}
```

**Response:**

```jsonc
{
  "embeddings": [
    { "values": [...] },
    { "values": [...] }
  ]
}
```

---

## 5. Token Counting

```http
POST /v1beta/models/{model}:countTokens
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

**Request body (two mutually exclusive options):**

```jsonc
// Option A — pass raw contents
{
  "contents": [ { "parts": [{ "text": "..." }] } ]
}

// Option B — pass the full GenerateContentRequest (includes tools, system instructions, etc.)
{
  "generateContentRequest": {
    "model": "models/gemini-2.5-flash",
    "contents": [...],
    "systemInstruction": {...},
    "tools": [...]
  }
}
```

**Response:**

```jsonc
{
  "totalTokens": 42,
  "cachedContentTokenCount": 0   // present when cachedContent is used
}
```

---

## 6. Context Caching

Cache large, frequently-reused context (system instructions, documents, etc.) to reduce costs.

### 6.1 Create Cached Content

```http
POST /v1beta/cachedContents
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

**Request body:**

```jsonc
{
  "model": "models/gemini-2.5-flash",
  "systemInstruction": { "parts": [{ "text": "You are an expert." }] },
  "contents": [ { "role": "user", "parts": [{ "file_data": { ... } }] } ],
  "ttl": "3600s",                  // time-to-live (use either ttl or expireTime)
  "displayName": "my-cache"
}
```

**Response:** Returns a `CachedContent` object with a `name` field (`cachedContents/{id}`).

### 6.2 Use Cached Content

Reference it in any `generateContent` request:

```jsonc
{
  "cachedContent": "cachedContents/{id}",
  "contents": [{ "role": "user", "parts": [{ "text": "Summarize the document." }] }]
}
```

### 6.3 Other Cache Methods

| Method | HTTP | Path |
|---|---|---|
| List | `GET` | `/v1beta/cachedContents` |
| Get | `GET` | `/v1beta/cachedContents/{name}` |
| Update (TTL) | `PATCH` | `/v1beta/cachedContents/{name}` |
| Delete | `DELETE` | `/v1beta/cachedContents/{name}` |

---

## 7. Live API (WebSocket / Bi-directional Streaming)

```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=$GEMINI_API_KEY
```

The Live API uses WebSockets for real-time, low-latency audio/video/text interaction.

**Client → Server message types:**

| Type | Description |
|---|---|
| `setup` | Initial config (model, system instruction, tools) |
| `clientContent` | Send text or media turns |
| `realtimeInput` | Stream raw audio/video bytes continuously |
| `toolResponse` | Return results for tool calls |

**Server → Client message types:**

| Type | Description |
|---|---|
| `setupComplete` | Server ready |
| `serverContent` | Generated text/audio response chunks |
| `toolCall` | Model requests a function call |
| `toolCallCancellation` | Previous tool call cancelled |

See the [Live API reference](https://ai.google.dev/api/live) for full message schemas.

---

## 8. Batch API

For large-volume, non-time-sensitive requests (up to 90% cost discount).

### 8.1 Create a Batch Job

```http
POST /v1beta/models/{model}:batchGenerateContent
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

**Request body:**

```jsonc
{
  "requests": [
    { "contents": [{ "parts": [{ "text": "Prompt 1" }] }] },
    { "contents": [{ "parts": [{ "text": "Prompt 2" }] }] }
  ]
}
```

Returns a long-running `Operation` object. Poll with:

```http
GET /v1beta/operations/{operation_id}?key=$GEMINI_API_KEY
```

---

## 9. Specialized Generation (Imagen / Veo)

### 9.1 Image Generation — `models.predict`

```http
POST /v1beta/models/{imagen-model}:predict
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

**Request body:**

```jsonc
{
  "instances": [
    { "prompt": "A photorealistic image of a red fox in a snowy forest" }
  ],
  "parameters": {
    "sampleCount": 1,
    "aspectRatio": "16:9"
  }
}
```

### 9.2 Video Generation — `models.predictLongRunning`

```http
POST /v1beta/models/{veo-model}:predictLongRunning
Content-Type: application/json
x-goog-api-key: $GEMINI_API_KEY
```

Returns a long-running `Operation`. Poll until complete.

---

## 10. Key Request Body Types

### `Content` object

```jsonc
{
  "role": "user" | "model",
  "parts": [ /* Part[] */ ]
}
```

### `Part` object (union — use one field)

```jsonc
{ "text": "string" }
{ "inline_data": { "mime_type": "image/png", "data": "<base64>" } }
{ "file_data":   { "mime_type": "video/mp4", "file_uri": "https://..." } }
{ "function_call":   { "name": "fn", "args": { "key": "value" } } }
{ "function_response": { "name": "fn", "response": { "result": "..." } } }
{ "executable_code":  { "language": "PYTHON", "code": "print('hi')" } }
{ "code_execution_result": { "outcome": "OUTCOME_OK", "output": "hi\n" } }
```

### `GenerationConfig` object

```jsonc
{
  "temperature":       1.0,          // 0.0–2.0
  "topP":              0.95,
  "topK":              40,
  "candidateCount":    1,
  "maxOutputTokens":   8192,
  "stopSequences":     ["END"],
  "responseMimeType":  "text/plain" | "application/json",
  "responseSchema":    { /* JSON Schema */ },
  "seed":              42,
  "presencePenalty":   0.0,
  "frequencyPenalty":  0.0,
  "thinkingConfig": {
    "thinkingBudget":  1024          // -1 = dynamic
  }
}
```

### `SafetySetting` object

```jsonc
{
  "category":  "HARM_CATEGORY_HATE_SPEECH"
             | "HARM_CATEGORY_SEXUALLY_EXPLICIT"
             | "HARM_CATEGORY_DANGEROUS_CONTENT"
             | "HARM_CATEGORY_HARASSMENT"
             | "HARM_CATEGORY_CIVIC_INTEGRITY",
  "threshold": "BLOCK_NONE"
             | "BLOCK_LOW_AND_ABOVE"
             | "BLOCK_MEDIUM_AND_ABOVE"
             | "BLOCK_ONLY_HIGH"
}
```

---

## 11. Available Models (March 2026)

| Model ID | Type | Context | Notes |
|---|---|---|---|
| `gemini-3-pro-preview` | Multimodal | Large | Flagship reasoning + multimodal |
| `gemini-3-flash-preview` | Multimodal | Large | Frontier-class, cost-efficient |
| `gemini-2.5-flash` | Multimodal | 1M tokens | Thinking, fast, balanced |
| `gemini-2.5-flash-lite-preview` | Multimodal | 1M tokens | High-volume workhorse |
| `gemini-2.0-flash` | Multimodal | 1M tokens | Stable, widely supported |
| `gemini-2.0-flash-live-preview` | Live/Audio | — | Real-time audio-to-audio |
| `gemini-3.1-flash-live-preview` | Live/Audio | — | Latest Live audio model |
| `gemini-embedding-001` | Embedding | — | Text + multimodal embeddings |
| `imagen-3` | Image gen | — | Via `models.predict` |
| `veo-3` | Video gen | — | Via `models.predictLongRunning` |

> Use `GET /v1beta/models` to get the authoritative current list.

---

## 12. API Versions

| Version | Status | Notes |
|---|---|---|
| `v1` | Stable | Generally available features only |
| `v1beta` | Preview | All latest features; recommended for development |

---

## 13. Common HTTP Error Codes

| Code | Meaning | Common cause |
|---|---|---|
| `400` | Bad Request | Malformed JSON, invalid field |
| `401` | Unauthorized | Missing or invalid API key |
| `403` | Forbidden | Key lacks permission for model/feature |
| `404` | Not Found | Model or resource doesn't exist |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Transient server error — retry with backoff |
| `503` | Service Unavailable | Overloaded — retry with exponential backoff |

---

*Source: [ai.google.dev/api](https://ai.google.dev/api) — retrieved March 29, 2026*
