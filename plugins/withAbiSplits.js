const { withAppBuildGradle } = require("expo/config-plugins");

function withAbiSplits(config) {
  if (process.env.PRYSM_FDROID === "1") {
    return config;
  }

  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (contents.includes("splits {")) {
      return config;
    }

    config.modResults.contents = contents.replace(
      "android {",
      `android {
    splits {
        abi {
            enable true
            reset()
            universalApk true
            include "armeabi-v7a", "arm64-v8a"
        }
    }`,
    );

    return config;
  });
}

module.exports = withAbiSplits;
