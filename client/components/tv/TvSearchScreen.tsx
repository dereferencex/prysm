import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Platform,
  useWindowDimensions,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThemedText } from "@/components/ThemedText";
import { TVFocusablePressable } from "@/components/TVFocusablePressable";
import { usePlaylist } from "@/context/PlaylistContext";
import { useTheme } from "@/hooks/useTheme";
import { useFlashListFocus } from "@/hooks/useFlashListFocus";
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
  const { width } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const resultsFocus = useFlashListFocus<Channel>();
  const columnCount = Math.min(4, Math.max(2, Math.floor(width / 300)));
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);
  const focusResult = resultsFocus.focusOn;

  useEffect(() => {
    const timer = setTimeout(() => setSubmittedQuery(searchQuery), 180);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const searchableChannels = useMemo(
    () =>
      (playlist?.channels || []).map((channel) => ({
        channel,
        name: channel.name.toLowerCase(),
        group: (channel.group || "").toLowerCase(),
      })),
    [playlist],
  );

  const results = useMemo(() => {
    if (!playlist || !submittedQuery.trim()) return [];
    const q = submittedQuery.toLowerCase().trim();
    return searchableChannels
      .filter(({ name, group }) => name.includes(q) || group.includes(q))
      .map(({ channel }) => channel);
  }, [playlist, searchableChannels, submittedQuery]);
  const handleResultPress = useCallback(
    (channel: Channel) =>
      navigation.navigate("Player", { channelId: channel.id }),
    [navigation],
  );
  const renderResult = useCallback(
    ({ item: channel, index }: { item: Channel; index: number }) => (
      <ChannelResultCard
        channel={channel}
        onPress={() => handleResultPress(channel)}
        onFocused={() => focusResult(index)}
      />
    ),
    [focusResult, handleResultPress],
  );

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
          <TVFocusablePressable
            onPress={() => setSearchQuery("")}
            accessibilityLabel="Clear search"
            baseStyle={styles.clearButton}
            focusedStyle={styles.clearButtonFocused}
          >
            <Ionicons name="close-circle" size={20} color={c.text60} />
          </TVFocusablePressable>
        ) : null}
      </View>

      {/* Results */}
      <FlashList
        ref={resultsFocus.listRef}
        data={results}
        keyExtractor={(channel) => channel.id}
        numColumns={columnCount}
        style={styles.resultsScroll}
        contentContainerStyle={styles.resultsGrid}
        showsVerticalScrollIndicator={false}
        drawDistance={400}
        onViewableItemsChanged={resultsFocus.onViewableItemsChanged}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <ThemedText type="body" style={styles.emptyText}>
              {searchQuery.trim() === ""
                ? "Type on the keyboard to search channels"
                : submittedQuery !== searchQuery
                  ? "Searching..."
                  : `No channels found matching "${searchQuery}"`}
            </ThemedText>
          </View>
        }
        renderItem={renderResult}
      />
    </View>
  );
}

const ChannelResultCard = React.memo(function ChannelResultCard({
  channel,
  onPress,
  onFocused,
}: {
  channel: Channel;
  onPress: () => void;
  onFocused: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <TVFocusablePressable
      onPress={onPress}
      onFocusChange={(f) => {
        if (f) onFocused();
      }}
      accessibilityLabel={channel.name}
      baseStyle={styles.resultCard}
      focusedStyle={styles.resultCardFocused}
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
    </TVFocusablePressable>
  );
});

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
      borderRadius: 999,
    },
    clearButtonFocused: {
      backgroundColor: c.focusFillStrong,
    },
    resultsScroll: {
      flex: 1,
    },
    resultsGrid: {
      paddingBottom: Spacing["3xl"],
      paddingHorizontal: Spacing.sm,
    },
    resultCard: {
      width: "100%",
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.panel,
      padding: Spacing.sm,
    },
    resultCardFocused: {
      backgroundColor: c.focusFillStrong,
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
