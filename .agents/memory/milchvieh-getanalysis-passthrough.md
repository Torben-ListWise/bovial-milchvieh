---
name: GetAnalysisResponse Zod passthrough
description: messages inner object schema must use .passthrough() or extra fields like widgetSpec/backQuestions are stripped by Zod before the API response reaches the frontend
---

## Rule

`GetAnalysisResponse` in `lib/api-zod/src/generated/api.ts` defines the messages array schema.
The inner `zod.object({...})` for each message must call `.passthrough()` so unknown fields survive `.parse()`.

**Why:** Zod's default `.object()` strips unknown keys on `.parse()`. Fields like `widgetSpec`, `backQuestions`, and `imageObjectPath` are not listed in the generated schema. Without `.passthrough()`, they are silently dropped before the API response is serialised — the frontend receives `widgetSpec: undefined` and any widget or form depending on it never renders.

**How to apply:** After any `orval` codegen run that regenerates `lib/api-zod/src/generated/api.ts`, re-add `.passthrough()` to the messages inner object:

```ts
// in GetAnalysisResponse, the messages array:
"messages": zod.array(zod.object({
  ...
  "createdAt": zod.coerce.date()
}).passthrough())   // ← must be here
})
```

The closing parentheses count: `}` closes object literal, `)` closes `zod.object(`, `.passthrough()`, `)` closes `zod.array(`.
