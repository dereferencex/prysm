import React, { useState, useMemo } from "react";
import { View, StyleSheet, Pressable, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { createTvPalette } from "./tvPalette";

const brandLogo = require("../../../assets/images/icon.png");

export type TvTabName =
  | "Home"
  | "Live TV"
  | "Favorites"
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
  {
    id: "Favorites",
    label: "Favorites",
    icon: "star-outline",
    iconActive: "star",
  },
  {
    id: "Movies",
    label: "Movies",
    icon: "film-outline",
    iconActive: "film",
  },
  {
    id: "Series",
    label: "Series",
    icon: "albums-outline",
    iconActive: "albums",
  },
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
        size={18}
        color={isFocused || isActive ? c.text : c.text75}
        style={styles.tabIcon}
      />
      <ThemedText
        type="body"
        style={[
          styles.tabLabel,
          {
            color: isFocused || isActive ? c.text : c.text75,
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
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

  return (
    <View style={[styles.topNav, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.brandContainer}>
        <Image
          source={brandLogo}
          style={styles.brandLogo}
          contentFit="contain"
        />
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
    topNav: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.panel,
      borderBottomWidth: 1,
      borderBottomColor: c.borderSubtle,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.sm,
      gap: Spacing.xl,
    },
    brandContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    brandLogo: {
      width: 30,
      height: 30,
      borderRadius: 8,
    },
    brandTitle: {
      fontSize: 18,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    tabsContainer: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      gap: 2,
    },
    tabButton: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.sm,
    },
    activeTabButton: {
      backgroundColor: c.focusFillStrong,
    },
    focusedTabButton: {
      borderWidth: 2,
      borderColor: c.accentBorder,
      backgroundColor: c.focusFill,
    },
    tabIcon: {
      marginRight: 8,
    },
    tabLabel: {
      fontSize: 14,
    },
  });
}
