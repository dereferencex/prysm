import React, { useMemo } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  type LayoutChangeEvent,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThemedText } from "@/components/ThemedText";
import { TVFocusablePressable } from "@/components/TVFocusablePressable";
import { usePlaylist } from "@/context/PlaylistContext";
import { useTheme } from "@/hooks/useTheme";
import { useFocusScroll } from "@/hooks/useFocusScroll";
import { Colors, Spacing } from "@/constants/theme";
import { createTvPalette } from "./tvPalette";
import { Channel } from "@/types/playlist";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

const placeholderImage = require("../../../assets/images/placeholder-channel.png");

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function TvFavoritesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const { playlist, favorites, toggleFavorite } = usePlaylist();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);
  const resultsScroll = useFocusScroll<string>({ axis: "vertical" });

  const favoriteChannels = useMemo(() => {
    if (!playlist) return [];
    return playlist.channels.filter((ch) => favorites.includes(ch.id));
  }, [playlist, favorites]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="h3" style={styles.title}>
          Favorites
        </ThemedText>
        <ThemedText type="small" style={styles.subtitle}>
          {favoriteChannels.length} channel
          {favoriteChannels.length === 1 ? "" : "s"} • Long-press a channel to
          remove it
        </ThemedText>
      </View>

      <ScrollView
        ref={resultsScroll.scrollRef}
        style={styles.resultsScroll}
        contentContainerStyle={styles.resultsGrid}
        showsVerticalScrollIndicator={false}
        onLayout={resultsScroll.onScrollViewLayout}
        onScroll={resultsScroll.onScroll}
        scrollEventThrottle={16}
      >
        {favoriteChannels.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="star-outline" size={48} color={c.text40} />
            <ThemedText type="body" style={styles.emptyText}>
              No favorite channels yet. Open Live TV and long-press a channel
              to add it here.
            </ThemedText>
          </View>
        ) : (
          favoriteChannels.map((channel) => (
            <FavoriteChannelCard
              key={channel.id}
              channel={channel}
              onPress={() =>
                navigation.navigate("Player", { channelId: channel.id })
              }
              onLongPress={() => toggleFavorite(channel.id)}
              onLayoutItem={(e) => resultsScroll.registerItem(channel.id, e)}
              onFocused={() => resultsScroll.focusOn(channel.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function FavoriteChannelCard({
  channel,
  onPress,
  onLongPress,
  onLayoutItem,
  onFocused,
}: {
  channel: Channel;
  onPress: () => void;
  onLongPress: () => void;
  onLayoutItem: (e: LayoutChangeEvent) => void;
  onFocused: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <TVFocusablePressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={600}
      onLayout={onLayoutItem}
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
}

function createStyles(theme: typeof Colors.dark) {
  const c = createTvPalette(theme);
  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.xs,
    },
    headerRow: {
      marginBottom: Spacing.md,
    },
    title: {
      color: c.text,
      fontSize: 20,
      fontWeight: "800",
    },
    subtitle: {
      color: c.text50,
      marginTop: 2,
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
      gap: Spacing.md,
    },
    emptyText: {
      color: c.text50,
      textAlign: "center",
      maxWidth: 420,
    },
  });
}
