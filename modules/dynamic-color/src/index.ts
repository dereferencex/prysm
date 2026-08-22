import { requireOptionalNativeModule, Platform } from "expo-modules-core";
import { Hct, TonalPalette } from "@material/material-color-utilities";

/**
 * Material You wallpaper-driven palette.
 *
 * Strategy (first source wins):
 *  1. Native getWallpaperSeed() reads WallpaperManager.getWallpaperColors()
 *     (API 27+, works on all OEM skins incl. Samsung/Xiaomi which never
 *     overlay framework resources). JS synthesizes tonal palettes from the
 *     seed with @material/material-color-utilities — same math Monet uses.
 *  2. Native getPalette() reads @android:color/system_* resources, which
 *     carry wallpaper values only on true-Monet builds (Pixel et al).
 *
 * If both fail the app keeps its static theme from client/constants/theme.ts.
 * The result is re-read when the app returns to the foreground (see
 * client/context/ThemeContext.tsx).
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

interface WallpaperSeed {
  primary?: string;
  secondary?: string;
  tertiary?: string;
}

interface DynamicColorModuleType {
  isSupported(): boolean;
  getWallpaperSeed?(): WallpaperSeed | null;
  getPalette(isDark: boolean): DynamicPalette | null;
}

const DynamicColorModule: DynamicColorModuleType | null =
  Platform.OS === "android"
    ? requireOptionalNativeModule<DynamicColorModuleType>("DynamicColor")
    : null;

let cachedPalette: DynamicPalette | null = null;
let cachedKey: "light" | "dark" | null = null;

/** True when the device can provide a wallpaper-derived palette. */
export function isDynamicColorSupported(): boolean {
  try {
    return DynamicColorModule?.isSupported() ?? false;
  } catch {
    return false;
  }
}

function hexToArgb(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? (0xff000000 | parseInt(m[1], 16)) >>> 0 : null;
}

function argbToHex(argb: number): string {
  return `#${((argb & 0xffffff) >>> 0).toString(16).toUpperCase().padStart(6, "0")}`;
}

/**
 * Material You role → tonal palette tone (true HCT tones: 0 black,
 * 100 white). Mirrors the static theme's hierarchy so enabling dynamic
 * colors changes hue/tint without breaking the layout's contrast rhythm.
 */
const SEED_TONES: Record<
  keyof DynamicPalette,
  [palette: "a1" | "n1" | "n2", tone: number]
> = {
  // accent roles
  primary: ["a1", 80],
  primaryLight: ["a1", 90],
  buttonText: ["a1", 20],
  tabIconSelected: ["a1", 80],
  link: ["a1", 80],
  // neutral roles
  text: ["n1", 92],
  textSecondary: ["n2", 80],
  tabIconDefault: ["n2", 55],
  // surfaces (dark)
  backgroundRoot: ["n1", 8],
  backgroundDefault: ["n1", 13],
  backgroundSecondary: ["n1", 20],
  backgroundTertiary: ["n1", 28],
};

const LIGHT_TONES: Partial<Record<keyof DynamicPalette, number>> = {
  primary: 40,
  primaryLight: 60,
  buttonText: 100,
  tabIconSelected: 40,
  link: 40,
  text: 13,
  textSecondary: 40,
  tabIconDefault: 45,
  backgroundRoot: 96,
  backgroundDefault: 100,
  backgroundSecondary: 94,
  backgroundTertiary: 89,
};

/** Synthesize the palette from a wallpaper seed color (Monet-style). */
function paletteFromSeed(
  seedHex: string,
  isDark: boolean,
): DynamicPalette | null {
  const argb = hexToArgb(seedHex);
  if (argb === null) return null;
  try {
    const cam = Hct.fromInt(argb);
    // Google's scheme rules: accent chroma clamped to >=48, neutrals fixed low.
    const a1 = TonalPalette.fromHueAndChroma(cam.hue, Math.max(48, cam.chroma));
    const n1 = TonalPalette.fromHueAndChroma(cam.hue, 4);
    const n2 = TonalPalette.fromHueAndChroma(cam.hue, 8);
    const palettes = { a1, n1, n2 };
    const out = {} as DynamicPalette;
    for (const key of Object.keys(SEED_TONES) as (keyof DynamicPalette)[]) {
      const [pal, darkTone] = SEED_TONES[key];
      const tone = isDark ? darkTone : (LIGHT_TONES[key] ?? darkTone);
      out[key] = argbToHex(palettes[pal].tone(tone));
    }
    return out;
  } catch {
    return null;
  }
}

/** Read the current wallpaper-derived palette, cached per light/dark mode.
 *  A failed read is not cached so transient errors are retried. */
export function getDynamicPalette(isDark: boolean): DynamicPalette | null {
  const key = isDark ? "dark" : "light";
  if (cachedKey === key) return cachedPalette;
  try {
    let palette: DynamicPalette | null = null;
    // Preferred: synthesize from the wallpaper itself — works everywhere.
    if (typeof DynamicColorModule?.getWallpaperSeed === "function") {
      const seed = DynamicColorModule.getWallpaperSeed();
      const seedHex = seed?.primary || seed?.secondary || seed?.tertiary;
      if (seedHex) palette = paletteFromSeed(seedHex, isDark);
    }
    // Fallback: framework resources (only meaningful on true-Monet builds).
    if (!palette) {
      palette = DynamicColorModule?.getPalette(isDark) ?? null;
    }
    if (palette) {
      cachedKey = key;
      cachedPalette = palette;
    }
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
