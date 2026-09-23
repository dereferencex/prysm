import React, { useState } from "react";
import { View, StyleSheet, Pressable, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { Channel } from "@/types/playlist";
import { EpgProgram } from "@/types/epg";

const placeholderImage = require("../../../assets/images/placeholder-channel.png");

function formatTimeHHMM(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

interface TvEpgBannerProps {
  channel: Channel | null;
  now?: EpgProgram;
  next?: EpgProgram;
  onPress: () => void;
}

export function TvEpgBanner({ channel, now, next, onPress }: TvEpgBannerProps) {
  const [isFocused, setIsFocused] = useState(false);

  if (!channel) {
    return (
      <View style={styles.emptyContainer}>
        <ThemedText type="body" style={styles.emptyText}>
          Select a channel to view its program guide
        </ThemedText>
      </View>
    );
  }

  const nowTime = now
    ? `${formatTimeHHMM(now.start)} – ${formatTimeHHMM(now.end)}`
    : "";
  const progress =
    now && now.start && now.end
      ? Math.max(
          0,
          Math.min(1, (Date.now() - now.start) / (now.end - now.start)),
        )
      : 0;

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      focusable
      accessibilityRole="button"
      accessibilityLabel={`Open ${channel.name}`}
      style={[styles.card, isFocused && styles.cardFocused] as ViewStyle[]}
    >
      <View style={styles.headerRow}>
        <View style={styles.logoBox}>
          <Image
            source={channel.logo ? { uri: channel.logo } : placeholderImage}
            style={styles.logo}
            contentFit="contain"
            placeholder={placeholderImage}
          />
        </View>
        <View style={styles.headerText}>
          <ThemedText type="small" numberOfLines={1} style={styles.channelName}>
            {channel.name}
          </ThemedText>
          <ThemedText type="caption" style={styles.channelGroup}>
            {channel.group || "Live TV"}
          </ThemedText>
        </View>
        {now ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <ThemedText type="caption" style={styles.liveBadgeText}>
              LIVE
            </ThemedText>
          </View>
        ) : (
          <Ionicons
            name="play-circle"
            size={26}
            color="rgba(255, 255, 255, 0.5)"
          />
        )}
      </View>

      <View style={styles.nowSection}>
        <ThemedText type="h3" numberOfLines={2} style={styles.nowTitle}>
          {now?.title || "No schedule information"}
        </ThemedText>

        {now ? (
          <View style={styles.timeProgressRow}>
            <ThemedText type="small" style={styles.timeText}>
              {nowTime}
            </ThemedText>
            <ThemedText type="caption" style={styles.progressPct}>
              {Math.round(progress * 100)}%
            </ThemedText>
          </View>
        ) : null}

        {now ? (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </View>
        ) : null}

        <ThemedText
          type="caption"
          numberOfLines={3}
          style={styles.nowDescription}
        >
          {now?.desc ||
            (channel.group
              ? `Category: ${channel.group}`
              : "Live TV broadcast")}
        </ThemedText>
      </View>

      {next ? (
        <View style={styles.nextSection}>
          <View style={styles.nextHeader}>
            <Ionicons
              name="play-skip-forward"
              size={13}
              color="#38BDF8"
              style={{ marginRight: 5 }}
            />
            <ThemedText type="caption" style={styles.nextLabel}>
              UP NEXT
            </ThemedText>
          </View>
          <ThemedText type="small" numberOfLines={1} style={styles.nextTitle}>
            {formatTimeHHMM(next.start)
              ? `${formatTimeHHMM(next.start)}  `
              : ""}
            {next.title}
          </ThemedText>
        </View>
      ) : (
        <View style={styles.nextSection}>
          <ThemedText type="caption" style={styles.noInfoText}>
            No upcoming program available
          </ThemedText>
        </View>
      )}

      <View style={styles.openHint}>
        <Ionicons name="enter" size={15} color="#38BDF8" />
        <ThemedText type="small" style={styles.openHintText}>
          Press OK to open this channel
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: "rgba(255, 255, 255, 0.4)",
  },
  card: {
    flex: 1,
    backgroundColor: "rgba(7, 13, 23, 0.9)",
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.08)",
    padding: Spacing.lg,
  },
  cardFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(18, 33, 55, 1)",
    transform: [{ scale: 1.02 }],
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  logoBox: {
    width: 54,
    height: 54,
    borderRadius: BorderRadius.md,
    backgroundColor: "rgba(12, 22, 37, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
    padding: 4,
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  headerText: {
    flex: 1,
  },
  channelName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  channelGroup: {
    color: "rgba(255, 255, 255, 0.5)",
    marginTop: 2,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(220, 38, 38, 0.18)",
    borderRadius: BorderRadius.full,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#EF4444",
    marginRight: 6,
  },
  liveBadgeText: {
    color: "#F87171",
    fontWeight: "700",
    letterSpacing: 1,
  },
  nowSection: {
    flex: 1,
  },
  nowTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  timeProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  timeText: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 12,
  },
  progressPct: {
    color: "#38BDF8",
    fontWeight: "700",
  },
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 4,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#38BDF8",
    borderRadius: 2,
  },
  nowDescription: {
    color: "rgba(255, 255, 255, 0.65)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  nextSection: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
  },
  nextHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  nextLabel: {
    color: "#38BDF8",
    fontWeight: "700",
    letterSpacing: 1,
    fontSize: 11,
  },
  nextTitle: {
    color: "rgba(255, 255, 255, 0.85)",
    fontWeight: "600",
  },
  noInfoText: {
    color: "rgba(255, 255, 255, 0.35)",
  },
  openHint: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
  },
  openHintText: {
    color: "#38BDF8",
    fontWeight: "600",
    fontSize: 13,
    marginLeft: 6,
  },
});
