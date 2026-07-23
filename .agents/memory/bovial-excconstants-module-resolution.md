---
name: EXConstants iOS build failure (Codemagic + pnpm + Xcode 16)
description: get-app-config-ios.sh runs from the real npm package path (not Pods/); BUNDLE_FORMAT unset in Xcode 16 causes exit 1 — patch the pnpm-resolved file.
---

## The rule

The `EXConstants` Xcode script phase (`[CP-User] Generate app.config for prebuilt Constants.manifest`) runs `get-app-config-ios.sh` **directly from the expo-constants npm package path** — NOT from `Pods/EXConstants/` or `Pods/ExpoConstants/`. Patching files inside `Pods/` has zero effect.

## How the script is invoked

Podspec (`ios/EXConstants.podspec`) script_phase:
```
bash -l -c "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"
```

`PODS_TARGET_SRCROOT` = absolute path to the `ios/` subdir of the expo-constants package
(e.g. `bovial-mobile/node_modules/expo-constants/ios`).

So `../scripts/get-app-config-ios.sh` = `bovial-mobile/node_modules/expo-constants/scripts/get-app-config-ios.sh`.

Inside the script, `EXPO_CONSTANTS_PACKAGE_DIR` is resolved via `pwd -P`, which follows pnpm symlinks to the real pnpm store path. The script then calls `${EXPO_CONSTANTS_PACKAGE_DIR}/scripts/getAppConfig.js` (there's a tiny re-export shim at `scripts/getAppConfig.js`; the compiled file is at `scripts/build/getAppConfig.js`).

## Root cause of Xcode 16 failure

`BUNDLE_FORMAT` is not set by Xcode 16 for resource bundle targets. The script exits 1 in the `else` branch of the `if [ "$BUNDLE_FORMAT" == "shallow" ]` check (neither shallow nor deep matches empty string).

## The fix (codemagic.yaml, after pod install)

Resolve the pnpm symlink and patch the REAL file in the pnpm store:

```bash
LINK="${CM_BUILD_DIR}/artifacts/bovial-mobile/node_modules/expo-constants"
EXPO_CONSTANTS_DIR="$(cd "$LINK" && pwd -P)"
SH="$EXPO_CONSTANTS_DIR/scripts/get-app-config-ios.sh"
# python3: insert BUNDLE_FORMAT="${BUNDLE_FORMAT:-shallow}" before the if-check
```

**Why:** `pwd -P` resolves the pnpm symlink so we patch the real file that Xcode will execute. Patching `Pods/EXConstants/` is a dead end — those files are never executed.

## Pod name facts

- CocoaPods pod name: `EXConstants` (podspec: `ios/EXConstants.podspec`)
- Xcode build target: `EXConstants`
- Pods directory: `Pods/EXConstants/` (NOT `Pods/ExpoConstants/`)
- Irrelevant for the fix — patch the npm package, not Pods

## Node / @expo/config resolution

`getAppConfig.js` requires `@expo/config`. Since pnpm stores expo-constants with its own isolated `node_modules`, Node.js walk-up from the resolved pnpm store path finds `@expo/config` in the adjacent pnpm store `node_modules`. No extra NODE_PATH injection needed for this require.
