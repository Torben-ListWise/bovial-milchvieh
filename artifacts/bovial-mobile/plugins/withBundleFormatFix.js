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
 * contains:
 *
 *   if [ "$BUNDLE_FORMAT" == "shallow" ]; then ...
 *   elif [ "$BUNDLE_FORMAT" == "deep" ]; then ...
 *   else echo "Unsupported bundle format: $BUNDLE_FORMAT"; exit 1
 *
 * So when BUNDLE_FORMAT is empty, the build fails with exit code 1.
 *
 * Fix: Inject a CocoaPods post_install hook that sets
 *   BUNDLE_FORMAT = shallow
 * as an explicit build setting on the EXConstants pod target.
 * Xcode then passes it as an environment variable when running the
 * EXConstants script phase, and the script succeeds.
 *
 * This approach avoids patching files in the pnpm store (which are
 * read-only on macOS CI environments), and instead modifies the
 * generated Pods.xcodeproj via the standard CocoaPods post_install hook.
 */

const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# --- withBundleFormatFix: EXConstants BUNDLE_FORMAT=shallow (Xcode 16) ---";

const PODFILE_HOOK = `
${MARKER}
# EXConstants's get-app-config-ios.sh exits 1 when $BUNDLE_FORMAT is unset.
# Xcode 16 stopped setting it for resource-bundle targets. This hook sets
# the build setting on the EXConstants pod target so Xcode always passes
# BUNDLE_FORMAT=shallow when running the script phase.
post_install do |installer|
  installer.pods_project.targets.each do |target|
    next unless target.name == 'EXConstants'
    target.build_configurations.each do |config|
      config.build_settings['BUNDLE_FORMAT'] ||= 'shallow'
    end
    ::Pod::UI.puts '[BundleFormatFix] Set BUNDLE_FORMAT=shallow on EXConstants target'
  end
end
${MARKER}
`;

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

      contents = contents.trimEnd() + "\n" + PODFILE_HOOK + "\n";
      fs.writeFileSync(podfilePath, contents);
      console.log("[BundleFormatFix] Podfile patched — BUNDLE_FORMAT=shallow hook added");

      return cfg;
    },
  ]);
}

module.exports = withBundleFormatFix;
