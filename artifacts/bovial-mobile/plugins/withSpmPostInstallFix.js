/**
 * withSpmPostInstallFix.js
 *
 * Fixes the RN 0.81.x SPM crash:
 *   "undefined method 'package_product_dependencies' for nil" (spm.rb:~80)
 *   "Could not find a Pods project target named '...'" (spm.rb:~24)
 *
 * Two complementary layers — both are idempotent:
 *
 *  LAYER 1 — Direct spm.rb patch (primary)
 *    Rewrites the two unguarded paths in
 *    node_modules/react-native/scripts/cocoapods/spm.rb with the same guards
 *    that patches/react-native.patch provides.  This works even when
 *    `pnpm install` is NOT run from the workspace root (e.g. Codemagic
 *    running from inside the app sub-directory, so pnpm's patchedDependencies
 *    mechanism is never triggered).
 *
 *  LAYER 2 — Podfile monkey-patch (belt-and-suspenders)
 *    Injects a Ruby class-reopening into the generated Podfile so that even
 *    if LAYER 1 somehow misses (different node_modules layout), the guarded
 *    SPMManager methods take precedence at pod-install time.
 *    Uses flexible anchor matching (no hard throw on miss — just a warning).
 */

const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// ─── Markers (used for idempotency checks) ────────────────────────────────────
const SPM_RB_GUARD1_MARKER  = "# [SPM-NIL-GUARD:target-nil]";
const SPM_RB_GUARD2_MARKER  = "# [SPM-NIL-GUARD:pkg-product-deps-nil]";
const PODFILE_MARKER        = "# --- withSpmPostInstallFix: RN 0.81.5 SPM nil-target guard ---";

// ─── LAYER 1: spm.rb direct patch ────────────────────────────────────────────
//
// Exact original patterns from the unpatched RN 0.81.5 spm.rb, taken from
// the diff in patches/react-native.patch.

// Guard 1 — nil target in apply_on_post_install
// Original: project.targets.find used inline in add_spm_to_target call, with a
//           second duplicate lookup afterwards and NO nil check.
const ORIG_INLINE_FIND = `          project,
          project.targets.find { |t| t.name == pod_name},`;

const PATCHED_INLINE_FIND = `          project,
          target,`;

const ORIG_DUPLICATE_LOOKUP = `        log " Adding workaround for Swift package not found issue"
        target = project.targets.find { |t| t.name == pod_name}
        target.build_configurations`;

const PATCHED_DUPLICATE_LOOKUP = `        log " Adding workaround for Swift package not found issue"
        target.build_configurations`;

// The outer each-block header: inject target lookup + nil guard before `dependencies.each`
const ORIG_EACH_HEADER = `    @dependencies_by_pod.each do |pod_name, dependencies|
      dependencies.each do |spm_spec|`;

const PATCHED_EACH_HEADER = `    @dependencies_by_pod.each do |pod_name, dependencies|
      ${SPM_RB_GUARD1_MARKER}
      target = project.targets.find { |t| t.name == pod_name}
      if target.nil?
        log_warning "Could not find a Pods project target named '\#{pod_name}' to attach Swift Package Manager dependencies to. Skipping SPM linkage for this pod (products: \#{dependencies.map{|i| i[:products]}.flatten.uniq.join(", ")}). This can happen when the pod's target is merged/renamed by CocoaPods; if the app crashes at runtime due to missing symbols, the SPM products may need to be linked manually in Xcode."
        next
      end
      dependencies.each do |spm_spec|`;

// Guard 2 — nil package_product_dependencies in add_spm_to_target
const ORIG_ADD_SPM_ANCHOR = `    ref_class = Xcodeproj::Project::Object::XCSwiftPackageProductDependency
    pkg = project.root_object`;

const PATCHED_ADD_SPM_ANCHOR = `    ref_class = Xcodeproj::Project::Object::XCSwiftPackageProductDependency
    ${SPM_RB_GUARD2_MARKER}
    if !target.respond_to?(:package_product_dependencies) || target.package_product_dependencies.nil?
      log_warning "Target '\#{target.name}' does not support Swift Package Manager product dependencies (package_product_dependencies is nil). Skipping SPM linkage for products \#{products.join(", ")}. This can happen when the pod's target is not a native target. If the app crashes at runtime due to missing symbols, the SPM products may need to be linked manually in Xcode."
      return
    end
    pkg = project.root_object`;

function patchSpmRb(projectRoot) {
  // Resolve spm.rb relative to the react-native package root
  let rnPkgJson;
  try {
    rnPkgJson = require.resolve("react-native/package.json", { paths: [projectRoot] });
  } catch (_) {
    // Fallback: walk up from projectRoot
    rnPkgJson = path.join(projectRoot, "node_modules", "react-native", "package.json");
  }
  const spmRbPath = path.join(path.dirname(rnPkgJson), "scripts", "cocoapods", "spm.rb");

  if (!fs.existsSync(spmRbPath)) {
    console.warn(`[SPM Fix] WARNING: spm.rb not found at ${spmRbPath} — skipping direct patch`);
    return;
  }

  let src = fs.readFileSync(spmRbPath, "utf8");

  // Idempotency: if both markers are already present, skip
  if (src.includes(SPM_RB_GUARD1_MARKER) && src.includes(SPM_RB_GUARD2_MARKER)) {
    console.log("[SPM Fix] spm.rb already patched — skipping");
    return;
  }

  let changed = false;

  // Apply Guard 1 (three sub-replacements, in dependency order)
  if (!src.includes(SPM_RB_GUARD1_MARKER)) {
    if (src.includes(ORIG_EACH_HEADER)) {
      src = src.replace(ORIG_EACH_HEADER, PATCHED_EACH_HEADER);
      changed = true;
      console.log("[SPM Fix] spm.rb Guard 1a applied (each-header + nil check)");
    } else {
      console.warn("[SPM Fix] WARNING: Guard 1a anchor not found in spm.rb — may already be patched or template changed");
    }

    if (src.includes(ORIG_INLINE_FIND)) {
      src = src.replace(ORIG_INLINE_FIND, PATCHED_INLINE_FIND);
      changed = true;
      console.log("[SPM Fix] spm.rb Guard 1b applied (inline find → target)");
    }

    if (src.includes(ORIG_DUPLICATE_LOOKUP)) {
      src = src.replace(ORIG_DUPLICATE_LOOKUP, PATCHED_DUPLICATE_LOOKUP);
      changed = true;
      console.log("[SPM Fix] spm.rb Guard 1c applied (removed duplicate target lookup)");
    }
  }

  // Apply Guard 2
  if (!src.includes(SPM_RB_GUARD2_MARKER)) {
    if (src.includes(ORIG_ADD_SPM_ANCHOR)) {
      src = src.replace(ORIG_ADD_SPM_ANCHOR, PATCHED_ADD_SPM_ANCHOR);
      changed = true;
      console.log("[SPM Fix] spm.rb Guard 2 applied (package_product_dependencies nil check)");
    } else {
      console.warn("[SPM Fix] WARNING: Guard 2 anchor not found in spm.rb — may already be patched or template changed");
    }
  }

  if (changed) {
    fs.writeFileSync(spmRbPath, src, "utf8");
    console.log(`[SPM Fix] spm.rb written: ${spmRbPath}`);
  }
}

// ─── LAYER 2: Podfile monkey-patch ───────────────────────────────────────────
//
// Reopens SPMManager in Ruby so the guarded methods take precedence even if
// the spm.rb direct patch above didn't apply (different node_modules layout,
// custom RN fork, etc.).
//
// Non-fatal if anchor not found: logs a warning and continues, because Layer 1
// already covers the real fix.

const PODFILE_RUBY_PATCH = `
${PODFILE_MARKER}
# Belt-and-suspenders: reopens SPMManager with nil-guarded methods so that
# even if the direct spm.rb patch (Layer 1) was not applied, pod install
# won't crash on a nil target or nil package_product_dependencies.
class SPMManager
  def apply_on_post_install(installer)
    project = installer.pods_project
    ::Pod::UI.puts '[SPM Fix] Cleaning old SPM dependencies from Pods project'
    clean_spm_dependencies_from_target(project, @dependencies_by_pod)
    ::Pod::UI.puts '[SPM Fix] Adding SPM dependencies to Pods project'
    @dependencies_by_pod.each do |pod_name, dependencies|
      target = project.targets.find { |t| t.name == pod_name }
      if target.nil?
        ::Pod::UI.puts "[SPM Fix] WARNING: could not find target '\#{pod_name}' — skipping SPM linkage (products: \#{dependencies.map { |i| i[:products] }.flatten.uniq.join(', ')})."
        next
      end
      dependencies.each do |spm_spec|
        add_spm_to_target(project, target, spm_spec[:url], spm_spec[:requirement], spm_spec[:products])
        target.build_configurations.each do |config|
          target.build_settings(config.name)['SWIFT_INCLUDE_PATHS'] ||= ['$(inherited)']
          search_path = '\${SYMROOT}/\${CONFIGURATION}\${EFFECTIVE_PLATFORM_NAME}/'
          unless target.build_settings(config.name)['SWIFT_INCLUDE_PATHS'].include?(search_path)
            target.build_settings(config.name)['SWIFT_INCLUDE_PATHS'].push(search_path)
          end
        end
      end
    end
  end

  def add_spm_to_target(project, target, url, requirement, products)
    pkg_class = Xcodeproj::Project::Object::XCRemoteSwiftPackageReference
    ref_class = Xcodeproj::Project::Object::XCSwiftPackageProductDependency
    if !target.respond_to?(:package_product_dependencies) || target.package_product_dependencies.nil?
      ::Pod::UI.puts "[SPM Fix] WARNING: target '\#{target.name}' does not support package_product_dependencies — skipping SPM linkage for \#{products.join(', ')}."
      return
    end
    pkg = project.root_object.package_references.find { |p| p.class == pkg_class && p.repositoryURL == url }
    if !pkg
      pkg = project.new(pkg_class)
      pkg.repositoryURL = url
      pkg.requirement = requirement
      project.root_object.package_references << pkg
    end
    products.each do |product_name|
      ref = target.package_product_dependencies.find { |r| r.class == ref_class && r.package == pkg && r.product_name == product_name }
      next if ref
      ref = project.new(ref_class)
      ref.package = pkg
      ref.product_name = product_name
      target.package_product_dependencies << ref
    end
  end
end
${PODFILE_MARKER}
`;

// Candidate anchor lines (tried in order; first match wins)
const PODFILE_ANCHORS = [
  // Standard RN 0.79+ format
  'require File.join(File.dirname(`node --print "require.resolve(\'react-native/package.json\')"`), "scripts/react_native_pods")',
  // Older format with single quotes
  "require File.join(File.dirname(`node --print \"require.resolve('react-native/package.json')\"`), \"scripts/react_native_pods\")",
  // Shortest reliable fallback: just the filename
  '"scripts/react_native_pods")',
  // Very last resort: match any react_native_pods require
  "react_native_pods",
];

function patchPodfile(podfilePath) {
  if (!fs.existsSync(podfilePath)) {
    console.warn(`[SPM Fix] Podfile not found at ${podfilePath} — skipping Podfile patch`);
    return;
  }

  let contents = fs.readFileSync(podfilePath, "utf8");

  if (contents.includes(PODFILE_MARKER)) {
    console.log("[SPM Fix] Podfile already has monkey-patch — skipping");
    return;
  }

  let anchorIndex = -1;
  let anchorLen = 0;
  for (const anchor of PODFILE_ANCHORS) {
    const idx = contents.indexOf(anchor);
    if (idx !== -1) {
      anchorIndex = idx;
      anchorLen = anchor.length;
      console.log(`[SPM Fix] Podfile anchor matched: "${anchor.slice(0, 60)}…"`);
      break;
    }
  }

  if (anchorIndex === -1) {
    console.warn(
      "[SPM Fix] WARNING: no anchor found in Podfile — Podfile monkey-patch skipped. " +
      "Layer 1 (direct spm.rb patch) should still cover the fix."
    );
    return;
  }

  const insertAt = anchorIndex + anchorLen;
  contents = contents.slice(0, insertAt) + "\n" + PODFILE_RUBY_PATCH + contents.slice(insertAt);
  fs.writeFileSync(podfilePath, contents);
  console.log("[SPM Fix] Podfile monkey-patch applied");
}

// ─── Config Plugin entry point ────────────────────────────────────────────────

function withSpmPostInstallFix(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");

      // Layer 1: patch spm.rb directly (survives any pnpm install strategy)
      patchSpmRb(projectRoot);

      // Layer 2: belt-and-suspenders Podfile monkey-patch
      patchPodfile(podfilePath);

      return cfg;
    },
  ]);
}

module.exports = withSpmPostInstallFix;
