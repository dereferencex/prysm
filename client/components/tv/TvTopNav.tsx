import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Platform,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";

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
  { id: "Search", label: "Search", icon: "search-outline", iconActive: "search" },
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
  theme,
}: {
  item: NavItem;
  isActive: boolean;
  onPress: () => void;
  theme: any;
}) {
  const [isFocused, setIsFocused] = useState(false);

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
        color={
          isFocused
            ? "#FFFFFF"
            : isActive
              ? "#FFFFFF"
              : "rgba(255, 255, 255, 0.65)"
        }
        style={styles.tabIcon}
      />
      <ThemedText
        type="body"
        style={[
          styles.tabLabel,
          {
            color: isFocused
              ? "#FFFFFF"
              : isActive
                ? "#FFFFFF"
                : "rgba(255, 255, 255, 0.7)",
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
  return (
    <View style={styles.headerContainer}>
      <View style={styles.brandContainer}>
        <ThemedText type="h3" style={styles.brandTitle}>
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
            theme={theme}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: "#FFFFFF",
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
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  activeTabButton: {
    backgroundColor: "#1E3A5F",
    borderColor: "rgba(59, 130, 246, 0.4)",
  },
focusedTabButton: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(56, 189, 248, 0.25)",
  },
  tabIcon: {
    marginRight: 6,
  },
  tabLabel: {
    fontSize: 14,
  },
});
