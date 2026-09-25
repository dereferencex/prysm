const { withAppBuildGradle } = require("expo/config-plugins");

const DEFAULT_ARCHS = "armeabi-v7a,arm64-v8a,x86,x86_64";

function withAbiSplits(config) {
  if (process.env.PRYSM_FDROID === "1") {
    return config;
  }

  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (contents.includes("splits {")) {
      return config;
    }

    // Derive the split ABI list from the effective `reactNativeArchitectures`
    // property so the per-ABI APKs always match the ABIs that were actually
    // compiled. Locally-built CMake libraries (notably libexpo-modules-core.so,
    // gated by expo-modules-core's `abiFilters(*reactNativeArchitectures())`)
    // are only produced for the architectures in this property. When EAS pins
    // a single architecture (e.g. -PreactNativeArchitectures=arm64-v8a) a
    // hardcoded split list would still emit an x86 APK missing that library,
    // crashing at launch with SoLoaderDSONotFoundError.
    config.modResults.contents = contents.replace(
      "android {",
      `android {
    splits {
        abi {
            enable true
            reset()
            universalApk true
            include(*(project.findProperty("reactNativeArchitectures") ?: "${DEFAULT_ARCHS}").split(","))
        }
    }`,
    );

    return config;
  });
}

module.exports = withAbiSplits;
