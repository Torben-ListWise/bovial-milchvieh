---
name: EXConstants MODULE_NOT_FOUND in pnpm monorepo (iOS build)
description: getAppConfig.js (run from Pods/ExpoConstants/ at Xcode archive time) cannot find @expo/env or @expo/config unless they are explicit direct deps of the mobile package.
---

## Rule
Add `@expo/env` and `@expo/config` as explicit **devDependencies** in `artifacts/bovial-mobile/package.json`. Without this, the Codemagic iOS build fails with exit code 65 from the `Generate app.config for prebuilt Constants.manifest` Xcode script phase.

**Why:** expo-constants' `getAppConfig.js` is run by Xcode from `Pods/ExpoConstants/scripts/build/` at archive time. It calls `require('@expo/env')` and `require('@expo/config')`. Node.js walks up the directory tree: `Pods/ExpoConstants/` → `Pods/` → `ios/` → `artifacts/bovial-mobile/`. In pnpm, transitive deps are NOT symlinked into the package's own `node_modules/` unless they are listed as direct deps. So the walk-up hits `artifacts/bovial-mobile/node_modules/` and finds nothing → `MODULE_NOT_FOUND` → uncaught exception → exit 65.

**How to apply:** If the iOS build ever fails again with `exit 65` from `Generate app.config for prebuilt Constants.manifest`, first check if `@expo/env` and `@expo/config` are still in `bovial-mobile/package.json`. Also verify symlinks exist:
```
ls artifacts/bovial-mobile/node_modules/@expo/env
ls artifacts/bovial-mobile/node_modules/@expo/config
```

**Versions (as of last fix):**
- `@expo/env`: `~2.0.8` (installed: 2.0.11)
- `@expo/config`: `~12.0.13` (installed: 12.0.13)

The `PROJECT_ROOT` env var in codemagic.yaml is a separate (harmless) explicit set — it was NOT the root cause. The module resolution failure was the actual cause.
