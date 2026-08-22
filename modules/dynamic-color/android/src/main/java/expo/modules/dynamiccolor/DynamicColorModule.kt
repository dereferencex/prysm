package expo.modules.dynamiccolor

import android.content.res.Configuration
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
 * versions, Android TV (static default palette only), or stripped OEM
 * builds where the resources are missing, getPalette() returns null and
 * JS falls back to the static theme.
 *
 * JS side (modules/dynamic-color/src/index.ts) caches the result and
 * merges the returned keys over the base Colors object in ThemeContext.
 * No permissions are needed — this only reads system color resources.
 */
class DynamicColorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DynamicColor")

    Function("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !isTvDevice()
    }

    Function("getPalette") { isDark: Boolean ->
      readPalette(isDark)
    }
  }

  /**
   * Semantic theme keys → Android 12 system tonal palette tones.
   *
   * Tonal scale: index 0 = lightest, index 1000 = darkest (verified
   * against AOSP core/res colors.xml: system_accent1_0 = #ffffff,
   * system_accent1_1000 = #000000).
   *
   * Surfaces intentionally avoid the extremes: neutral1_1000 is pure
   * black and neutral1_50 is near-white, which read as "unchanged but
   * dirtier" next to the static theme. The _600.._900 / _0.._200 ranges
   * below mirror the static dark (#0F/#1A/#2A/#3A) and light (#F9FAFB/
   * #FFF/#F3F4F6/#E5E7EB) hierarchies while still carrying the
   * wallpaper hue.
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
        "backgroundRoot" to "system_neutral1_900",
        "backgroundDefault" to "system_neutral1_800",
        "backgroundSecondary" to "system_neutral1_700",
        "backgroundTertiary" to "system_neutral1_600",
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
        "backgroundRoot" to "system_neutral1_50",
        "backgroundDefault" to "system_neutral1_0",
        "backgroundSecondary" to "system_neutral1_100",
        "backgroundTertiary" to "system_neutral1_200",
      )
    }

  /** Android TV builds ship these resources as static defaults — there is
   *  no wallpaper palette to follow, so report the feature as missing. */
  private fun isTvDevice(): Boolean =
    (Resources.getSystem().configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) ==
      Configuration.UI_MODE_TYPE_TELEVISION

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
