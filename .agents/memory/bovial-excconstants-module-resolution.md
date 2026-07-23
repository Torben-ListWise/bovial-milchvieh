---
name: EXConstants MODULE_NOT_FOUND in pnpm monorepo (iOS build)
description: getAppConfig.js (run from Pods/ExpoConstants/ at Xcode archive time) cannot find @expo/env or @expo/config — three approaches tried; only require.resolve({paths}) is reliable.
---

## Rule
Both must be in place for Codemagic iOS builds to succeed:

1. `@expo/env ~2.0.8` and `@expo/config ~12.0.13` as explicit **devDependencies** in `bovial-mobile/package.json` (so pnpm creates symlinks in `bovial-mobile/node_modules/`)
2. A codemagic.yaml step **after** `pod install` that overwrites `Pods/ExpoConstants/scripts/build/getAppConfig.js` with a patched version using `require.resolve('@expo/env', { paths: [projectRoot + '/node_modules'] })` instead of bare `require('@expo/env')`.

**Why:** `getAppConfig.js` runs from `Pods/ExpoConstants/scripts/build/` at Xcode archive time. Three approaches were tried and failed before this one:
1. Node.js walk-up — reaches `bovial-mobile/node_modules/` which has symlinks, but unreliable in Xcode's sandboxed environment
2. NODE_PATH via `.xcode.env` — `with-node.sh` sources it, but `PODS_ROOT` may not be set in Xcode 26.4.1 making the source a no-op
3. **`require.resolve({ paths: [...] })`** — patches the script directly; the most robust approach since it bypasses all environment-dependent resolution

**How to apply:** See `codemagic.yaml` step "Patch EXConstants getAppConfig.js (pnpm monorepo fix)". Includes a dry-run test after patching so real errors appear in codemagic logs, not inside Xcode's opaque exit-65.

**Versions:** `@expo/env ~2.0.8` (installed: 2.0.11), `@expo/config ~12.0.13` (installed: 12.0.13)
