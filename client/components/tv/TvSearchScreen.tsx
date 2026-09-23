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
import { Spacing, BorderRadius } from "@/constants/theme";
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
          color="#38BDF8"
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search all channels, movies, sports, or genres..."
          placeholderTextColor="rgba(255, 255, 255, 0.4)"
          autoFocus={Platform.isTV}
        />
        {searchQuery ? (
          <Pressable
            onPress={() => setSearchQuery("")}
            focusable
            style={styles.clearButton}
          >
            <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.6)" />
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
              No channels found matching "{searchQuery}"
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
  const [isFocused, setIsFocused] = React.useState(false);

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
          source={
            channel.logo ? { uri: channel.logo } : placeholderImage
          }
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xs,
  },
  searchBarContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(12, 22, 37, 0.9)",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: Spacing.md,
    height: 52,
    marginBottom: Spacing.lg,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: "#FFFFFF",
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
    backgroundColor: "rgba(12, 22, 37, 0.85)",
    borderRadius: 14,
    padding: Spacing.sm,
    borderWidth: 2,
    borderColor: "transparent",
  },
  resultCardFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(24, 44, 73, 1)",
    transform: [{ scale: 1.04 }],
  },
  resultLogoBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "rgba(7, 14, 25, 0.8)",
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
    color: "#FFFFFF",
    fontWeight: "700",
  },
  resultGroup: {
    color: "rgba(255, 255, 255, 0.5)",
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
    color: "rgba(255, 255, 255, 0.5)",
  },
});
