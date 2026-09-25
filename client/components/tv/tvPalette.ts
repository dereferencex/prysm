import { Colors, withAlpha } from "@/constants/theme";

/**
 * Single source of truth for the TV chrome (midnight-blue look these
 * components were originally hardcoded with). Every TV surface/edge derives
 * from the active theme so pitch black renders true black and, when dynamic
 * colors (monet) are enabled, accents follow the wallpaper hue.
 */
export interface TvPalette {
  root: string;
  panel: string;
  panelAlt: string;
  inset: string;
  focusBorder: string;
  focusFill: string;
  focusFillStrong: string;
  selection: string;
  accent: string;
  accentTint: string;
  accentTintStrong: string;
  accentBorder: string;
  border: string;
  borderSubtle: string;
  borderFaint: string;
  separator: string;
  text: string;
  textSecondary: string;
  text75: string;
  text60: string;
  text50: string;
  text45: string;
  text40: string;
  text35: string;
}

export function createTvPalette(theme: typeof Colors.dark): TvPalette {
  return {
    root: theme.backgroundRoot,
    panel: theme.backgroundSecondary,
    panelAlt: theme.backgroundTertiary,
    inset: theme.backgroundRoot,
    focusBorder: "#FFFFFF",
    focusFill: withAlpha(theme.primary, 0.25),
    focusFillStrong: withAlpha(theme.primary, 0.4),
    selection: withAlpha(theme.primary, 0.2),
    accent: theme.primaryLight,
    accentTint: withAlpha(theme.primaryLight, 0.15),
    accentTintStrong: withAlpha(theme.primaryLight, 0.3),
    accentBorder: withAlpha(theme.primaryLight, 0.4),
    border: withAlpha(theme.text, 0.12),
    borderSubtle: withAlpha(theme.text, 0.08),
    borderFaint: withAlpha(theme.text, 0.06),
    separator: withAlpha(theme.text, 0.08),
    text: theme.text,
    textSecondary: theme.textSecondary,
    text75: withAlpha(theme.text, 0.75),
    text60: withAlpha(theme.text, 0.6),
    text50: withAlpha(theme.text, 0.5),
    text45: withAlpha(theme.text, 0.45),
    text40: withAlpha(theme.text, 0.4),
    text35: withAlpha(theme.text, 0.35),
  };
}
