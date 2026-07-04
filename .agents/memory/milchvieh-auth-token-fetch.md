---
name: Milchvieh auth token in manual fetch
description: Why manual fetch() calls must use getAuthToken() not Clerk's getToken() — dev-bypass token vs real Clerk JWT
---

## The Rule

In any `fetch()` call inside the milchvieh frontend, always use:

```ts
import { getAuthToken } from "@workspace/api-client-react";
const token = await getAuthToken();
```

**Never** use Clerk's `useAuth().getToken()` directly for API requests.

**Why:**

In dev, `App.tsx`'s `ClerkAuthTokenSetup` calls `setAuthTokenGetter(() => Promise.resolve("dev-bypass-<userId>"))` when `VITE_DEV_BYPASS_USER_ID` is set. The API server's `requireAuth` accepts this bypass token unconditionally.

`customFetch` (used by all orval/api-client-react hooks) reads from this getter → works. Manual `fetch()` calls that used Clerk's `getToken()` return a real Clerk JWT instead → `getAuth(req)` in the Express server fails to validate it in dev → **401 Nicht angemeldet**.

**How to apply:**

- Remove `import { useAuth } from "@clerk/react"` from any page that only used it for `getToken`.
- Add `getAuthToken` to the import from `@workspace/api-client-react`.
- Replace `await getToken()` with `await getAuthToken()` everywhere.
- `getAuthToken()` falls back to `null` if no getter is set (pre-auth state), same as `getToken()`.
