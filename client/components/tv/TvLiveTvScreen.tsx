import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
  ViewStyle,
  ScrollView,
  Dimensions,
  ActivityIndicator,
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
import { Spacing, BorderRadius } from "@/constants/theme";
import { Channel } from "@/types/playlist";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  TvPlayerView,
  TvPlayerCommands,
} from "../../../modules/tv-player/src/index";

const isTV = Platform.isTV;
const placeholderImage = require("../../../assets/images/placeholder-channel.png");

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface TvLiveTvScreenProps {
  categoryTypeFilter?: "all" | "movies" | "series";
}

function formatTimeHHMM(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
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
      cats = cats.filter((c) =>
        /movie|cinema|film|vod|vod/i.test(c),
      );
      if (cats.length === 0) cats = [...playlist.categories];
    } else if (categoryTypeFilter === "series") {
      cats = cats.filter((c) =>
        /series|serie|show|season|tv show/i.test(c),
      );
      if (cats.length === 0) cats = [...playlist.categories];
    }

    return ["All", ...cats];
  }, [playlist, categoryTypeFilter]);

  // Filtered categories (by search and favorites)
  const filteredCategories = useMemo(() => {
    let list = allCategories;
    if (showOnlyFavCategories) {
      list = list.filter(
        (c) => c === "All" || favoriteCategories.includes(c),
      );
    }
    if (categorySearch.trim()) {
      const q = categorySearch.toLowerCase().trim();
      list = list.filter((c) => c.toLowerCase().includes(q));
    }
    return list;
  }, [allCategories, showOnlyFavCategories, categorySearch, favoriteCategories]);

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
    if (selectedCategory !== "All" && !allCategories.includes(selectedCategory)) {
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

  // Video Preview Player
  const previewPlayerRef = useRef<any>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const debouncePreviewRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadChannelPreview = useCallback((channel: Channel) => {
    if (!previewPlayerRef.current) return;
    setPreviewError(false);
    try {
      TvPlayerCommands.loadSource(previewPlayerRef, {
        url: channel.url,
        headers: channel.headers,
        drmType: channel.drm?.type,
        drmLicenseUrl: channel.drm?.licenseServer,
        drmLicenseKey: channel.drm?.licenseKey,
        drmHeaders: channel.drm?.headers,
        drmPssh: channel.drm?.pssh,
        autoPlay: true,
      });
      // Mute preview playback to avoid audio clash while browsing
      TvPlayerCommands.setVolume(previewPlayerRef, 0);
    } catch (e) {
      setPreviewError(true);
    }
  }, []);

  useEffect(() => {
    if (!activeChannel) return;

    if (debouncePreviewRef.current) {
      clearTimeout(debouncePreviewRef.current);
    }

    debouncePreviewRef.current = setTimeout(() => {
      loadChannelPreview(activeChannel);
    }, 200);

    return () => {
      if (debouncePreviewRef.current) {
        clearTimeout(debouncePreviewRef.current);
      }
    };
  }, [activeChannel, loadChannelPreview]);

  // Channel focus handler (debounced preview update)
  const handleChannelFocus = useCallback((ch: Channel) => {
    setFocusedChannelId(ch.id);
    setSelectedChannelId(ch.id);
  }, []);

  // Channel press handler: opens full player
  const handleChannelPress = useCallback(
    (ch: Channel) => {
      if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("Player", { channelId: ch.id });
    },
    [navigation],
  );

  // EPG details for the active preview channel
  const activeEpg = useMemo(() => {
    if (!activeChannel) return null;
    return epg.getNowNext(activeChannel.id);
  }, [activeChannel, epg]);

  const currentProgram = activeEpg?.now;
  const programTime = useMemo(() => {
    if (!currentProgram) return "";
    const startStr = formatTimeHHMM(currentProgram.start);
    const endStr = formatTimeHHMM(currentProgram.end);
    if (!startStr && !endStr) return "";
    return `${startStr} – ${endStr}`;
  }, [currentProgram]);

  const programProgress = useMemo(() => {
    if (!currentProgram || !currentProgram.start || !currentProgram.end) return 0;
    const now = Date.now();
    const total = currentProgram.end - currentProgram.start;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, (now - currentProgram.start) / total));
  }, [currentProgram]);

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
            placeholderTextColor="rgba(255, 255, 255, 0.4)"
          />
          <Ionicons
            name="search"
            size={18}
            color="rgba(255, 255, 255, 0.4)"
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
          style={styles.categoryScrollView}
          showsVerticalScrollIndicator={false}
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
            placeholderTextColor="rgba(255, 255, 255, 0.4)"
          />
          <Ionicons
            name="search"
            size={18}
            color="rgba(255, 255, 255, 0.4)"
            style={styles.searchIcon}
          />
        </View>

        {/* Channels List */}
        <ScrollView
          style={styles.channelScrollView}
          showsVerticalScrollIndicator={false}
        >
          {filteredChannels.length === 0 ? (
            <View style={styles.emptyChannelsContainer}>
              <ThemedText type="body" style={{ color: "rgba(255, 255, 255, 0.5)" }}>
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
                  onFocus={() => handleChannelFocus(channel)}
                  onPress={() => handleChannelPress(channel)}
                  onLongPress={() => toggleFavorite(channel.id)}
                />
              );
            })
          )}
        </ScrollView>
      </View>

      {/* ─── COLUMN 3: CHANNEL PREVIEW ─── */}
      <View style={styles.previewColumn}>
        <ThemedText type="body" style={styles.previewTitle}>
          Channel Preview
        </ThemedText>

        {activeChannel ? (
          <View style={styles.previewContent}>
            {/* Video Frame */}
            <Pressable
              onPress={() => handleChannelPress(activeChannel)}
              focusable
              style={({ focused }) => [
                styles.videoContainer,
                focused && styles.videoContainerFocused,
              ]}
            >
              <TvPlayerView
                ref={previewPlayerRef}
                style={styles.videoPlayer}
                onPlayingChange={(e) =>
                  setPreviewPlaying(e.nativeEvent.isPlaying)
                }
                onError={() => setPreviewError(true)}
              />

              {/* Fallback / Poster overlay if native video is offline or loading */}
              {(!previewPlaying || previewError) && (
                <View style={styles.previewPosterOverlay}>
                  <Image
                    source={
                      activeChannel.logo
                        ? { uri: activeChannel.logo }
                        : placeholderImage
                    }
                    style={styles.previewLogo}
                    contentFit="contain"
                  />
                  {previewPlaying ? null : (
                    <ActivityIndicator
                      size="small"
                      color="#38BDF8"
                      style={{ marginTop: 8 }}
                    />
                  )}
                </View>
              )}
            </Pressable>

            {/* Channel & Program Info */}
            <View style={styles.previewInfoContainer}>
              <ThemedText
                type="h3"
                numberOfLines={1}
                style={styles.previewChannelName}
              >
                {activeChannel.name}
              </ThemedText>

              <ThemedText
                type="body"
                numberOfLines={1}
                style={styles.previewShowTitle}
              >
                {currentProgram?.title || "No schedule information"}
              </ThemedText>

              {programTime ? (
                <ThemedText type="small" style={styles.previewTime}>
                  {programTime}
                </ThemedText>
              ) : null}

              {/* Progress Bar */}
              {currentProgram ? (
                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.round(programProgress * 100)}%` },
                    ]}
                  />
                </View>
              ) : null}

              {/* Description */}
              <ThemedText
                type="caption"
                numberOfLines={3}
                style={styles.previewDescription}
              >
                {currentProgram?.desc ||
                  (activeChannel.group
                    ? `Category: ${activeChannel.group}`
                    : "Live TV broadcast")}
              </ThemedText>

              {/* Open Prompt / Action */}
              <Pressable
                onPress={() => handleChannelPress(activeChannel)}
                focusable
                style={({ focused }) => [
                  styles.openActionContainer,
                  focused && styles.openActionContainerFocused,
                ]}
              >
                <ThemedText type="body" style={styles.openActionText}>
                  Press OK again to open this channel
                </ThemedText>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.noPreviewContainer}>
            <ThemedText type="body" style={{ color: "rgba(255, 255, 255, 0.4)" }}>
              Select a channel to preview
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
}: {
  category: string;
  count: number;
  isSelected: boolean;
  isFav: boolean;
  onSelect: () => void;
  onToggleFav: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Pressable
      onPress={onSelect}
      onLongPress={onToggleFav}
      onFocus={() => setIsFocused(true)}
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
            color="#38BDF8"
            style={{ marginRight: 6 }}
          />
        ) : null}
        <ThemedText
          type="body"
          numberOfLines={1}
          style={[
            styles.categoryRowText,
            isSelected && styles.categoryRowTextSelected,
            isFocused && { color: "#FFFFFF" },
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
  onFocus,
  onPress,
  onLongPress,
}: {
  channel: Channel;
  index: number;
  nowTitle?: string;
  isSelected: boolean;
  isFocused: boolean;
  onFocus: () => void;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const [internalFocused, setInternalFocused] = useState(false);
  const activeFocus = isFocused || internalFocused;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={() => {
        setInternalFocused(true);
        onFocus();
      }}
      onBlur={() => setInternalFocused(false)}
      focusable
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
          source={
            channel.logo ? { uri: channel.logo } : placeholderImage
          }
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
          {String(index).padStart(2, "0")}  {channel.name}
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

const styles = StyleSheet.create({
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
    backgroundColor: "rgba(12, 22, 37, 0.92)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    padding: Spacing.md,
  },
  columnHeader: {
    marginBottom: Spacing.sm,
  },
  columnTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "700",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(7, 13, 23, 0.9)",
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: Spacing.sm,
    height: 38,
    marginBottom: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: "#FFFFFF",
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
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
  },
  quickFiltersRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quickFiltersLabel: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 13,
  },
  quickFiltersButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  quickFiltersAction: {
    color: "#38BDF8",
    fontWeight: "600",
  },
  quickFiltersSubtext: {
    color: "rgba(255, 255, 255, 0.4)",
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
    backgroundColor: "rgba(30, 58, 95, 0.65)",
  },
  categoryRowFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(56, 189, 248, 0.2)",
    transform: [{ scale: 1.02 }],
  },
  categoryRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  categoryRowText: {
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: 13.5,
    fontWeight: "500",
  },
  categoryRowTextSelected: {
    color: "#38BDF8",
    fontWeight: "700",
  },
  categoryRowCount: {
    color: "rgba(255, 255, 255, 0.4)",
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
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  providerSubtext: {
    color: "rgba(255, 255, 255, 0.5)",
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
    backgroundColor: "rgba(12, 22, 37, 0.8)",
    borderRadius: 14,
    padding: 9,
    marginBottom: 7,
    borderWidth: 2,
    borderColor: "transparent",
  },
  channelCardSelected: {
    backgroundColor: "rgba(18, 33, 55, 0.95)",
  },
  // High-visibility focus outline exactly matching reference screenshot:
  channelCardFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(24, 44, 73, 1)",
    transform: [{ scale: 1.02 }],
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  channelLogoContainer: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "rgba(7, 14, 25, 0.85)",
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
    color: "#FFFFFF",
    fontSize: 14.5,
    fontWeight: "700",
  },
  channelNameTextFocused: {
    color: "#FFFFFF",
  },
  channelSubtitle: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 12,
    marginTop: 3,
  },

  // ─── Column 3: Channel Preview ───
  previewColumn: {
    flex: 1,
    backgroundColor: "rgba(12, 22, 37, 0.92)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    padding: Spacing.md,
  },
  previewTitle: {
    color: "#38BDF8",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: Spacing.sm,
  },
  previewContent: {
    flex: 1,
  },
  noPreviewContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  videoContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  videoContainerFocused: {
    borderColor: "#FFFFFF",
    transform: [{ scale: 1.02 }],
  },
  videoPlayer: {
    ...StyleSheet.absoluteFillObject,
  },
  previewPosterOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7, 13, 23, 0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewLogo: {
    width: 68,
    height: 68,
  },
  previewInfoContainer: {
    marginTop: Spacing.md,
    flex: 1,
  },
  previewChannelName: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  previewShowTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
  previewTime: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 12,
    marginTop: 2,
  },
  progressBarTrack: {
    height: 3,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 2,
    marginTop: 6,
    marginBottom: Spacing.xs,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#38BDF8",
    borderRadius: 2,
  },
  previewDescription: {
    color: "rgba(255, 255, 255, 0.65)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  openActionContainer: {
    marginTop: Spacing.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.sm,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  openActionContainerFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(56, 189, 248, 0.2)",
  },
  openActionText: {
    color: "#38BDF8",
    fontSize: 13.5,
    fontWeight: "600",
  },
});
