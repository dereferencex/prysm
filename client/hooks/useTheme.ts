import { useThemeContext } from "@/context/ThemeContext";

export function useTheme() {
  const {
    theme,
    isDark,
    themeMode,
    dynamicColors,
    setThemeMode,
    setDynamicColors,
    toggleTheme,
  } = useThemeContext();

  return {
    theme,
    isDark,
    themeMode,
    dynamicColors,
    setThemeMode,
    setDynamicColors,
    toggleTheme,
  };
}
