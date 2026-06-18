---
name: Milchvieh CORS config
description: CORS must use an explicit origin allowlist, never origin:true with credentials
---

## Rule
CORS origin must never be `true` (reflects any origin) when `credentials: true` is set — this is a security misconfiguration. Use an allowlist built from `REPLIT_DEV_DOMAIN` env var + comma-separated `ALLOWED_ORIGINS` env var. Server-to-server calls (no Origin header) are always allowed.

**Why:** Reflecting arbitrary origins with credentials enabled allows any website to make authenticated requests on behalf of logged-in users (CSRF-equivalent for cookie/Bearer flows).

**How to apply:** In `app.ts`, build `allowedOrigins` array at startup. Pass a callback to `cors({ origin: callback })` that checks `!origin || allowedOrigins.includes(origin)`. When `allowedOrigins` is empty (local dev with no env), fall through to allow (fail-open is acceptable in dev).
