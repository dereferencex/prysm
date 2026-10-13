import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { Colors } from "@/constants/theme";
import {
  getDynamicPalette,
  getPaletteFromSeed,
  isDynamicColorSupported,
  clearDynamicPaletteCache,
  type DynamicPalette,
} from "../../modules/dynamic-color/src";

type ThemeMode = "light" | "dark" | "pitchblack";

interface ThemeContextType {
  themeMode: ThemeMode;
  isDark: boolean;
  dynamicColors: boolean;
  seedColor: string | null;
  theme: typeof Colors.dark;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  setDynamicColors: (enabled: boolean) => Promise<void>;
  setSeedColor: (color: string | null) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

const THEME_STORAGE_KEY = "prysm_theme_mode";
const DYNAMIC_STORAGE_KEY = "prysm_dynamic_colors";
const SEED_STORAGE_KEY = "prysm_seed_color";

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("pitchblack");
  const [dynamicColors, setDynamicColorsState] = useState(false);
  const [seedColor, setSeedColorState] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // Bumped when the app returns to the foreground so the wallpaper palette
  // is re-read (the user may have changed it while we were backgrounded).
  const [refreshKey, setRefreshKey] = useState(0);
  const [palette, setPalette] = useState<DynamicPalette | null>(null);

  // Support is fixed for the process lifetime; read it once.
  const [dynamicSupported] = useState(() => isDynamicColorSupported());

  const isDark = themeMode !== "light";

  const loadTheme = useCallback(async () => {
    try {
      const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (
        savedTheme === "light" ||
        savedTheme === "dark" ||
        savedTheme === "pitchblack"
      ) {
        setThemeModeState(savedTheme);
      }
      const savedDynamic = await AsyncStorage.getItem(DYNAMIC_STORAGE_KEY);
      if (savedDynamic === "true" || savedDynamic === "false") {
        setDynamicColorsState(savedDynamic === "true");
      } else {
        setDynamicColorsState(dynamicSupported);
      }
      const savedSeed = await AsyncStorage.getItem(SEED_STORAGE_KEY);
      if (savedSeed && /^#?[0-9a-f]{6}$/i.test(savedSeed)) {
        setSeedColorState(savedSeed.startsWith("#") ? savedSeed : `#${savedSeed}`);
      }
    } catch (error) {
      console.error("Error loading theme:", error);
    } finally {
      setIsLoaded(true);
    }
  }, [dynamicSupported]);

  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        clearDynamicPaletteCache();
        setRefreshKey((k) => k + 1);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!dynamicColors) {
      setPalette(null);
      return;
    }
    // Manual seed color takes precedence (user-picked in Settings, or the
    // default on Android TV where there is no wallpaper to follow).
    if (seedColor) {
      setPalette(getPaletteFromSeed(seedColor, isDark));
    } else {
      setPalette(getDynamicPalette(isDark));
    }
  }, [dynamicColors, seedColor, isDark, themeMode, refreshKey]);

  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
      setThemeModeState(mode);
    } catch (error) {
      console.error("Error saving theme:", error);
    }
  };

  const setDynamicColors = async (enabled: boolean) => {
    try {
      await AsyncStorage.setItem(DYNAMIC_STORAGE_KEY, String(enabled));
      setDynamicColorsState(enabled);
    } catch (error) {
      console.error("Error saving dynamic colors:", error);
    }
  };

  const setSeedColor = async (color: string | null) => {
    try {
      if (color) {
        await AsyncStorage.setItem(SEED_STORAGE_KEY, color);
        setSeedColorState(color);
      } else {
        await AsyncStorage.removeItem(SEED_STORAGE_KEY);
        setSeedColorState(null);
      }
      clearDynamicPaletteCache();
    } catch (error) {
      console.error("Error saving seed color:", error);
    }
  };

  const toggleTheme = async () => {
    const newMode = themeMode === "dark" ? "light" : "dark";
    await setThemeMode(newMode);
  };

  const baseTheme =
    themeMode === "pitchblack"
      ? Colors.pitchblack
      : isDark
        ? Colors.dark
        : Colors.light;
  // Pitch black keeps its pure-black surfaces but, when dynamic colors
  // (monet) are enabled, adopts the wallpaper-derived accent roles so the
  // app "follows that color" on top of pitch black.
  const dynamics =
    dynamicColors && palette
      ? themeMode === "pitchblack"
        ? {
            primary: palette.primary,
            primaryLight: palette.primaryLight,
            buttonText: palette.buttonText,
            tabIconSelected: palette.tabIconSelected,
            link: palette.link,
          }
        : palette
      : null;
  const theme = dynamics ? { ...baseTheme, ...dynamics } : baseTheme;

  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        isDark,
        dynamicColors,
        seedColor,
        theme,
        setThemeMode,
        setDynamicColors,
        setSeedColor,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useThemeContext must be used within a ThemeProvider");
  }
  return context;
}
