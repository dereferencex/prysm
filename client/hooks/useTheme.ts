import { useThemeContext } from "@/context/ThemeContext";

export function useTheme() {
  const {
    theme,
    isDark,
    themeMode,
    dynamicColors,
    seedColor,
    setThemeMode,
    setDynamicColors,
    setSeedColor,
    toggleTheme,
  } = useThemeContext();

  return {
    theme,
    isDark,
    themeMode,
    dynamicColors,
    seedColor,
    setThemeMode,
    setDynamicColors,
    setSeedColor,
    toggleTheme,
  };
}
