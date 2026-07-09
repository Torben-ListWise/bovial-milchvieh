---
name: Clerk Expo SPM crash requires patching react-native's spm.rb
description: iOS pod install crash "undefined method 'package_product_dependencies' for nil" when @clerk/expo is installed
---

@clerk/expo's ClerkExpo.podspec attaches the ClerkKit/ClerkKitUI Swift Package (via RN's `spm_dependency` helper) to a Pods-project target found by name (`project.targets.find { |t| t.name == pod_name }`). In this project's setup (RN 0.81.5, New Architecture, prebuilt ReactNativeCore/Dependencies), that lookup returns `nil` — CocoaPods doesn't create/keep a target with that exact name — so `add_spm_to_target` calling `target.package_product_dependencies` crashes the whole `pod install`.

**Why:** Hit this repeatedly during EAS/native iOS builds. Tried `useFrameworks: "static"` then `"dynamic"` via expo-build-properties — **neither fixed it**; the crash is identical regardless of framework linkage mode. Framework linkage was a red herring; the real bug is upstream in `react-native/scripts/cocoapods/spm.rb` (confirmed via web search: known RN 0.81 bug, fix expected ~0.84).

**How to apply:** Patch `react-native`'s `scripts/cocoapods/spm.rb` to skip pods whose target can't be found instead of crashing, using pnpm's native patch feature (this is a pnpm monorepo — do NOT use patch-package):
```
pnpm patch react-native
# edit the file at the printed tmp path: scripts/cocoapods/spm.rb
# guard: `target = project.targets.find {...}; next if target.nil?` before using `target`
pnpm patch-commit '<tmp path>'
```
This writes `patches/react-native.patch` + a `patchedDependencies` entry in `pnpm-workspace.yaml`, which reapplies automatically on every `pnpm install` (including EAS Build's remote install). Verify the patch actually landed by grepping the specific `node_modules/.pnpm/react-native@*_patch_hash=*/` directory (not the unpatched one — multiple copies coexist).

**Caveat:** the nil-guard makes `pod install` succeed but *skips* linking the SPM products for that pod. If Clerk's native SDK needs ClerkKit/ClerkKitUI symbols at runtime, watch for missing-symbol crashes after a successful build and be ready to investigate manual Xcode-side SPM linking.

**Second crash point (same bug, different line):** after guarding the `target.nil?` case in `apply_on_post_install`, a real EAS build still crashed — this time inside `add_spm_to_target` itself, at `target.package_product_dependencies.find` ("undefined method 'package_product_dependencies' for nil"). The target *was* found this time, but it's not a native target type that exposes `package_product_dependencies` (nil instead of an array). Same root issue (RN 0.81 SPM integration assumes target shapes CocoaPods doesn't guarantee) — added a second guard at the top of `add_spm_to_target`: `if !target.respond_to?(:package_product_dependencies) || target.package_product_dependencies.nil? then log_warning(...); return; end`. Lesson: don't assume one nil-guard covers the whole SPMManager flow — both `apply_on_post_install` (target lookup) and `add_spm_to_target` (target shape) need independent nil-safety. Edit the patch in-place at `node_modules/.pnpm_patches/react-native@0.81.5/...` and re-run `pnpm patch-commit <dir>` (not `pnpm patch` again) to update the existing patch.
