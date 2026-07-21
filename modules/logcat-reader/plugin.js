const {
  withSettingsGradle,
  withAppBuildGradle,
} = require("expo/config-plugins");

/**
 * Expo config plugin for logcat-reader.
 *
 * Wires the native logcat-reader module into the Android build
 * (settings.gradle + app/build.gradle). No AndroidManifest changes are
 * needed — the module is purely in-process and reads the app's own logcat
 * via Runtime.exec('logcat -v threadtime --pid=<pid>').
 */
function withLogcatReader(config) {
  config = withSettingsGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(":logcat-reader")) {
      cfg.modResults.contents += `\ninclude ':logcat-reader'\nproject(':logcat-reader').projectDir = new File(rootProject.projectDir, '../modules/logcat-reader/android')\n`;
    }
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("logcat-reader")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        "dependencies {\n    implementation project(':logcat-reader')",
      );
    }
    return cfg;
  });

  return config;
}

module.exports = withLogcatReader;
