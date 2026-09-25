import React, { useState, useMemo } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  Platform,
  ViewStyle,
  type LayoutChangeEvent,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThemedText } from "@/components/ThemedText";
import { usePlaylist } from "@/context/PlaylistContext";
import { useTheme } from "@/hooks/useTheme";
import { useFocusScroll } from "@/hooks/useFocusScroll";
import { Colors, Spacing } from "@/constants/theme";
import { createTvPalette } from "./tvPalette";
import { Channel } from "@/types/playlist";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

const placeholderImage = require("../../../assets/images/placeholder-channel.png");

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function TvSearchScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const { playlist } = usePlaylist();
  const [searchQuery, setSearchQuery] = useState("");
  const resultsScroll = useFocusScroll<string>({ axis: "vertical" });
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

  const results = useMemo(() => {
    if (!playlist || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return playlist.channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.group && c.group.toLowerCase().includes(q)),
    );
  }, [playlist, searchQuery]);

  return (
    <View style={styles.container}>
      {/* Search Input */}
      <View style={styles.searchBarContainer}>
        <Ionicons
          name="search"
          size={22}
          color={c.accent}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search all channels, movies, sports, or genres..."
          placeholderTextColor={c.text40}
          autoFocus={Platform.isTV}
        />
        {searchQuery ? (
          <Pressable
            onPress={() => setSearchQuery("")}
            focusable
            style={styles.clearButton}
          >
            <Ionicons name="close-circle" size={20} color={c.text60} />
          </Pressable>
        ) : null}
      </View>

      {/* Results */}
      <ScrollView
        ref={resultsScroll.scrollRef}
        style={styles.resultsScroll}
        contentContainerStyle={styles.resultsGrid}
        showsVerticalScrollIndicator={false}
        onLayout={resultsScroll.onScrollViewLayout}
        onScroll={resultsScroll.onScroll}
        scrollEventThrottle={16}
      >
        {searchQuery.trim() === "" ? (
          <View style={styles.emptyContainer}>
            <ThemedText type="body" style={styles.emptyText}>
              Type on the keyboard to search channels
            </ThemedText>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.emptyContainer}>
            <ThemedText type="body" style={styles.emptyText}>
              {`No channels found matching "${searchQuery}"`}
            </ThemedText>
          </View>
        ) : (
          results.map((channel) => (
            <ChannelResultCard
              key={channel.id}
              channel={channel}
              onPress={() =>
                navigation.navigate("Player", { channelId: channel.id })
              }
              onLayoutItem={(e) => resultsScroll.registerItem(channel.id, e)}
              onFocused={() => resultsScroll.focusOn(channel.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ChannelResultCard({
  channel,
  onPress,
  onLayoutItem,
  onFocused,
}: {
  channel: Channel;
  onPress: () => void;
  onLayoutItem: (e: LayoutChangeEvent) => void;
  onFocused: () => void;
}) {
  const { theme } = useTheme();
  const [isFocused, setIsFocused] = React.useState(false);
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayoutItem}
      onFocus={() => {
        setIsFocused(true);
        onFocused();
      }}
      onBlur={() => setIsFocused(false)}
      focusable
      style={
        [
          styles.resultCard,
          isFocused && styles.resultCardFocused,
        ] as ViewStyle[]
      }
    >
      <View style={styles.resultLogoBox}>
        <Image
          source={channel.logo ? { uri: channel.logo } : placeholderImage}
          style={styles.resultLogo}
          contentFit="contain"
        />
      </View>
      <View style={styles.resultInfo}>
        <ThemedText type="body" numberOfLines={1} style={styles.resultName}>
          {channel.name}
        </ThemedText>
        <ThemedText type="caption" numberOfLines={1} style={styles.resultGroup}>
          {channel.group || "All Channels"}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function createStyles(theme: typeof Colors.dark) {
  const c = createTvPalette(theme);
  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.xs,
    },
    searchBarContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.panel,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      height: 52,
      marginBottom: Spacing.lg,
    },
    searchIcon: {
      marginRight: Spacing.sm,
    },
    searchInput: {
      flex: 1,
      color: c.text,
      fontSize: 16,
      fontWeight: "500",
    },
    clearButton: {
      padding: Spacing.xs,
    },
    resultsScroll: {
      flex: 1,
    },
    resultsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.md,
      paddingBottom: Spacing["3xl"],
    },
    resultCard: {
      width: "23%",
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.panel,
      borderRadius: 14,
      padding: Spacing.sm,
      borderWidth: 2,
      borderColor: "transparent",
    },
    resultCardFocused: {
      borderColor: c.focusBorder,
      backgroundColor: c.focusFill,
    },
    resultLogoBox: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: c.inset,
      alignItems: "center",
      justifyContent: "center",
      marginRight: Spacing.sm,
      padding: 3,
    },
    resultLogo: {
      width: "100%",
      height: "100%",
    },
    resultInfo: {
      flex: 1,
    },
    resultName: {
      color: c.text,
      fontWeight: "700",
    },
    resultGroup: {
      color: c.text50,
      marginTop: 2,
    },
    emptyContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: Spacing["3xl"],
      width: "100%",
    },
    emptyText: {
      color: c.text50,
    },
  });
}
