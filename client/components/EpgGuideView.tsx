import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Commands as ViewCommands } from "react-native/Libraries/Components/View/ViewNativeComponent";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useFocusScroll } from "@/hooks/useFocusScroll";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { Channel } from "@/types/playlist";
import type { EpgProgram } from "@/types/epg";

const isTV = Platform.isTV;
const WINDOW_HOURS = 2;
const SLOT_MIN = 30;

function floorToSlot(ts: number): number {
  const d = new Date(ts);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  d.setMinutes(m - (m % SLOT_MIN));
  return d.getTime();
}

function fmtSlot(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function GuideCell({
  program,
  width,
  isNow,
  onPress,
  onFocusItem,
  onLayoutItem,
}: {
  program: EpgProgram;
  width: number;
  isNow: boolean;
  onPress: () => void;
  onFocusItem?: () => void;
  onLayoutItem?: (e: LayoutChangeEvent) => void;
}) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayoutItem}
      onFocus={() => {
        setFocused(true);
        onFocusItem?.();
      }}
      onBlur={() => setFocused(false)}
      focusable
      style={[
        styles.cell,
        {
          width: Math.max(80, width),
          backgroundColor: isNow
            ? theme.primary + "30"
            : theme.backgroundSecondary,
          borderColor: focused ? theme.primary : "transparent",
        },
      ]}
    >
      <ThemedText type="small" numberOfLines={1} style={styles.cellTitle}>
        {program.title}
      </ThemedText>
      <ThemedText
        type="caption"
        numberOfLines={1}
        style={{ color: theme.textSecondary }}
      >
        {fmtSlot(program.start)} - {fmtSlot(program.end)}
      </ThemedText>
    </Pressable>
  );
}

interface EpgGuideViewProps {
  channels: Channel[];
  getProgramsForChannel: (
    channelId: string,
    from?: number,
    to?: number,
  ) => EpgProgram[];
  onSelectChannel: (channelId: string) => void;
}

export function EpgGuideView({
  channels,
  getProgramsForChannel,
  onSelectChannel,
}: EpgGuideViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const slotWidth = isTV ? 170 : Math.max(120, width * 0.32);
  const totalWidth = slotWidth * (WINDOW_HOURS * 2);

  const windowStart = useMemo(() => floorToSlot(Date.now()), []);
  const windowEnd = windowStart + WINDOW_HOURS * 3600 * 1000;
  const slots = useMemo(() => {
    const arr: number[] = [];
    for (let t = windowStart; t < windowEnd; t += SLOT_MIN * 60 * 1000) {
      arr.push(t);
    }
    return arr;
  }, [windowStart, windowEnd]);

  // Cap rows for perf on very large playlists; ChannelsScreen filters first
  const rows = useMemo(() => channels.slice(0, 120), [channels]);

  const rowsScroll = useFocusScroll<string>({ axis: "vertical" });
  const guideHScroll = useFocusScroll<string>({ axis: "horizontal" });
  const focusRow = (chId: string) => rowsScroll.focusOn(chId);
  const focusCell = (programId: string) => guideHScroll.focusOn(programId);

  // First row's channel cell is the pinned, always-visible target. Request
  // focus imperatively in addition to hasTVPreferredFocus so focus is never
  // lost when the Guide opens (hasTVPreferredFocus can race inside ScrollViews).
  const firstChColRef = useRef<any>(null);
  useEffect(() => {
    if (!isTV) return;
    const t = setTimeout(() => {
      const el = firstChColRef.current;
      if (el != null) ViewCommands.requestTVFocus(el);
    }, 120);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        ref={guideHScroll.scrollRef}
        onLayout={guideHScroll.onScrollViewLayout}
        onScroll={guideHScroll.onScroll}
        scrollEventThrottle={16}
      >
        <View>
          {/* Time header */}
          <View style={[styles.row, styles.headerRow]}>
            <View
              style={[
                styles.chCol,
                { borderBottomColor: theme.backgroundSecondary },
              ]}
            />
            {slots.map((s) => (
              <View key={s} style={[styles.slot, { width: slotWidth }]}>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  {fmtSlot(s)}
                </ThemedText>
              </View>
            ))}
          </View>
          <ScrollView
            ref={rowsScroll.scrollRef}
            showsVerticalScrollIndicator={false}
            onLayout={rowsScroll.onScrollViewLayout}
            onScroll={rowsScroll.onScroll}
            scrollEventThrottle={16}
          >
            {rows.map((ch, index) => {
              const progs = getProgramsForChannel(
                ch.id,
                windowStart,
                windowEnd,
              );
              return (
                <View
                  key={ch.id}
                  style={styles.row}
                  onLayout={(e) => rowsScroll.registerItem(ch.id, e)}
                >
                  <Pressable
                    onPress={() => onSelectChannel(ch.id)}
                    onFocus={() => focusRow(ch.id)}
                    ref={index === 0 ? firstChColRef : undefined}
                    focusable
                    hasTVPreferredFocus={isTV && index === 0}
                    style={[
                      styles.chCol,
                      { borderBottomColor: theme.backgroundSecondary },
                    ]}
                  >
                    <ThemedText
                      type="small"
                      numberOfLines={2}
                      style={styles.chName}
                    >
                      {ch.name}
                    </ThemedText>
                  </Pressable>
                  <View style={[styles.timeline, { width: totalWidth }]}>
                    {progs.length === 0 ? (
                      <ThemedText
                        type="caption"
                        style={{
                          color: theme.textSecondary,
                          padding: Spacing.sm,
                        }}
                      >
                        No info
                      </ThemedText>
                    ) : (
                      progs.map((p) => {
                        const s = Math.max(p.start, windowStart);
                        const e = Math.min(p.end, windowEnd);
                        const w =
                          ((e - s) / (windowEnd - windowStart)) * totalWidth;
                        const now = Date.now();
                        const isNow = p.start <= now && p.end > now;
                        return (
                          <GuideCell
                            key={p.id}
                            program={p}
                            width={w - 4}
                            isNow={isNow}
                            onPress={() => onSelectChannel(ch.id)}
                            onFocusItem={() => {
                              focusRow(ch.id);
                              focusCell(p.id);
                            }}
                            onLayoutItem={(e) =>
                              guideHScroll.registerItem(p.id, e)
                            }
                          />
                        );
                      })
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
  },
  headerRow: {
    marginBottom: Spacing.xs,
  },
  chCol: {
    width: 110,
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  chName: {
    fontWeight: "600",
  },
  slot: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  timeline: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 4,
    paddingVertical: 4,
  },
  cell: {
    borderRadius: BorderRadius.xs,
    padding: Spacing.xs,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 52,
  },
  cellTitle: {
    fontWeight: "600",
  },
});
