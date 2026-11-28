import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  Platform,
  type LayoutChangeEvent,
} from "react-native";
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
import { useFocusScroll } from "@/hooks/useFocusScroll";
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
    toggleFavorite,
    toggleFavoriteCategory,
    isCategoryFavorite,
  } = usePlaylist();
  const epg = useEpg();
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

  // Filtered categories (by search and favorites)
  const filteredCategories = useMemo(() => {
    return allCategories;
  }, [allCategories]);

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
    let channels = playlist.channels;

    if (selectedCategory !== "All") {
      channels = channels.filter((ch) => ch.group === selectedCategory);
    } else if (categoryTypeFilter === "movies") {
      channels = channels.filter((ch) =>
        /movie|cinema|film|vod/i.test(ch.group || ""),
      );
      if (channels.length === 0) channels = playlist.channels;
    } else if (categoryTypeFilter === "series") {
      channels = channels.filter((ch) =>
        /series|serie|show|season/i.test(ch.group || ""),
      );
      if (channels.length === 0) channels = playlist.channels;
    }

    return channels;
  }, [playlist, selectedCategory, categoryTypeFilter]);

  // Selected Channel for Preview
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );
  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(null);

  // Sync selected channel with filtered list
  useEffect(() => {
    if (filteredChannels.length > 0) {
      if (
        !selectedChannelId ||
        !filteredChannels.some((ch) => ch.id === selectedChannelId)
      ) {
        setSelectedChannelId(filteredChannels[0].id);
      }
    } else {
      setSelectedChannelId(null);
    }
  }, [filteredChannels, selectedChannelId]);

  const activeChannel = useMemo(() => {
    if (!playlist) return null;
    return (
      filteredChannels.find((ch) => ch.id === selectedChannelId) ||
      playlist.channels.find((ch) => ch.id === selectedChannelId) ||
      filteredChannels[0] ||
      null
    );
  }, [playlist, filteredChannels, selectedChannelId]);

  // Focus auto-scroll for the two vertical lists
  const categoryScroll = useFocusScroll<string>({ axis: "vertical" });
  const channelScroll = useFocusScroll<string>({ axis: "vertical" });

  // Channel focus handler (keep focused row in view + update banner)
  const handleChannelFocus = useCallback(
    (ch: Channel) => {
      setFocusedChannelId(ch.id);
      setSelectedChannelId(ch.id);
      channelScroll.focusOn(ch.id);
    },
    [channelScroll],
  );

  const handleCategoryFocus = useCallback(
    (cat: string) => {
      categoryScroll.focusOn(cat);
    },
    [categoryScroll],
  );

  // Channel press handler: opens full player
  const handleChannelPress = useCallback(
    (ch: Channel) => {
      if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("Player", { channelId: ch.id });
    },
    [navigation],
  );

  // EPG details for the active banner channel
  const activeEpg = useMemo(() => {
    if (!activeChannel) return null;
    return epg.getNowNext(activeChannel.id);
  }, [activeChannel, epg]);

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
          data={filteredCategories}
          keyExtractor={(cat) => cat}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          renderItem={({ item: cat }) => {
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
                onLayoutItem={(e) => categoryScroll.registerItem(cat, e)}
                onFocused={() => handleCategoryFocus(cat)}
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
            data={filteredChannels}
            keyExtractor={(channel) => channel.id}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            renderItem={({ item: channel, index }) => {
              const isSelected = selectedChannelId === channel.id;
              const isFocused = focusedChannelId === channel.id;
              return (
                <ChannelListItem
                  channel={channel}
                  index={index + 1}
                  isSelected={isSelected}
                  isFocused={isFocused}
                  hasTVPreferredFocus={isTV && index === 0}
                  onLayoutItem={(e) =>
                    channelScroll.registerItem(channel.id, e)
                  }
                  onFocus={() => handleChannelFocus(channel)}
                  onPress={() => handleChannelPress(channel)}
                  onLongPress={() => toggleFavorite(channel.id)}
                />
              );
            }}
          />
        )}
      </View>

      {/* ─── COLUMN 3: EPG PROGRAM BANNER ─── */}
      <View style={styles.previewColumn}>
        <View style={styles.previewHeaderRow}>
          <ThemedText type="body" style={styles.previewTitle}>
            Now Showing
          </ThemedText>
          {epg.isLoading ? (
            <ThemedText type="caption" style={styles.previewEpgStatus}>
              Updating guide…
            </ThemedText>
          ) : null}
        </View>

        {activeChannel ? (
          <TvEpgBanner
            channel={activeChannel}
            now={activeEpg?.now}
            next={activeEpg?.next}
          />
        ) : (
          <View style={styles.noPreviewContainer}>
            <ThemedText type="body" style={{ color: c.text40 }}>
              Select a channel to view its program guide
            </ThemedText>
          </View>
        )}
      </View>
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
  onLayoutItem,
  onFocused,
}: {
  category: string;
  count: number;
  isSelected: boolean;
  isFav: boolean;
  onSelect: () => void;
  onToggleFav: () => void;
  onLayoutItem: (e: LayoutChangeEvent) => void;
  onFocused: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

  return (
    <TVFocusablePressable
      onPress={onSelect}
      onLongPress={onToggleFav}
      onLayout={onLayoutItem}
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

function ChannelListItem({
  channel,
  index,
  isSelected,
  isFocused,
  hasTVPreferredFocus,
  onLayoutItem,
  onFocus,
  onPress,
  onLongPress,
}: {
  channel: Channel;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
  hasTVPreferredFocus?: boolean;
  onLayoutItem: (e: LayoutChangeEvent) => void;
  onFocus: () => void;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { theme } = useTheme();
  const [internalFocused, setInternalFocused] = useState(false);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const activeFocus = isFocused || internalFocused;

  return (
    <TVFocusablePressable
      onPress={onPress}
      onLongPress={onLongPress}
      onLayout={onLayoutItem}
      onFocusChange={(f) => {
        setInternalFocused(f);
        if (f) onFocus();
      }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityLabel={channel.name}
      baseStyle={[
        styles.channelCard,
        !activeFocus && isSelected && styles.channelCardSelected,
      ]}
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
          style={[
            styles.channelNameText,
            activeFocus && styles.channelNameTextFocused,
          ]}
        >
          {channel.name}
        </ThemedText>
      </View>
    </TVFocusablePressable>
  );
}

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
    searchBox: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.inset,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.sm,
      height: 38,
      marginBottom: Spacing.sm,
    },
    searchInput: {
      flex: 1,
      color: c.text,
      fontSize: 13,
      paddingVertical: 0,
    },
    searchIcon: {
      marginLeft: Spacing.xs,
    },
    quickFiltersContainer: {
      marginBottom: Spacing.sm,
      paddingBottom: Spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: c.borderFaint,
    },
    quickFiltersRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    quickFiltersLabel: {
      color: c.text,
      fontWeight: "600",
      fontSize: 13,
    },
    quickFiltersButton: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: BorderRadius.xs,
    },
    quickFiltersButtonFocused: {
      backgroundColor: c.focusFillStrong,
    },
    quickFiltersAction: {
      color: c.accent,
      fontWeight: "600",
    },
    quickFiltersSubtext: {
      color: c.text40,
      fontSize: 11,
      marginTop: 2,
    },
    categoryScrollView: {
      flex: 1,
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
    providerSubtext: {
      color: c.text50,
      fontSize: 12,
      marginTop: 2,
      marginBottom: Spacing.xs,
    },
    channelScrollView: {
      flex: 1,
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
    channelCardSelected: {
      backgroundColor: c.selection,
    },
    // Focus = a solid fill that travels with the D-pad (square, borderless).
    channelCardFocused: {
      backgroundColor: c.focusFillStrong,
      borderColor: c.accent,
    },
    channelLogoContainer: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: c.inset,
      alignItems: "center",
      justifyContent: "center",
      marginRight: Spacing.md,
      padding: 3,
    },
    channelLogo: {
      width: "100%",
      height: "100%",
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
    channelNameTextFocused: {
      color: c.text,
    },
    channelSubtitle: {
      color: c.text50,
      fontSize: 12,
      marginTop: 3,
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
