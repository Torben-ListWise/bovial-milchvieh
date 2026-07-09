const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# --- withSpmPostInstallFix: RN 0.81.5 SPM nil-target guard ---";

const RUBY_PATCH = `
${MARKER}
# Works around a crash in react-native 0.81.5's scripts/cocoapods/spm.rb
# ("undefined method 'package_product_dependencies' for nil"), triggered when
# a Swift Package Manager dependency (e.g. ClerkKit/ClerkKitUI from @clerk/expo)
# is attached to a Pods project target that CocoaPods has merged/renamed/removed.
# Fixed upstream in RN >= 0.84; this reopens SPMManager with guarded versions
# of the two methods that previously crashed on nil.
class SPMManager
  def apply_on_post_install(installer)
    project = installer.pods_project
    ::Pod::UI.puts '[SPM Fix] Cleaning old SPM dependencies from Pods project'
    clean_spm_dependencies_from_target(project, @dependencies_by_pod)
    ::Pod::UI.puts '[SPM Fix] Adding SPM dependencies to Pods project'
    @dependencies_by_pod.each do |pod_name, dependencies|
      target = project.targets.find { |t| t.name == pod_name }
      if target.nil?
        ::Pod::UI.puts "[SPM Fix] WARNING: could not find target '#{pod_name}' to attach SPM dependencies to. Skipping (products: #{dependencies.map { |i| i[:products] }.flatten.uniq.join(", ")})."
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
      ::Pod::UI.puts "[SPM Fix] WARNING: target '#{target.name}' does not support SPM product dependencies (package_product_dependencies is nil). Skipping SPM linkage for products #{products.join(", ")}."
      return
    end
    pkg = project.root_object.package_references.find { |p| p.class == pkg_class && p.repositoryURL == url }
    if !pkg
      pkg = project.new(pkg_class)
      pkg.repositoryURL = url
      pkg.requirement = requirement
      ::Pod::UI.puts "[SPM Fix]  Adding package to workspace: #{pkg.inspect}"
      project.root_object.package_references << pkg
    end
    products.each do |product_name|
      ref = target.package_product_dependencies.find do |r|
        r.class == ref_class && r.package == pkg && r.product_name == product_name
      end
      next if ref
      ::Pod::UI.puts "[SPM Fix]  Adding product dependency #{product_name} to #{target.name}"
      ref = project.new(ref_class)
      ref.package = pkg
      ref.product_name = product_name
      target.package_product_dependencies << ref
    end
  end
end
${MARKER}
`;

function withSpmPostInstallFix(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile",
      );
      let contents = fs.readFileSync(podfilePath, "utf8");

      if (contents.includes(MARKER)) {
        return config;
      }

      const anchor =
        'require File.join(File.dirname(`node --print "require.resolve(\'react-native/package.json\')"`), "scripts/react_native_pods")';
      const anchorIndex = contents.indexOf(anchor);

      if (anchorIndex === -1) {
        throw new Error(
          "withSpmPostInstallFix: could not find react_native_pods require line in Podfile to anchor the SPM nil-target patch. The Podfile template may have changed.",
        );
      }

      const insertAt = anchorIndex + anchor.length;
      contents =
        contents.slice(0, insertAt) +
        "\n" +
        RUBY_PATCH +
        contents.slice(insertAt);

      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
}

module.exports = withSpmPostInstallFix;
