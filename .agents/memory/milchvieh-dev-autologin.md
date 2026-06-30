---
name: Milchvieh DevAutoLogin lockout
description: DevAutoLogin catch block must not reset attemptedRef — causes infinite retry loop and Clerk account lockout
---

# DevAutoLogin Retry-Loop Bug

## The Rule
Never reset `attemptedRef.current = false` in the catch block of `DevAutoLogin` in `artifacts/milchvieh/src/App.tsx`.

**Why:** If the Clerk login attempt fails (wrong password, expired credentials, or any transient error), resetting the ref allows the `useEffect` to fire again on the next render cycle. React re-renders frequently, so this creates a tight retry loop that exhausts Clerk's brute-force protection (100 attempts) within seconds, permanently locking the dev account for 1 hour.

**How to apply:** On login failure, call `notifyDevAutoLoginDone()` to unblock the UI but leave `attemptedRef.current = true`. The user sees the normal sign-in screen and can log in manually. The fix is already applied — do not revert it.

## Symptoms
- Clerk "Account Locked" security email after running the dev server with incorrect `VITE_DEV_AUTO_LOGIN_PASSWORD`
- Email shows "Failed attempts: 100"
- Account auto-unlocks after 1 hour

## Clerk email language note
Clerk's transactional security emails (Account Locked, verification codes) are sent in English by Replit-managed Clerk — there is no code-level override for these. Only the sign-in/sign-up UI components are localized via the `localization={deDE}` prop on `<ClerkProvider>`. App-generated emails via Resend (`emailService.ts`) are already in German.
