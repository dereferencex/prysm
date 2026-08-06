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
  isDynamicColorSupported,
  clearDynamicPaletteCache,
  type DynamicPalette,
} from "../../modules/dynamic-color/src";

type ThemeMode = "light" | "dark";

interface ThemeContextType {
  themeMode: ThemeMode;
  isDark: boolean;
  dynamicColors: boolean;
  theme: typeof Colors.dark;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  setDynamicColors: (enabled: boolean) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

const THEME_STORAGE_KEY = "prysm_theme_mode";
const DYNAMIC_STORAGE_KEY = "prysm_dynamic_colors";

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("dark");
  const [dynamicColors, setDynamicColorsState] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  // Bumped when the app returns to the foreground so the wallpaper palette
  // is re-read (the user may have changed it while we were backgrounded).
  const [refreshKey, setRefreshKey] = useState(0);
  const [palette, setPalette] = useState<DynamicPalette | null>(null);

  // Support is fixed for the process lifetime; read it once.
  const [dynamicSupported] = useState(() => isDynamicColorSupported());

  const isDark = themeMode === "dark";

  const loadTheme = useCallback(async () => {
    try {
      const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === "light" || savedTheme === "dark") {
        setThemeModeState(savedTheme);
      }
      const savedDynamic = await AsyncStorage.getItem(DYNAMIC_STORAGE_KEY);
      if (savedDynamic === "true" || savedDynamic === "false") {
        setDynamicColorsState(savedDynamic === "true");
      } else {
        setDynamicColorsState(dynamicSupported);
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
    setPalette(dynamicColors ? getDynamicPalette(isDark) : null);
  }, [dynamicColors, isDark, refreshKey]);

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

  const toggleTheme = async () => {
    const newMode = themeMode === "dark" ? "light" : "dark";
    await setThemeMode(newMode);
  };

  const baseTheme = isDark ? Colors.dark : Colors.light;
  const theme =
    dynamicColors && palette ? { ...baseTheme, ...palette } : baseTheme;

  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        isDark,
        dynamicColors,
        theme,
        setThemeMode,
        setDynamicColors,
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
