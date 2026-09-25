import React, { useState, useMemo } from "react";
import { View, StyleSheet, Pressable, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { createTvPalette } from "./tvPalette";

export type TvTabName =
  | "Home"
  | "Live TV"
  | "Movies"
  | "Series"
  | "Guide"
  | "Search"
  | "Settings";

interface NavItem {
  id: TvTabName;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
}

const NAV_ITEMS: NavItem[] = [
  { id: "Home", label: "Home", icon: "home-outline", iconActive: "home" },
  { id: "Live TV", label: "Live TV", icon: "play", iconActive: "play" },
  { id: "Movies", label: "Movies", icon: "star-outline", iconActive: "star" },
  { id: "Series", label: "Series", icon: "menu-outline", iconActive: "menu" },
  {
    id: "Guide",
    label: "Guide",
    icon: "information-circle-outline",
    iconActive: "information-circle",
  },
  {
    id: "Search",
    label: "Search",
    icon: "search-outline",
    iconActive: "search",
  },
  {
    id: "Settings",
    label: "Settings",
    icon: "settings-outline",
    iconActive: "settings",
  },
];

interface TvTopNavProps {
  activeTab: TvTabName;
  onSelectTab: (tab: TvTabName) => void;
  brandTitle?: string;
  theme: any;
  nextFocusDownRef?: React.RefObject<any>;
}

function NavTabButton({
  item,
  isActive,
  onPress,
}: {
  item: NavItem;
  isActive: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      focusable={true}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={item.label}
      style={
        [
          styles.tabButton,
          isActive && styles.activeTabButton,
          isFocused && styles.focusedTabButton,
        ] as ViewStyle[]
      }
    >
      <Ionicons
        name={isActive ? item.iconActive : item.icon}
        size={16}
        color={isFocused ? c.text : isActive ? c.text : c.text75}
        style={styles.tabIcon}
      />
      <ThemedText
        type="body"
        style={[
          styles.tabLabel,
          {
            color: isFocused ? c.text : isActive ? c.text : c.text75,
            fontWeight: isActive || isFocused ? "700" : "500",
          },
        ]}
      >
        {item.label}
      </ThemedText>
    </Pressable>
  );
}

export function TvTopNav({
  activeTab,
  onSelectTab,
  brandTitle = "Prysm",
  theme,
}: TvTopNavProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

  return (
    <View style={styles.headerContainer}>
      <View style={styles.brandContainer}>
        <ThemedText type="h3" style={[styles.brandTitle, { color: c.text }]}>
          {brandTitle}
        </ThemedText>
      </View>

      <View style={styles.tabsContainer}>
        {NAV_ITEMS.map((item) => (
          <NavTabButton
            key={item.id}
            item={item}
            isActive={activeTab === item.id}
            onPress={() => onSelectTab(item.id)}
          />
        ))}
      </View>
    </View>
  );
}

function createStyles(theme: any) {
  const c = createTvPalette(theme);
  return StyleSheet.create({
    headerContainer: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
      backgroundColor: "transparent",
    },
    brandContainer: {
      marginRight: Spacing["2xl"],
    },
    brandTitle: {
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    tabsContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
    },
    tabButton: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 7,
      paddingHorizontal: Spacing.md,
    },
    activeTabButton: {
      backgroundColor: c.focusFillStrong,
    },
    focusedTabButton: {
      backgroundColor: c.focusFillStrong,
    },
    tabIcon: {
      marginRight: 6,
    },
    tabLabel: {
      fontSize: 14,
    },
  });
}
