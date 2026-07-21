const {
  withSettingsGradle,
  withAppBuildGradle,
} = require("expo/config-plugins");

/**
 * Expo config plugin for crash-handler.
 *
 * Wires the native JVM uncaught-exception handler module into the Android
 * build (settings.gradle + app/build.gradle). No AndroidManifest changes
 * are needed — the module self-installs via its onCreate lifecycle hook.
 */
function withCrashHandler(config) {
  // 1. Include the local module in settings.gradle
  config = withSettingsGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(":crash-handler")) {
      cfg.modResults.contents += `\ninclude ':crash-handler'\nproject(':crash-handler').projectDir = new File(rootProject.projectDir, '../modules/crash-handler/android')\n`;
    }
    return cfg;
  });

  // 2. Add the module as a dependency in app/build.gradle
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("crash-handler")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        "dependencies {\n    implementation project(':crash-handler')",
      );
    }
    return cfg;
  });

  return config;
}

module.exports = withCrashHandler;
