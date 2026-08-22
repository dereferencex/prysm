package expo.modules.dynamiccolor

import android.app.WallpaperManager
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exposes the wallpaper colors so JS can synthesize a Material You palette.
 *
 * Two sources, tried in this order by the JS side:
 *  1. getWallpaperSeed() — WallpaperManager.getWallpaperColors() (API 27+).
 *     Works on every OEM skin (Samsung, Xiaomi...) because it reads the
 *     wallpaper directly instead of relying on framework overlays.
 *  2. getPalette() — the @android:color/system_* resources, which only
 *     carry wallpaper-derived values where the OEM actually applies
 *     runtime overlays (Pixels and other true-Monet builds).
 *
 * JS synthesizes tonal palettes from the seed via material-color-utilities.
 * On Android TV there is no user wallpaper to follow, so support is false.
 */
class DynamicColorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DynamicColor")

    Function("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1 && !isTvDevice()
    }

    Function("getWallpaperSeed") {
      readWallpaperSeed()
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

  /** Android TV builds ship no user wallpaper palette — report unsupported. */
  private fun isTvDevice(): Boolean =
    (Resources.getSystem().configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) ==
      Configuration.UI_MODE_TYPE_TELEVISION

  /** Seed colors from the current system wallpaper — {primary, secondary,
   *  tertiary} as #RRGGBB hex. Null when unavailable (API < 27, live
   *  wallpapers that don't publish colors, etc.). No permission needed. */
  private fun readWallpaperSeed(): Map<String, String>? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) return null
    val context = appContext.reactContext ?: return null
    return try {
      val wm = WallpaperManager.getInstance(context)
      val colors = wm.getWallpaperColors(WallpaperManager.FLAG_SYSTEM)
        ?: wm.getWallpaperColors(
          WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK,
        )
        ?: return null
      val out = mutableMapOf<String, String>()
      // WallpaperColors accessors return android.graphics.Color on newer
      // compileSdk versions and ColorStateList on older ones — accept both.
      fun put(key: String, color: Any?) {
        val argb = when (color) {
          is android.graphics.Color -> color.toArgb()
          is android.content.res.ColorStateList -> color.defaultColor
          else -> return
        }
        if (argb ushr 24 != 0) {
          out[key] = String.format("#%06X", argb and 0xFFFFFF)
        }
      }
      put("primary", colors.primaryColor)
      put("secondary", colors.secondaryColor)
      put("tertiary", colors.tertiaryColor)
      if (out.isEmpty()) null else out
    } catch (e: Exception) {
      Log.w("DynamicColor", "readWallpaperSeed failed: ${e.message}")
      null
    }
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
