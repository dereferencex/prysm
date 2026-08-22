import { requireOptionalNativeModule, Platform } from "expo-modules-core";

/**
 * Material You (Android 12+) wallpaper palette reader.
 *
 * Backed by the native module at
 * modules/dynamic-color/android/src/main/java/expo/modules/dynamiccolor/
 * DynamicColorModule.kt, which reads the closest `@android:color/
 * system_accent1_*` / `system_neutral1_*` tones for each semantic theme
 * key and returns them as hex strings.
 *
 * On Android 12+ the palette follows the user's wallpaper and is
 * re-fetched whenever the app returns to the foreground (see
 * client/context/ThemeContext.tsx). On older Android (or OEM builds that
 * strip the resources) getDynamicPalette() resolves to null and the app
 * keeps its static theme from client/constants/theme.ts.
 */

export interface DynamicPalette {
  primary: string;
  primaryLight: string;
  text: string;
  textSecondary: string;
  buttonText: string;
  tabIconDefault: string;
  tabIconSelected: string;
  link: string;
  backgroundRoot: string;
  backgroundDefault: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
}

interface DynamicColorModuleType {
  isSupported(): boolean;
  getPalette(isDark: boolean): DynamicPalette | null;
}

const DynamicColorModule: DynamicColorModuleType | null =
  Platform.OS === "android"
    ? requireOptionalNativeModule<DynamicColorModuleType>("DynamicColor")
    : null;

let cachedPalette: DynamicPalette | null = null;
let cachedKey: "light" | "dark" | null = null;

/** True on Android 12+ where the wallpaper palette is available. */
export function isDynamicColorSupported(): boolean {
  try {
    return DynamicColorModule?.isSupported() ?? false;
  } catch {
    return false;
  }
}

/** Read the current Material You palette, cached per light/dark mode.
 *  A failed read is not cached so transient native errors are retried. */
export function getDynamicPalette(isDark: boolean): DynamicPalette | null {
  const key = isDark ? "dark" : "light";
  if (cachedKey === key) return cachedPalette;
  try {
    const palette = DynamicColorModule?.getPalette(isDark) ?? null;
    cachedKey = key;
    cachedPalette = palette;
    return palette;
  } catch {
    return null;
  }
}

/** Drop the cached palette so the next read re-queries the system (e.g.
 *  after a wallpaper change while the app was backgrounded). */
export function clearDynamicPaletteCache(): void {
  cachedPalette = null;
  cachedKey = null;
}
