---
name: Clerk Expo SPM requires static frameworks
description: iOS pod install crash "undefined method 'package_product_dependencies' for nil" when @clerk/expo is installed
---

@clerk/expo's ClerkExpo.podspec attaches the ClerkKit/ClerkKitUI Swift Package (via RN's `spm_dependency` helper) directly to the ClerkExpo pod target. React Native's SPM integration (`spm.rb`) only works correctly when CocoaPods uses framework-based linkage — with the default static-library linkage, the pod's target isn't set up as a project the SPM manager can attach dependencies to, so `add_spm_to_target` receives `nil` and crashes.

**Why:** Hit exactly this during an EAS/native iOS build: pod install failed with `undefined method 'package_product_dependencies' for nil` inside `react-native/scripts/cocoapods/spm.rb`, triggered by `[SPM] Adding SPM dependency on product ["ClerkKit", "ClerkKitUI"]`.

**How to apply:** Any Expo app using `@clerk/expo` (native Clerk SDK, not just the JS SDK) must set static framework linkage via `expo-build-properties`:
```json
["expo-build-properties", { "ios": { "useFrameworks": "static" } }]
```
Add this plugin (installing `expo-build-properties` if missing) to `app.json`/`app.config` whenever `@clerk/expo` is a dependency, before running an iOS build.
