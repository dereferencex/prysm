import React, { useState, useMemo } from "react";
import { View, StyleSheet, Pressable, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { createTvPalette } from "./tvPalette";
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
  const { theme } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const c = useMemo(() => createTvPalette(theme), [theme]);

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
              color={c.accent}
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
        <Ionicons name="enter" size={15} color={c.accent} />
        <ThemedText type="small" style={styles.openHintText}>
          Press OK to open this channel
        </ThemedText>
      </View>
    </Pressable>
  );
}

function createStyles(theme: typeof Colors.dark) {
  const c = createTvPalette(theme);
  return StyleSheet.create({
    emptyContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyText: {
      color: c.text40,
    },
    card: {
      flex: 1,
      backgroundColor: c.panel,
      borderRadius: BorderRadius.lg,
      borderWidth: 2,
      borderColor: c.borderSubtle,
      padding: Spacing.lg,
    },
    cardFocused: {
      borderColor: c.focusBorder,
      backgroundColor: c.focusFill,
      shadowColor: c.accent,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
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
      backgroundColor: c.panelAlt,
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
      color: c.text,
      fontSize: 16,
      fontWeight: "800",
    },
    channelGroup: {
      color: c.text50,
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
      color: c.text,
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
      color: c.text60,
      fontSize: 12,
    },
    progressPct: {
      color: c.accent,
      fontWeight: "700",
    },
    progressTrack: {
      height: 4,
      backgroundColor: c.border,
      borderRadius: 2,
      overflow: "hidden",
      marginTop: 4,
    },
    progressFill: {
      height: "100%",
      backgroundColor: c.accent,
      borderRadius: 2,
    },
    nowDescription: {
      color: c.text60,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 10,
    },
    nextSection: {
      borderTopWidth: 1,
      borderTopColor: c.borderSubtle,
      marginTop: Spacing.md,
      paddingTop: Spacing.md,
    },
    nextHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 4,
    },
    nextLabel: {
      color: c.accent,
      fontWeight: "700",
      letterSpacing: 1,
      fontSize: 11,
    },
    nextTitle: {
      color: c.text75,
      fontWeight: "600",
    },
    noInfoText: {
      color: c.text35,
    },
    openHint: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: Spacing.md,
      paddingTop: Spacing.sm,
    },
    openHintText: {
      color: c.accent,
      fontWeight: "600",
      fontSize: 13,
      marginLeft: 6,
    },
  });
}
