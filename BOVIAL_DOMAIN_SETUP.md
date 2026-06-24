# Operator Runbook — bovial.com Custom Domain Setup

This runbook documents every step required to make the app available at
`https://bovial.com`. The www subdomain redirects to the apex domain at the
server level (301 permanent). Some steps require clicking in the Replit UI
or the DNS registrar panel — they cannot be automated in code.

---

## Status of each step

| Step | Who | Method | Status |
|------|-----|--------|--------|
| CORS allowlist (`ALLOWED_ORIGINS`) | Agent | Replit env var (production) | ✅ Done |
| `.env.example` documentation | Agent | Code | ✅ Done |
| Register custom domain in Replit | Operator | Replit UI | ⏳ Pending |
| DNS CNAME/A records at registrar | Operator | DNS panel | ⏳ Pending (after step above) |
| Clerk allowed origins (apex only) | Agent | Clerk Backend API (`configure-clerk-allowed-origins.ts`) | ✅ Done |
| Clerk redirect URLs (www removed) | Agent | Clerk Backend API + verified 2026-06-24 | ✅ Done |
| TLS certificate | Replit | Automatic | ⏳ Auto (after DNS verified) |

---

## 1. CORS — already configured

`ALLOWED_ORIGINS=https://bovial.com` is set as a production environment
variable. The API server (`artifacts/api-server/src/app.ts`) reads this at
startup and merges it into the CORS allowlist alongside the Replit-assigned
subdomains. The www subdomain is excluded because a server-level 301 redirect
(www → apex) is in place before any CORS handling. No further code change is needed.

---

## 2. Register bovial.com in the Replit Deployment UI

> **Must be done from the main project editor, not a task sub-environment.**

1. Open the project in the Replit editor.
2. Click **Publish** (top right) → scroll to **Custom Domains**.
3. Click **Add domain** and enter `bovial.com`.
4. Repeat for `www.bovial.com`.
5. Replit displays the required DNS records (CNAME or A). Copy them.
6. Replit will provision a TLS certificate automatically once DNS is verified.

---

## 3. Point DNS at Replit (at your registrar)

Using the records from step 2, add them in your domain registrar's DNS panel:

| Record type | Host | Value |
|-------------|------|-------|
| CNAME (or A) | `@` / `bovial.com` | value shown by Replit |
| CNAME (or A) | `www` | value shown by Replit |

DNS propagation typically takes a few minutes to a few hours depending on
your registrar's TTL settings. Replit will automatically detect propagation
and issue the TLS certificate.

---

## 4. Clerk auth and session configuration

### Why no cookie-domain changes are needed

The app uses **Clerk** for all authentication. Session state is carried via
a Bearer token in the `Authorization` header (not a browser cookie with a
domain attribute). This is confirmed by the SSE streaming flow and the
`requireAuth` middleware in `artifacts/api-server/src/lib/auth.ts`.

### Clerk Frontend API proxy — works on any domain automatically

`artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` proxies Clerk
Frontend API requests through `/api/__clerk`. The proxy dynamically reads the
`x-forwarded-host` header to construct the `Clerk-Proxy-Url` it sends to
Clerk's servers:

```
Clerk-Proxy-Url: https://<incoming-host>/api/__clerk
```

When a request arrives at `bovial.com`, the header becomes
`https://bovial.com/api/__clerk` — no hardcoded hostname, no additional
configuration.

### publishableKey resolves per host

In `app.ts`, `publishableKeyFromHost(getClerkProxyHost(req), ...)` selects
the correct publishable key for the incoming hostname. This is the standard
Replit-managed Clerk multi-domain pattern and works with bovial.com without
any code change.

### Clerk redirect URLs — verified clean ✅

Clerk's **User & Authentication → Redirects** (allowed redirect URLs) was
audited on 2026-06-24 via the Clerk Backend API:

```bash
# GET /v1/redirect_urls returns the full list of allowed redirect URLs
curl -s -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  https://api.clerk.com/v1/redirect_urls
# Output: []
```

The list is empty — `https://www.bovial.com` was never registered as an
allowed redirect URL, and no stale entries exist.

### Clerk allowed origins — already configured ✅

Even though the proxy works domain-agnostically, Clerk's security policy
requires every origin to be explicitly whitelisted in the instance settings
(`allowed_origins`).

Only the apex domain `https://bovial.com` is whitelisted.
`https://www.bovial.com` was removed on 2026-06-24 via `PATCH /v1/instance`
because the server-level 301 redirect (www → apex) fires before Clerk sees
any request — the www origin entry was dead config.

Verified via the Clerk Backend API after removal:

```bash
curl -s -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  https://api.clerk.com/v1/instance \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('allowed_origins'))"
# Output: ['https://bovial.com']
```

To re-verify or re-apply at any time (idempotent reconcile script):

```bash
pnpm --filter @workspace/api-server tsx src/scripts/configure-clerk-allowed-origins.ts
# Output when state is correct:
# ✅ allowed_origins already matches desired state — nothing to do.
# Desired: ["https://bovial.com"]
```

### UI-only cookies

The frontend sets a single `sidebar:state` cookie for UI persistence. This
cookie carries no domain attribute so it is scoped to whatever hostname the
browser is currently on. It will work on bovial.com without any change.

---

## 5. Smoke test after DNS is live

Run these checks from a browser or curl once bovial.com resolves:

```bash
# 1. TLS and app reachable
curl -I https://bovial.com

# 2. API health check
curl https://bovial.com/api/health

# 3. CORS: preflight from bovial.com origin should succeed
curl -I -X OPTIONS https://bovial.com/api/health \
  -H "Origin: https://bovial.com" \
  -H "Access-Control-Request-Method: GET"
# Expect: Access-Control-Allow-Origin: https://bovial.com

# 4. Full auth flow
# Open https://bovial.com in a browser and log in — verify the session
# persists across page reloads and no console errors appear.
```

---

## 6. Rollback / troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| CORS error in browser | ALLOWED_ORIGINS missing bovial.com | Check production env var is set to `https://bovial.com` |
| 401 on login | Clerk allowed origins not set | Complete step 4 in the Auth pane |
| `NET::ERR_CERT_AUTHORITY_INVALID` | TLS not yet provisioned | Wait for DNS propagation, then Replit auto-provisions cert |
| Clerk proxy returns 502 | Clerk FAPI unreachable | Transient; retry. Check `CLERK_SECRET_KEY` is set |
