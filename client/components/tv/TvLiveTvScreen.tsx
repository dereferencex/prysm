import React, { useState, useMemo, useCallback, useEffect } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { TVFocusablePressable } from "@/components/TVFocusablePressable";
import { usePlaylist } from "@/context/PlaylistContext";
import { useEpg } from "@/context/EpgContext";
import { useTheme } from "@/hooks/useTheme";
import { useFlashListFocus } from "@/hooks/useFlashListFocus";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { createTvPalette } from "./tvPalette";
import { Channel } from "@/types/playlist";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import { TvEpgBanner } from "./TvEpgBanner";

const isTV = Platform.isTV;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface TvLiveTvScreenProps {
  categoryTypeFilter?: "all" | "movies" | "series";
}

export function TvLiveTvScreen({
  categoryTypeFilter = "all",
}: TvLiveTvScreenProps) {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const {
    playlist,
    getChannelsByCategory,
    toggleFavorite,
    toggleFavoriteCategory,
    isCategoryFavorite,
  } = usePlaylist();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

  // Selected Category
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  // Filter categories according to tab filter (All / Movies / Series)
  const allCategories = useMemo(() => {
    if (!playlist) return ["All"];
    let cats = [...playlist.categories];

    if (categoryTypeFilter === "movies") {
      cats = cats.filter((c) => /movie|cinema|film|vod|vod/i.test(c));
      if (cats.length === 0) cats = [...playlist.categories];
    } else if (categoryTypeFilter === "series") {
      cats = cats.filter((c) => /series|serie|show|season|tv show/i.test(c));
      if (cats.length === 0) cats = [...playlist.categories];
    }

    return ["All", ...cats];
  }, [playlist, categoryTypeFilter]);

  // Channel counts per category
  const categoryCounts = useMemo(() => {
    if (!playlist) return {};
    const counts: Record<string, number> = { All: playlist.channels.length };
    for (const ch of playlist.channels) {
      if (ch.group) {
        counts[ch.group] = (counts[ch.group] || 0) + 1;
      }
    }
    return counts;
  }, [playlist]);

  // Ensure valid selected category
  useEffect(() => {
    if (
      selectedCategory !== "All" &&
      !allCategories.includes(selectedCategory)
    ) {
      setSelectedCategory("All");
    }
  }, [allCategories, selectedCategory]);

  // Filtered Channels
  const filteredChannels = useMemo(() => {
    if (!playlist) return [];
    let channels =
      selectedCategory === "All"
        ? playlist.channels
        : getChannelsByCategory(selectedCategory);

    if (selectedCategory === "All" && categoryTypeFilter === "movies") {
      channels = channels.filter((ch) =>
        /movie|cinema|film|vod/i.test(ch.group || ""),
      );
      if (channels.length === 0) channels = playlist.channels;
    } else if (selectedCategory === "All" && categoryTypeFilter === "series") {
      channels = channels.filter((ch) =>
        /series|serie|show|season/i.test(ch.group || ""),
      );
      if (channels.length === 0) channels = playlist.channels;
    }

    return channels;
  }, [playlist, selectedCategory, categoryTypeFilter, getChannelsByCategory]);

  const filteredChannelById = useMemo(
    () => new Map(filteredChannels.map((channel) => [channel.id, channel])),
    [filteredChannels],
  );

  // Selected Channel for Preview
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );
  // Sync selected channel with filtered list
  useEffect(() => {
    if (filteredChannels.length > 0) {
      if (!selectedChannelId || !filteredChannelById.has(selectedChannelId)) {
        setSelectedChannelId(filteredChannels[0].id);
      }
    } else {
      setSelectedChannelId(null);
    }
  }, [filteredChannels, filteredChannelById, selectedChannelId]);

  const activeChannel = useMemo(() => {
    return (
      filteredChannelById.get(selectedChannelId || "") ||
      filteredChannels[0] ||
      null
    );
  }, [filteredChannelById, filteredChannels, selectedChannelId]);

  const categoryFocus = useFlashListFocus<string>();
  const channelFocus = useFlashListFocus<Channel>();
  const focusCategoryOn = categoryFocus.focusOn;
  const focusChannelOn = channelFocus.focusOn;

  // Channel focus handler (keep focused row in view + update banner)
  const handleChannelFocus = useCallback(
    (ch: Channel, index: number) => {
      setSelectedChannelId((current) => (current === ch.id ? current : ch.id));
      focusChannelOn(index);
    },
    [focusChannelOn],
  );

  const handleCategoryFocus = useCallback(
    (index: number) => {
      focusCategoryOn(index);
    },
    [focusCategoryOn],
  );

  // Channel press handler: opens full player
  const handleChannelPress = useCallback(
    (ch: Channel) => {
      if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("Player", { channelId: ch.id });
    },
    [navigation],
  );
  const handleFavoriteToggle = useCallback(
    (channelId: string) => {
      void toggleFavorite(channelId);
    },
    [toggleFavorite],
  );
  const renderChannelItem = useCallback(
    ({ item: channel, index }: { item: Channel; index: number }) => (
      <ChannelListItem
        channel={channel}
        index={index + 1}
        hasTVPreferredFocus={isTV && index === 0}
        onFocusChannel={handleChannelFocus}
        onPressChannel={handleChannelPress}
        onFavoriteToggle={handleFavoriteToggle}
      />
    ),
    [handleChannelFocus, handleChannelPress, handleFavoriteToggle],
  );

  return (
    <View style={styles.container}>
      {/* ─── COLUMN 1: CATEGORIES ─── */}
      <View style={styles.categoriesColumn}>
        <View style={styles.columnHeader}>
          <ThemedText type="body" style={styles.columnTitle}>
            {playlist?.channels.length || 0} channels
          </ThemedText>
          <Ionicons name="create-outline" size={16} color={c.accent} />
        </View>

        {/* Categories List */}
        <FlashList
          ref={categoryFocus.listRef}
          data={allCategories}
          keyExtractor={(cat) => cat}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          drawDistance={400}
          onViewableItemsChanged={categoryFocus.onViewableItemsChanged}
          renderItem={({ item: cat, index }) => {
            const isSelected = selectedCategory === cat;
            const count = categoryCounts[cat] || 0;
            const isFav = cat !== "All" && isCategoryFavorite(cat);
            return (
              <CategoryRow
                category={cat}
                count={count}
                isSelected={isSelected}
                isFav={isFav}
                onSelect={() => setSelectedCategory(cat)}
                onToggleFav={() => toggleFavoriteCategory(cat)}
                onFocused={() => handleCategoryFocus(index)}
              />
            );
          }}
        />
      </View>

      {/* ─── COLUMN 2: CHANNELS ─── */}
      <View style={styles.channelsColumn}>
        {/* Category Info Header */}
        <View style={styles.channelHeader}>
          <ThemedText
            type="h3"
            numberOfLines={1}
            style={styles.categoryHeading}
          >
            {selectedCategory}
          </ThemedText>
        </View>

        {/* Channels List */}
        {filteredChannels.length === 0 ? (
          <View style={styles.emptyChannelsContainer}>
            <ThemedText type="body" style={{ color: c.text50 }}>
              No channels found
            </ThemedText>
          </View>
        ) : (
          <FlashList
            ref={channelFocus.listRef}
            data={filteredChannels}
            keyExtractor={(channel) => channel.id}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            drawDistance={500}
            onViewableItemsChanged={channelFocus.onViewableItemsChanged}
            renderItem={renderChannelItem}
          />
        )}
      </View>

      {/* ─── COLUMN 3: EPG PROGRAM BANNER ─── */}
      <TvProgramPreview channel={activeChannel} />
    </View>
  );
}

function TvProgramPreview({ channel }: { channel: Channel | null }) {
  const { theme } = useTheme();
  const { getNowNext, isLoading } = useEpg();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const activeEpg = useMemo(
    () => (channel ? getNowNext(channel.id) : null),
    [channel, getNowNext],
  );

  return (
    <View style={styles.previewColumn}>
      <View style={styles.previewHeaderRow}>
        <ThemedText type="body" style={styles.previewTitle}>
          Now Showing
        </ThemedText>
        {isLoading ? (
          <ThemedText type="caption" style={styles.previewEpgStatus}>
            Updating guide…
          </ThemedText>
        ) : null}
      </View>

      {channel ? (
        <TvEpgBanner
          channel={channel}
          now={activeEpg?.now}
          next={activeEpg?.next}
        />
      ) : (
        <View style={styles.noPreviewContainer}>
          <ThemedText
            type="body"
            style={{ color: createTvPalette(theme).text40 }}
          >
            Select a channel to view its program guide
          </ThemedText>
        </View>
      )}
    </View>
  );
}

// ─── Subcomponents ───

function CategoryRow({
  category,
  count,
  isSelected,
  isFav,
  onSelect,
  onToggleFav,
  onFocused,
}: {
  category: string;
  count: number;
  isSelected: boolean;
  isFav: boolean;
  onSelect: () => void;
  onToggleFav: () => void;
  onFocused: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

  return (
    <TVFocusablePressable
      onPress={onSelect}
      onLongPress={onToggleFav}
      onFocusChange={(f) => {
        if (f) onFocused();
      }}
      accessibilityLabel={category}
      baseStyle={[styles.categoryRow, isSelected && styles.categoryRowSelected]}
      focusedStyle={styles.categoryRowFocused}
    >
      <View style={styles.categoryRowLeft}>
        <View
          style={[
            styles.categoryIcon,
            isSelected && styles.categoryIconSelected,
          ]}
        >
          <ThemedText type="caption" style={styles.categoryIconText}>
            {category === "All" ? "A" : category.charAt(0).toUpperCase()}
          </ThemedText>
        </View>
        {isFav ? (
          <Ionicons
            name="star"
            size={13}
            color={c.accent}
            style={{ marginRight: 6 }}
          />
        ) : null}
        <ThemedText
          type="body"
          numberOfLines={1}
          style={[
            styles.categoryRowText,
            isSelected && styles.categoryRowTextSelected,
          ]}
        >
          {category}
        </ThemedText>
      </View>
      <ThemedText type="small" style={styles.categoryRowCount}>
        {count}
      </ThemedText>
    </TVFocusablePressable>
  );
}

const ChannelListItem = React.memo(function ChannelListItem({
  channel,
  index,
  hasTVPreferredFocus,
  onFocusChannel,
  onPressChannel,
  onFavoriteToggle,
}: {
  channel: Channel;
  index: number;
  hasTVPreferredFocus?: boolean;
  onFocusChannel: (channel: Channel, index: number) => void;
  onPressChannel: (channel: Channel) => void;
  onFavoriteToggle: (channelId: string) => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <TVFocusablePressable
      onPress={() => onPressChannel(channel)}
      onLongPress={() => onFavoriteToggle(channel.id)}
      onFocusChange={(f) => {
        if (f) onFocusChannel(channel, index - 1);
      }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityLabel={channel.name}
      baseStyle={styles.channelCard}
      focusedStyle={styles.channelCardFocused}
    >
      {/* Channel row */}
      <View style={styles.channelInfoContainer}>
        <View style={styles.channelIndex}>
          <ThemedText type="small" style={styles.channelIndexText}>
            {String(index).padStart(2, "0")}
          </ThemedText>
        </View>
        <ThemedText
          type="body"
          numberOfLines={1}
          style={styles.channelNameText}
        >
          {channel.name}
        </ThemedText>
      </View>
    </TVFocusablePressable>
  );
});

// ─── Styles ───

function createStyles(theme: typeof Colors.dark) {
  const c = createTvPalette(theme);
  return StyleSheet.create({
    container: {
      flex: 1,
      flexDirection: "row",
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.xs,
      paddingBottom: Spacing.md,
      gap: 12,
      backgroundColor: "transparent",
    },

    // ─── Column 1: Categories ───
    categoriesColumn: {
      width: "20%",
      backgroundColor: c.panel,
      padding: Spacing.sm,
      borderRadius: BorderRadius.sm,
    },
    columnHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: Spacing.sm,
      paddingHorizontal: 4,
    },
    columnTitle: {
      color: c.text,
      fontSize: 13,
      fontWeight: "600",
    },
    categoryRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 9,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
      marginVertical: 1,
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    categoryRowSelected: {
      backgroundColor: c.selection,
    },
    // Focus = a solid fill that travels with the D-pad (square, borderless),
    // matching the channel list language.
    categoryRowFocused: {
      backgroundColor: c.focusFillStrong,
    },
    categoryRowLeft: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
    },
    categoryIcon: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: c.border,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 8,
    },
    categoryIconSelected: {
      backgroundColor: c.accentTintStrong,
    },
    categoryIconText: {
      color: c.accent,
      fontWeight: "800",
    },
    categoryRowText: {
      color: c.text75,
      fontSize: 13.5,
      fontWeight: "500",
    },
    categoryRowTextSelected: {
      color: c.accent,
      fontWeight: "700",
    },
    categoryRowCount: {
      color: c.text40,
      fontSize: 12,
      marginLeft: Spacing.xs,
    },

    // ─── Column 2: Channels ───
    channelsColumn: {
      width: "38%",
      paddingRight: Spacing.xs,
    },
    channelHeader: {
      marginBottom: Spacing.xs,
    },
    categoryHeading: {
      color: c.text,
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: 0.2,
    },
    emptyChannelsContainer: {
      padding: Spacing.xl,
      alignItems: "center",
    },
    channelCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.panel,
      minHeight: 58,
      paddingHorizontal: 10,
      marginBottom: 4,
      borderRadius: BorderRadius.xs,
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    // Focus = a solid fill that travels with the D-pad (square, borderless).
    channelCardFocused: {
      backgroundColor: c.focusFillStrong,
      borderColor: c.accent,
    },
    channelInfoContainer: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    channelIndex: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.border,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 10,
    },
    channelIndexText: {
      color: c.text60,
      fontWeight: "700",
    },
    channelNameText: {
      color: c.text,
      fontSize: 14.5,
      fontWeight: "700",
    },

    // ─── Column 3: EPG Program Banner ───
    previewColumn: {
      flex: 1,
      backgroundColor: c.panel,
      padding: Spacing.md,
      borderRadius: BorderRadius.sm,
    },
    previewHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: Spacing.sm,
    },
    previewTitle: {
      color: c.accent,
      fontSize: 15,
      fontWeight: "700",
    },
    previewEpgStatus: {
      color: c.text40,
      fontSize: 11,
    },
    noPreviewContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
