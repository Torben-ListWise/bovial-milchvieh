---
name: Clerk Expo SPM requires dynamic frameworks (NOT static)
description: iOS pod install crash "undefined method 'package_product_dependencies' for nil" when @clerk/expo is installed
---

@clerk/expo's ClerkExpo.podspec attaches the ClerkKit/ClerkKitUI Swift Package (via RN's `spm_dependency` helper) directly to the ClerkExpo pod target. React Native's SPM integration (`spm.rb`) has a known bug/limitation (as of RN 0.81, fix expected ~0.84): SPM package products can only be attached correctly when CocoaPods uses **dynamic** framework linkage. With **static** linkage (or default static-library linkage), `add_spm_to_target` receives a `nil` target and crashes.

**Why:** Hit this during an EAS/native iOS build: pod install failed with `undefined method 'package_product_dependencies' for nil` inside `react-native/scripts/cocoapods/spm.rb`, triggered by `[SPM] Adding SPM dependency on product ["ClerkKit", "ClerkKitUI"]`. First tried `useFrameworks: "static"` (a plausible-looking but wrong fix — plain library vs framework linkage was the wrong axis) and the crash persisted identically across two separate builds. Switching to `"dynamic"` matches RN's own SPM docs/community guidance: static linkage + SPM causes exactly this crash.

**How to apply:** Any Expo app using `@clerk/expo` (native Clerk SDK, not just the JS SDK) must set **dynamic** framework linkage via `expo-build-properties`:
```json
["expo-build-properties", { "ios": { "useFrameworks": "dynamic" } }]
```
Add this plugin (installing `expo-build-properties` if missing) to `app.json`/`app.config` whenever `@clerk/expo` is a dependency, before running an iOS build. Verify by running `npx expo prebuild --platform ios --no-install` and grepping `ios/Podfile.properties.json` for `"ios.useFrameworks": "dynamic"` — don't rely on log text alone, confirm the generated Podfile.
