const {
  withSettingsGradle,
  withAppBuildGradle,
} = require("expo/config-plugins");

/**
 * Expo config plugin for dynamic-color.
 *
 * Wires the native dynamic-color module into the Android build
 * (settings.gradle + app/build.gradle). No AndroidManifest changes are
 * needed — the module only reads system color resources via
 * Resources.getSystem(), which needs no permissions.
 */
function withDynamicColor(config) {
  config = withSettingsGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(":dynamic-color")) {
      cfg.modResults.contents += `\ninclude ':dynamic-color'\nproject(':dynamic-color').projectDir = new File(rootProject.projectDir, '../modules/dynamic-color/android')\n`;
    }
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("dynamic-color")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        "dependencies {\n    implementation project(':dynamic-color')",
      );
    }
    return cfg;
  });

  return config;
}

module.exports = withDynamicColor;
