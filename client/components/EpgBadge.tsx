import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import type { EpgNowNext } from "@/types/epg";

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function EpgBadge({ nowNext }: { nowNext?: EpgNowNext }) {
  const { theme } = useTheme();
  const progress = useMemo(() => {
    if (!nowNext?.now) return 0;
    const { start, end } = nowNext.now;
    if (end <= start) return 0;
    const n = Date.now();
    return Math.min(1, Math.max(0, (n - start) / (end - start)));
  }, [nowNext]);

  if (!nowNext?.now && !nowNext?.next) return null;

  return (
    <View style={styles.container}>
      {nowNext.now ? (
        <>
          <View style={styles.row}>
            <ThemedText
              type="caption"
              numberOfLines={1}
              style={[styles.now, { color: theme.text }]}
            >
              {nowNext.now.title}
            </ThemedText>
            <ThemedText
              type="caption"
              style={[styles.time, { color: theme.textSecondary }]}
            >
              {fmtTime(nowNext.now.end)}
            </ThemedText>
          </View>
          <View
            style={[
              styles.track,
              { backgroundColor: theme.backgroundTertiary },
            ]}
          >
            <View
              style={[
                styles.fill,
                { backgroundColor: theme.primary, flex: progress },
              ]}
            />
            <View style={{ flex: 1 - progress }} />
          </View>
        </>
      ) : null}
      {nowNext.next ? (
        <ThemedText
          type="caption"
          numberOfLines={1}
          style={[styles.next, { color: theme.textSecondary }]}
        >
          Next: {nowNext.next.title} · {fmtTime(nowNext.next.start)}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
    gap: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  now: {
    flex: 1,
    fontWeight: "600",
  },
  time: {},
  track: {
    height: 3,
    borderRadius: 2,
    flexDirection: "row",
    overflow: "hidden",
  },
  fill: {},
  next: {},
});
