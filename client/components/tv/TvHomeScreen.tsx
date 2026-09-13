import React, { useMemo } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThemedText } from "@/components/ThemedText";
import { usePlaylist } from "@/context/PlaylistContext";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { Channel } from "@/types/playlist";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import { TvTabName } from "./TvTopNav";

const placeholderImage = require("../../../assets/images/placeholder-channel.png");

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface TvHomeScreenProps {
  onNavigateTab: (tab: TvTabName) => void;
}

export function TvHomeScreen({ onNavigateTab }: TvHomeScreenProps) {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const { playlist, favorites, recentChannels } = usePlaylist();

  const favoriteChannelList = useMemo(() => {
    if (!playlist) return [];
    return playlist.channels.filter((c) => favorites.includes(c.id));
  }, [playlist, favorites]);

  const recentChannelList = useMemo(() => {
    if (!playlist) return [];
    return recentChannels
      .map((id) => playlist.channels.find((c) => c.id === id))
      .filter((c): c is Channel => Boolean(c));
  }, [playlist, recentChannels]);

  const handleChannelPress = (ch: Channel) => {
    navigation.navigate("Player", { channelId: ch.id });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Quick Action Tiles */}
      <View style={styles.quickTilesRow}>
        <QuickTile
          icon="tv"
          title="Live TV"
          subtitle={`${playlist?.channels.length || 0} channels`}
          onPress={() => onNavigateTab("Live TV")}
        />
        <QuickTile
          icon="calendar"
          title="TV Guide"
          subtitle="EPG timeline"
          onPress={() => onNavigateTab("Guide")}
        />
        <QuickTile
          icon="star"
          title="Favorites"
          subtitle={`${favorites.length} channels`}
          onPress={() => onNavigateTab("Live TV")}
        />
        <QuickTile
          icon="search"
          title="Search"
          subtitle="Find any stream"
          onPress={() => onNavigateTab("Search")}
        />
      </View>

      {/* Recently Watched */}
      {recentChannelList.length > 0 && (
        <View style={styles.sectionContainer}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Recently Watched
          </ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.channelRow}
          >
            {recentChannelList.map((channel) => (
              <ChannelCardTv
                key={channel.id}
                channel={channel}
                onPress={() => handleChannelPress(channel)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Favorite Channels */}
      <View style={styles.sectionContainer}>
        <ThemedText type="h4" style={styles.sectionTitle}>
          Favorite Channels
        </ThemedText>
        {favoriteChannelList.length === 0 ? (
          <ThemedText type="body" style={styles.emptyText}>
            No favorite channels yet. Long-press any channel in Live TV to add it.
          </ThemedText>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.channelRow}
          >
            {favoriteChannelList.map((channel) => (
              <ChannelCardTv
                key={channel.id}
                channel={channel}
                onPress={() => handleChannelPress(channel)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </ScrollView>
  );
}

function QuickTile({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const [isFocused, setIsFocused] = React.useState(false);

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      focusable
      style={
        [
          styles.quickTile,
          isFocused && styles.quickTileFocused,
        ] as ViewStyle[]
      }
    >
      <View style={styles.tileIconContainer}>
        <Ionicons name={icon} size={24} color="#38BDF8" />
      </View>
      <ThemedText type="body" style={styles.tileTitle}>
        {title}
      </ThemedText>
      <ThemedText type="caption" style={styles.tileSubtitle}>
        {subtitle}
      </ThemedText>
    </Pressable>
  );
}

function ChannelCardTv({
  channel,
  onPress,
}: {
  channel: Channel;
  onPress: () => void;
}) {
  const [isFocused, setIsFocused] = React.useState(false);

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      focusable
      style={
        [
          styles.channelCard,
          isFocused && styles.channelCardFocused,
        ] as ViewStyle[]
      }
    >
      <View style={styles.cardLogoBox}>
        <Image
          source={
            channel.logo ? { uri: channel.logo } : placeholderImage
          }
          style={styles.cardLogo}
          contentFit="contain"
          placeholder={placeholderImage}
        />
      </View>
      <ThemedText
        type="small"
        numberOfLines={1}
        style={styles.cardChannelName}
      >
        {channel.name}
      </ThemedText>
      <ThemedText
        type="caption"
        numberOfLines={1}
        style={styles.cardCategory}
      >
        {channel.group || "Live TV"}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  contentContainer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing["3xl"],
  },
  quickTilesRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  quickTile: {
    flex: 1,
    backgroundColor: "rgba(12, 22, 37, 0.85)",
    borderRadius: 16,
    padding: Spacing.md,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  quickTileFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(24, 44, 73, 1)",
    transform: [{ scale: 1.04 }],
  },
  tileIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  tileTitle: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
  tileSubtitle: {
    color: "rgba(255, 255, 255, 0.5)",
    marginTop: 2,
  },
  sectionContainer: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: Spacing.md,
  },
  channelRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  channelCard: {
    width: 170,
    backgroundColor: "rgba(12, 22, 37, 0.85)",
    borderRadius: 14,
    padding: Spacing.sm,
    borderWidth: 2,
    borderColor: "transparent",
  },
  channelCardFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(24, 44, 73, 1)",
    transform: [{ scale: 1.05 }],
  },
  cardLogoBox: {
    width: "100%",
    height: 90,
    backgroundColor: "rgba(7, 14, 25, 0.8)",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
    padding: 6,
  },
  cardLogo: {
    width: "100%",
    height: "100%",
  },
  cardChannelName: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  cardCategory: {
    color: "rgba(255, 255, 255, 0.5)",
    marginTop: 2,
  },
  emptyText: {
    color: "rgba(255, 255, 255, 0.45)",
    paddingVertical: Spacing.sm,
  },
});
