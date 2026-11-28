const { withMainActivity } = require("expo/config-plugins");

const REPEAT_INTERVAL_MS = 140;
const REPEAT_INTERVAL_SIGNATURE = `private const val DPAD_REPEAT_INTERVAL_MS = ${REPEAT_INTERVAL_MS}L`;

function insertOnce(contents, anchor, insertion, description) {
  const index = contents.indexOf(anchor);
  if (index === -1) {
    throw new Error(`Could not add TV D-pad repeat handling: ${description}`);
  }
  return (
    contents.slice(0, index) + insertion + contents.slice(index + anchor.length)
  );
}

function withTvDpadRepeatLimit(config) {
  return withMainActivity(config, (config) => {
    const mainActivity = config.modResults;
    if (mainActivity.language !== "kt") {
      throw new Error(
        "TV D-pad repeat handling requires a Kotlin MainActivity",
      );
    }

    let contents = mainActivity.contents;
    if (contents.includes(REPEAT_INTERVAL_SIGNATURE)) {
      return config;
    }

    contents = insertOnce(
      contents,
      "import android.os.Bundle\n",
      "import android.os.SystemClock\nimport android.view.KeyEvent\n",
      "Android key event imports",
    );
    contents = insertOnce(
      contents,
      "class MainActivity : ReactActivity() {\n",
      `  private val isTvDevice: Boolean by lazy {
    packageManager.hasSystemFeature("android.hardware.type.television") ||
      packageManager.hasSystemFeature("android.software.leanback")
  }
  private var lastDpadRepeatAt = 0L

`,
      "TV device state",
    );
    contents = insertOnce(
      contents,
      "  override fun onCreate(savedInstanceState: Bundle?) {\n",
      `  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (isTvDevice && event.action == KeyEvent.ACTION_DOWN && isDpadDirection(event.keyCode)) {
      val now = SystemClock.uptimeMillis()
      if (event.repeatCount > 0 && now - lastDpadRepeatAt < DPAD_REPEAT_INTERVAL_MS) {
        return true
      }
      lastDpadRepeatAt = now
    }
    return super.dispatchKeyEvent(event)
  }

`,
      "directional key repeat filter",
    );

    const classEnd = contents.lastIndexOf("\n}");
    if (classEnd === -1) {
      throw new Error("Could not add TV D-pad repeat handling: class end");
    }
    contents =
      contents.slice(0, classEnd) +
      `

  private fun isDpadDirection(keyCode: Int): Boolean =
    keyCode == KeyEvent.KEYCODE_DPAD_UP ||
      keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
      keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
      keyCode == KeyEvent.KEYCODE_DPAD_RIGHT

  companion object {
    ${REPEAT_INTERVAL_SIGNATURE}
  }` +
      contents.slice(classEnd);

    mainActivity.contents = contents;
    return config;
  });
}

module.exports = withTvDpadRepeatLimit;
