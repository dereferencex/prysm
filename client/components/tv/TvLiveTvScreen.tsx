import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
  ViewStyle,
  ScrollView,
  type LayoutChangeEvent,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
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
const placeholderImage = require("../../../assets/images/placeholder-channel.png");

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
    favorites,
    favoriteCategories,
    toggleFavorite,
    toggleFavoriteCategory,
    isCategoryFavorite,
    settings,
  } = usePlaylist();
  const epg = useEpg();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

  // Search queries
  const [categorySearch, setCategorySearch] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [showOnlyFavCategories, setShowOnlyFavCategories] = useState(false);

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
    let list = allCategories;
    if (showOnlyFavCategories) {
      list = list.filter((c) => c === "All" || favoriteCategories.includes(c));
    }
    if (categorySearch.trim()) {
      const q = categorySearch.toLowerCase().trim();
      list = list.filter((c) => c.toLowerCase().includes(q));
    }
    return list;
  }, [
    allCategories,
    showOnlyFavCategories,
    categorySearch,
    favoriteCategories,
  ]);

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

    if (channelSearch.trim()) {
      const q = channelSearch.toLowerCase().trim();
      channels = channels.filter(
        (ch) =>
          ch.name.toLowerCase().includes(q) ||
          (ch.group && ch.group.toLowerCase().includes(q)),
      );
    }

    return channels;
  }, [playlist, selectedCategory, categoryTypeFilter, channelSearch]);

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

  const providerName = playlist?.name || "Provider";

  return (
    <View style={styles.container}>
      {/* ─── COLUMN 1: CATEGORIES ─── */}
      <View style={styles.categoriesColumn}>
        <View style={styles.columnHeader}>
          <ThemedText type="h3" style={styles.columnTitle}>
            Categories
          </ThemedText>
        </View>

        {/* Search Categories */}
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            value={categorySearch}
            onChangeText={setCategorySearch}
            placeholder="Search categories..."
            placeholderTextColor={c.text40}
          />
          <Ionicons
            name="search"
            size={18}
            color={c.text40}
            style={styles.searchIcon}
          />
        </View>

        {/* Quick Filters */}
        <View style={styles.quickFiltersContainer}>
          <View style={styles.quickFiltersRow}>
            <ThemedText type="small" style={styles.quickFiltersLabel}>
              Quick filters
            </ThemedText>
            <Pressable
              onPress={() => setShowOnlyFavCategories((prev) => !prev)}
              focusable
              style={styles.quickFiltersButton}
            >
              <ThemedText type="caption" style={styles.quickFiltersAction}>
                {showOnlyFavCategories ? "Show All" : "Favorites"}
              </ThemedText>
            </Pressable>
          </View>
          <ThemedText type="caption" style={styles.quickFiltersSubtext}>
            {showOnlyFavCategories
              ? "Showing favorite categories"
              : "Showing all categories"}
          </ThemedText>
        </View>

        {/* Categories List */}
        <ScrollView
          ref={categoryScroll.scrollRef}
          style={styles.categoryScrollView}
          showsVerticalScrollIndicator={false}
          onLayout={categoryScroll.onScrollViewLayout}
          onScroll={categoryScroll.onScroll}
          scrollEventThrottle={16}
        >
          {filteredCategories.map((cat) => {
            const isSelected = selectedCategory === cat;
            const count = categoryCounts[cat] || 0;
            const isFav = cat !== "All" && isCategoryFavorite(cat);

            return (
              <CategoryRow
                key={cat}
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
          })}
        </ScrollView>
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
          <ThemedText type="small" style={styles.providerSubtext}>
            Provider: {providerName} • {filteredChannels.length} channels
          </ThemedText>
        </View>

        {/* Search Channels */}
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            value={channelSearch}
            onChangeText={setChannelSearch}
            placeholder="Search channels..."
            placeholderTextColor={c.text40}
          />
          <Ionicons
            name="search"
            size={18}
            color={c.text40}
            style={styles.searchIcon}
          />
        </View>

        {/* Channels List */}
        <ScrollView
          ref={channelScroll.scrollRef}
          style={styles.channelScrollView}
          showsVerticalScrollIndicator={false}
          onLayout={channelScroll.onScrollViewLayout}
          onScroll={channelScroll.onScroll}
          scrollEventThrottle={16}
        >
          {filteredChannels.length === 0 ? (
            <View style={styles.emptyChannelsContainer}>
              <ThemedText type="body" style={{ color: c.text50 }}>
                No channels found
              </ThemedText>
            </View>
          ) : (
            filteredChannels.map((channel, index) => {
              const isSelected = selectedChannelId === channel.id;
              const isFocused = focusedChannelId === channel.id;
              const channelEpg = epg.getNowNext(channel.id);
              const nowTitle = channelEpg?.now?.title;

              return (
                <ChannelListItem
                  key={channel.id}
                  channel={channel}
                  index={index + 1}
                  nowTitle={nowTitle}
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
            })
          )}
        </ScrollView>
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
            onPress={() => handleChannelPress(activeChannel)}
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
  const [isFocused, setIsFocused] = useState(false);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

  return (
    <Pressable
      onPress={onSelect}
      onLongPress={onToggleFav}
      onLayout={onLayoutItem}
      onFocus={() => {
        setIsFocused(true);
        onFocused();
      }}
      onBlur={() => setIsFocused(false)}
      focusable
      style={
        [
          styles.categoryRow,
          isSelected && styles.categoryRowSelected,
          isFocused && styles.categoryRowFocused,
        ] as ViewStyle[]
      }
    >
      <View style={styles.categoryRowLeft}>
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
            isFocused && { color: c.text },
          ]}
        >
          {category}
        </ThemedText>
      </View>
      <ThemedText type="small" style={styles.categoryRowCount}>
        {count}
      </ThemedText>
    </Pressable>
  );
}

function ChannelListItem({
  channel,
  index,
  nowTitle,
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
  nowTitle?: string;
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
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onLayout={onLayoutItem}
      onFocus={() => {
        setInternalFocused(true);
        onFocus();
      }}
      onBlur={() => setInternalFocused(false)}
      focusable
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={
        [
          styles.channelCard,
          activeFocus && styles.channelCardFocused,
          !activeFocus && isSelected && styles.channelCardSelected,
        ] as ViewStyle[]
      }
    >
      {/* Channel Logo */}
      <View style={styles.channelLogoContainer}>
        <Image
          source={channel.logo ? { uri: channel.logo } : placeholderImage}
          style={styles.channelLogo}
          contentFit="contain"
          placeholder={placeholderImage}
        />
      </View>

      {/* Info Column */}
      <View style={styles.channelInfoContainer}>
        <ThemedText
          type="body"
          numberOfLines={1}
          style={[
            styles.channelNameText,
            activeFocus && styles.channelNameTextFocused,
          ]}
        >
          {String(index).padStart(2, "0")} {channel.name}
        </ThemedText>
        <ThemedText
          type="small"
          numberOfLines={1}
          style={styles.channelSubtitle}
        >
          {nowTitle || "No schedule information"}
        </ThemedText>
      </View>
    </Pressable>
  );
}

// ─── Styles ───

function createStyles(theme: typeof Colors.dark) {
  const c = createTvPalette(theme);
  return StyleSheet.create({
    container: {
      flex: 1,
      flexDirection: "row",
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.xs,
      paddingBottom: Spacing.lg,
      gap: Spacing.lg,
      backgroundColor: "transparent",
    },

    // ─── Column 1: Categories ───
    categoriesColumn: {
      width: "27%",
      backgroundColor: c.panel,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.borderSubtle,
      padding: Spacing.md,
    },
    columnHeader: {
      marginBottom: Spacing.sm,
    },
    columnTitle: {
      color: c.text,
      fontSize: 19,
      fontWeight: "700",
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
    categoryRowFocused: {
      borderColor: c.focusBorder,
      backgroundColor: c.focusFill,
    },
    categoryRowLeft: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
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
      width: "41%",
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
      borderRadius: 14,
      padding: 9,
      marginBottom: 7,
      borderWidth: 2,
      borderColor: "transparent",
    },
    channelCardSelected: {
      backgroundColor: c.selection,
    },
    // High-visibility focus outline exactly matching reference screenshot:
    channelCardFocused: {
      borderColor: c.focusBorder,
      backgroundColor: c.focusFill,
      shadowColor: c.accent,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
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
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.borderSubtle,
      padding: Spacing.md,
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
