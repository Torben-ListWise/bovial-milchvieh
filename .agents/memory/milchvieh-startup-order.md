---
name: Milchvieh server startup order
description: The API server must start listening before warming up the embedding model; .hf-cache is gitignored and excluded from production container
---

**Rule:** `httpServer.listen()` must be called **before** `warmupEmbeddingModel()`. The model warmup must run as a background task (void promise), not be awaited before listen.

**Why:** `.hf-cache/` is in `.gitignore` and therefore excluded from the production container image. In production, the server downloads ~280MB of ONNX model files at cold start. If the server only starts listening after warmup completes, the Replit autoscale health check at `GET /api/healthz` times out → deployment fails at the promote step (build succeeds, image pushes, but container never becomes healthy).

**How to apply:** The correct startup sequence in `src/index.ts` is:
1. `await ensureExtensions()` + `await setupAnalystSandbox()` (fast, must be done before listen)
2. `httpServer.listen(port, callback)`
3. Inside the listen callback: `void warmupEmbeddingModel().then(() => reembedLegacyDocs()).then(resumePendingIngestions)`

The health check returns 200 within ~0.2s of startup. Model warmup completes after ~11s with cached model; potentially 2–5 minutes on a true cold start without cache. Embedding requests made before warmup finishes will trigger lazy loading on first call.
