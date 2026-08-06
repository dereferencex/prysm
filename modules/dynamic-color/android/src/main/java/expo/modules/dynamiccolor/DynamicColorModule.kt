package expo.modules.dynamiccolor

import android.content.res.Resources
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exposes the Android 12+ (API 31) Material You wallpaper palette as hex
 * strings so the app theme can follow the system accent.
 *
 * On Android 12+, `Resources.getSystem()` resolves the
 * `@android:color/system_accent*` and `@android:color/system_neutral*`
 * resources to the user's wallpaper-derived tonal palette. On older
 * versions (or stripped OEM builds where the resources are missing)
 * getPalette() returns null and JS falls back to the static theme.
 *
 * JS side (modules/dynamic-color/src/index.ts) caches the result and
 * merges the returned keys over the base Colors object in ThemeContext.
 * No permissions are needed — this only reads system color resources.
 */
class DynamicColorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DynamicColor")

    Function("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    }

    Function("getPalette") { isDark: Boolean ->
      readPalette(isDark)
    }
  }

  /**
   * Semantic theme keys → Android 12 system tonal palette tones.
   *
   * Tonal scale: low index (0) = lightest, high index (1000) = darkest.
   * The role mapping below follows the Material You role table from
   * AOSP (source.android.com/docs/core/display/dynamic-color):
   *   light  primary = accent1_600, background = neutral1_10,
   *          onBackground = neutral1_900
   *   dark   primary = accent1_200, background = neutral1_900,
   *          onBackground = neutral1_100
   */
  private fun toneMap(isDark: Boolean): Map<String, String> =
    if (isDark) {
      mapOf(
        "primary" to "system_accent1_200",
        "primaryLight" to "system_accent1_100",
        "text" to "system_neutral1_100",
        "textSecondary" to "system_neutral2_200",
        "buttonText" to "system_accent1_800",
        "tabIconDefault" to "system_neutral2_300",
        "tabIconSelected" to "system_accent1_200",
        "link" to "system_accent1_200",
        "backgroundRoot" to "system_neutral1_1000",
        "backgroundDefault" to "system_neutral1_900",
        "backgroundSecondary" to "system_neutral1_800",
        "backgroundTertiary" to "system_neutral1_700",
      )
    } else {
      mapOf(
        "primary" to "system_accent1_600",
        "primaryLight" to "system_accent1_400",
        "text" to "system_neutral1_1000",
        "textSecondary" to "system_neutral1_700",
        "buttonText" to "system_neutral1_0",
        "tabIconDefault" to "system_neutral1_600",
        "tabIconSelected" to "system_accent1_600",
        "link" to "system_accent1_600",
        "backgroundRoot" to "system_neutral1_100",
        "backgroundDefault" to "system_neutral1_0",
        "backgroundSecondary" to "system_neutral1_200",
        "backgroundTertiary" to "system_neutral1_300",
      )
    }

  private fun readPalette(isDark: Boolean): Map<String, String>? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
    val res = Resources.getSystem()
    val out = mutableMapOf<String, String>()
    for ((key, resName) in toneMap(isDark)) {
      val id = res.getIdentifier(resName, "color", "android")
      if (id != 0) {
        try {
          val color = res.getColor(id, null)
          out[key] = String.format("#%06X", color and 0xFFFFFF)
        } catch (_: Exception) {
          // Skip a single missing/odd resource; keep the rest of the
          // palette rather than failing the whole read.
        }
      }
    }
    return if (out.isEmpty()) null else out
  }
}
