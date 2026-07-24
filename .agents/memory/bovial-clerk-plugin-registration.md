---
name: Clerk Expo plugin registration required
description: Missing "@clerk/expo" in app.json plugins silently drops ClerkExpo pod from iOS build
---

Rule: `"@clerk/expo"` must be listed in app.json `expo.plugins`, and iOS `deploymentTarget` must be >= 17.0 (set explicitly in expo-build-properties).

**Why:** ClerkExpo.podspec requires iOS 17. Without the Clerk config plugin, prebuild leaves the default target (15.1) and CocoaPods excludes ClerkExpo from the Pods-Bovial integration — pod install still succeeds, ExpoModulesProvider.swift still emits `import ClerkExpo`, and the archive fails with `no such module 'ClerkExpo'` with no ClerkExpo compile lines anywhere in the log.

**How to apply:** Diagnostic signature = sibling pod (ClerkGoogleSignIn) builds, ClerkExpo never appears in the build log, app target compiles for `arm64-apple-ios15.1`. Fix = register the plugin + set deploymentTarget 17.0; keep the CI `xcodebuild -resolvePackageDependencies` step as secondary stability for the ClerkKit SPM dependency.
