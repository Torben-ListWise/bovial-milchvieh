---
name: CocoaPods post_install uniqueness
description: CocoaPods 1.x enforces exactly one post_install hook; adding a second causes a fatal Podfile error
---

Only ONE `post_install do |installer|` block is allowed in a Podfile.

**Why:** CocoaPods raises `[!] Specifying multiple post_install hooks is unsupported.` and aborts `pod install` if it finds more than one.

**How to apply:** Expo config plugins that need to run code in post_install must find the existing `post_install do |installer|` line (using `contents.indexOf`) and inject their Ruby code immediately after it — never append a new block at the end of the file. See `withBundleFormatFix.js` for the pattern.
