/**
 * withBundleFormatFix.js
 *
 * Fixes the EXConstants (expo-constants) build failure on Xcode 16:
 *
 *   "Unsupported bundle format: "
 *   exit 1 in get-app-config-ios.sh
 *
 * Root cause: Xcode 16 no longer sets BUNDLE_FORMAT for resource-bundle
 * targets (like EXConstants.bundle). The script get-app-config-ios.sh
 * checks `$BUNDLE_FORMAT` and exits 1 when it's empty.
 *
 * Fix: inject Ruby code INTO the existing CocoaPods post_install block
 * (CocoaPods 1.x supports only one post_install hook — adding a second
 * one causes "Specifying multiple post_install hooks is unsupported").
 *
 * The injected code sets BUNDLE_FORMAT = shallow as an Xcode build
 * setting on the EXConstants pod target so the script phase always sees
 * BUNDLE_FORMAT=shallow at build time.
 */

const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# [BundleFormatFix] BUNDLE_FORMAT=shallow injected";

// Ruby snippet to inject INSIDE the existing post_install block.
// Indented with 2 spaces to match typical Podfile style.
const RUBY_SNIPPET = `
  ${MARKER}
  installer.pods_project.targets.each do |target|
    next unless target.name == 'EXConstants'
    target.build_configurations.each do |config|
      config.build_settings['BUNDLE_FORMAT'] ||= 'shallow'
    end
    ::Pod::UI.puts '[BundleFormatFix] Set BUNDLE_FORMAT=shallow on EXConstants target'
  end
`;

// Anchors tried in order; we inject immediately after the first match.
// Expo prebuild generates "post_install do |installer|" in the Podfile.
const POST_INSTALL_ANCHORS = [
  "post_install do |installer|",
  "post_install do |installer| #",
];

function withBundleFormatFix(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");

      if (!fs.existsSync(podfilePath)) {
        console.warn("[BundleFormatFix] Podfile not found — skipping");
        return cfg;
      }

      let contents = fs.readFileSync(podfilePath, "utf8");

      if (contents.includes(MARKER)) {
        console.log("[BundleFormatFix] Already patched — skipping");
        return cfg;
      }

      let anchorIdx = -1;
      let anchorLen = 0;
      for (const anchor of POST_INSTALL_ANCHORS) {
        const idx = contents.indexOf(anchor);
        if (idx !== -1) {
          anchorIdx = idx;
          anchorLen = anchor.length;
          console.log(`[BundleFormatFix] Found anchor: "${anchor}"`);
          break;
        }
      }

      if (anchorIdx === -1) {
        console.warn(
          "[BundleFormatFix] WARNING: 'post_install do |installer|' not found in Podfile. " +
          "Cannot inject BUNDLE_FORMAT fix. The codemagic.yaml backup patch step will handle it."
        );
        return cfg;
      }

      // Insert Ruby snippet immediately after the anchor line
      const insertAt = anchorIdx + anchorLen;
      contents = contents.slice(0, insertAt) + RUBY_SNIPPET + contents.slice(insertAt);
      fs.writeFileSync(podfilePath, contents);
      console.log("[BundleFormatFix] Injected BUNDLE_FORMAT=shallow into existing post_install block");

      return cfg;
    },
  ]);
}

module.exports = withBundleFormatFix;
