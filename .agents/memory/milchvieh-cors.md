---
name: Milchvieh CORS config
description: CORS must use an explicit origin allowlist, never origin:true with credentials; dev mode allows all *.repl.co subdomains
---

## Rule
CORS origin must never be `true` (reflects any origin) when `credentials: true` is set. Use an allowlist built from `REPLIT_DEV_DOMAIN` env var + comma-separated `ALLOWED_ORIGINS` env var.

**Why:** Reflecting arbitrary origins with credentials enabled allows any website to make authenticated requests on behalf of logged-in users (CSRF-equivalent).

**How to apply:** In `app.ts`, build `allowedOrigins` at startup. In development, also allow any origin ending in `.repl.co`, `.replit.dev`, or `.replit.app` — Replit preview iframes use dynamic janeway.repl.co subdomains that differ from `REPLIT_DEV_DOMAIN`. This wildcard is gated on `NODE_ENV !== "production"` only.

## Gotcha: REPLIT_DEV_DOMAIN ≠ preview iframe origin
`REPLIT_DEV_DOMAIN` is the canonical dev URL (e.g. `abc.repl.co`), but the workspace canvas iframe and browser preview use distinct subdomains like `b0e4b658-...-00-xyz.janeway.repl.co`. If the allowlist only contains the literal `REPLIT_DEV_DOMAIN`, all CORS requests from the preview fail with 500 even in development. The `isReplitPreviewOrigin()` helper in `app.ts` covers this.
