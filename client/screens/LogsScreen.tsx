import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View, FlatList, Share, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystemLegacy from "expo-file-system/legacy";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { TVFocusablePressable } from "@/components/TVFocusablePressable";
import {
  appendLog,
  clearLogs,
  getLogs,
  levelAtLeast,
  subscribe,
  MAX_ENTRIES,
  LEVEL_ORDER,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from "@/lib/logStore";

const isTV = Platform.isTV;

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "#6B7280",
  info: "#9CA3AF",
  warn: "#FACC15",
  error: "#FF3B30",
  fatal: "#FF3B30",
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
};

const SOURCE_COLORS: Record<LogSource, string> = {
  js: "rgba(156,163,175,0.55)",
  native: "#38BDF8",
  crash: "#FF3B30",
  network: "#34D399",
};

const LEVEL_FILL: Record<LogLevel, string> = {
  debug: "rgba(107,114,128,0.25)",
  info: "rgba(156,163,175,0.25)",
  warn: "rgba(250,204,21,0.25)",
  error: "rgba(255,59,48,0.25)",
  fatal: "rgba(255,59,48,0.4)",
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function buildPlainText(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const tag = e.tag ? ` [${e.tag}]` : "";
      return `${formatTs(e.ts)} ${e.level.toUpperCase().padEnd(5)} ${e.source}${tag} — ${e.message}`;
    })
    .join("\n");
}

export default function LogsScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();

  // Selector for "show this level and above". Starts with "debug" (all).
  const [minLevel, setMinLevel] = useState<LogLevel>("debug");
  // Subscribe to store changes; bump a counter to trigger re-filter.
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const allEntries = useMemo<LogEntry[]>(() => getLogs(), [tick]);
  const filteredEntries = useMemo<LogEntry[]>(
    () =>
      minLevel === "debug"
        ? allEntries
        : allEntries.filter((e) => levelAtLeast(e.level, minLevel)),
    [allEntries, minLevel],
  );
  // Newest first so fresh entries appear at the top of the list.
  const displayEntries = useMemo<LogEntry[]>(
    () => filteredEntries.slice().reverse(),
    [filteredEntries],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }, []);

  const handleCopy = useCallback(async () => {
    // Without @react-native-clipboard/clipboard in deps, Share IS the
    // standard "send me this text" affordance on Android — opens the
    // system share sheet so the user can paste into Telegram/email etc.
    try {
      const text = buildPlainText(displayEntries);
      if (typeof Share?.share === "function") {
        await Share.share({ message: text, title: "Prysm logs" });
        showToast(`Share sheet for ${displayEntries.length} entries`);
      } else {
        showToast("Share unavailable on this device");
      }
    } catch {
      showToast("Copy failed");
    }
  }, [displayEntries, showToast]);

  const handleSaveFile = useCallback(async () => {
    if (Platform.OS !== "android" || !FileSystemLegacy.StorageAccessFramework) {
      // Fallback: Share as plain text.
      try {
        await Share.share({
          message: buildPlainText(displayEntries),
          title: "Prysm logs",
        });
      } catch {
        showToast("Save unavailable");
      }
      return;
    }
    try {
      const SAF = FileSystemLegacy.StorageAccessFramework;
      const perms = await SAF.requestDirectoryPermissionsAsync();
      if (!perms.granted) {
        showToast("No folder selected");
        return;
      }
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `prysm-logs-${ts}.txt`;
      const fileUri = await SAF.createFileAsync(
        perms.directoryUri,
        filename,
        "text/plain",
      );
      await SAF.writeAsStringAsync(fileUri, buildPlainText(displayEntries), {
        encoding: FileSystemLegacy.EncodingType.UTF8,
      });
      showToast(`Saved ${filename}`);
    } catch (e: any) {
      showToast(`Save failed: ${e?.message ?? "unknown"}`);
    }
  }, [displayEntries, showToast]);

  const handleOpenFolder = useCallback(async () => {
    // Best-effort: opens the system Files app so the user can locate the
    // file they saved via handleSaveFile. Some TV boxes don't have a
    // file manager, hence the try/catch.
    if (Platform.OS !== "android") {
      showToast("Only on Android");
      return;
    }
    try {
      const IntentLauncher = require("expo-intent-launcher").default;
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        type: "resource/folder",
      } as any).catch(() => {
        // Fall back to the documents picker.
        return IntentLauncher.startActivityAsync(
          "android.intent.action.GET_CONTENT",
          { type: "*/*" } as any,
        );
      });
    } catch (e: any) {
      showToast(`Open folder failed: ${e?.message ?? "unknown"}`);
    }
  }, [showToast]);

  const handleClear = useCallback(() => {
    clearLogs();
    appendLog({
      ts: Date.now(),
      level: "info",
      source: "js",
      tag: "LogsScreen",
      message: "Log buffer cleared",
    });
    showToast("Logs cleared");
  }, [showToast]);

  const headerRight = useMemo(
    () => (
      <View style={styles.headerActions}>
        <HeaderButton
          icon="copy-outline"
          label="Copy"
          onPress={handleCopy}
          theme={theme}
        />
        <HeaderButton
          icon="download-outline"
          label="Save"
          onPress={handleSaveFile}
          theme={theme}
        />
        <HeaderButton
          icon="folder-open-outline"
          label="Folder"
          onPress={handleOpenFolder}
          theme={theme}
          tvOnly
        />
        <HeaderButton
          icon="trash-outline"
          label="Clear"
          onPress={handleClear}
          theme={theme}
          destructive
        />
      </View>
    ),
    [handleCopy, handleSaveFile, handleOpenFolder, handleClear, theme],
  );

  // Set the nav header right action.
  useEffect(() => {
    navigation.setOptions({
      headerTitle: "Logs",
      headerRight: () => headerRight,
    });
  }, [navigation, headerRight]);

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      {/* Filter bar */}
      <View
        style={[
          styles.filterBar,
          {
            backgroundColor: theme.backgroundDefault,
            borderBottomColor: theme.backgroundSecondary,
          },
          isTV && styles.filterBarTv,
        ]}
      >
        {LEVEL_ORDER.map((lvl) => {
          const active = minLevel === lvl || levelAtLeast(minLevel, lvl);
          return (
            <FilterChip
              key={lvl}
              label={LEVEL_LABELS[lvl]}
              active={active}
              color={LEVEL_COLORS[lvl]}
              fill={LEVEL_FILL[lvl]}
              onPress={() => setMinLevel(lvl)}
              selected={minLevel === lvl}
              theme={theme}
              hasTVPreferredFocus={isTV && lvl === "debug"}
            />
          );
        })}
        <View style={styles.countWrap}>
          <ThemedText
            style={[
              styles.countText,
              isTV && styles.countTextTv,
              { color: theme.textSecondary },
            ]}
          >
            {filteredEntries.length}/{MAX_ENTRIES}
          </ThemedText>
        </View>
      </View>

      {/* Log list */}
      <FlatList
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          isTV && styles.listContentTv,
        ]}
        data={displayEntries}
        keyExtractor={(item, idx) => `${item.ts}-${idx}`}
        initialNumToRender={20}
        maxToRenderPerBatch={40}
        windowSize={6}
        renderItem={({ item }) => (
          <View
            style={[
              styles.entry,
              isTV && styles.entryTv,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <View
              style={[
                styles.levelBar,
                isTV && styles.levelBarTv,
                { backgroundColor: LEVEL_COLORS[item.level] },
              ]}
            />
            <View style={styles.entryBody}>
              <View style={[styles.entryHead, isTV && styles.entryHeadTv]}>
                <ThemedText
                  style={[
                    styles.ts,
                    isTV && styles.tsTv,
                    { color: LEVEL_COLORS[item.level] },
                  ]}
                >
                  {formatTs(item.ts)}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.levelChip,
                    isTV && styles.levelChipTv,
                    {
                      color: LEVEL_COLORS[item.level],
                      backgroundColor: LEVEL_FILL[item.level],
                    },
                  ]}
                >
                  {LEVEL_LABELS[item.level].toUpperCase()}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.sourceChip,
                    isTV && styles.sourceChipTv,
                    {
                      color: SOURCE_COLORS[item.source] ?? theme.textSecondary,
                    },
                  ]}
                >
                  {item.source}
                  {item.tag ? ` · ${item.tag}` : ""}
                </ThemedText>
              </View>
              <ThemedText
                style={[
                  styles.entryText,
                  isTV && styles.entryTextTv,
                  { color: theme.text },
                ]}
                selectable
              >
                {item.message}
              </ThemedText>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name="document-text-outline"
              size={40}
              color={theme.textSecondary}
            />
            <ThemedText
              style={[
                styles.emptyText,
                isTV && styles.emptyTextTv,
                { color: theme.textSecondary },
              ]}
              numberOfLines={isTV ? 3 : undefined}
            >
              No log entries yet. Reproduce a bug with the app open and they
              will show up here.
            </ThemedText>
          </View>
        }
      />

      {toast && (
        <View style={styles.toastWrap} pointerEvents="none">
          <View
            style={[
              styles.toast,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <ThemedText style={[styles.toastText, { color: theme.text }]}>
              {toast}
            </ThemedText>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Helper components ─────────────────────────────────────────────────────

function HeaderButton({
  icon,
  label,
  onPress,
  theme,
  destructive,
  tvOnly,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  theme: any;
  destructive?: boolean;
  tvOnly?: boolean;
}) {
  if (tvOnly && !isTV) return null;
  const color = destructive ? theme.error : theme.primary;
  return (
    <TVFocusablePressable
      onPress={onPress}
      baseStyle={[styles.headerBtn, isTV && styles.headerBtnTv]}
      focusedStyle={{
        ...styles.headerBtnFocused,
        backgroundColor: theme.backgroundSecondary,
      }}
      accessibilityLabel={label}
    >
      <Ionicons name={icon as any} size={isTV ? 24 : 18} color={color} />
      {!isTV && (
        <ThemedText style={[styles.headerBtnLabel, { color }]}>
          {label}
        </ThemedText>
      )}
    </TVFocusablePressable>
  );
}

function FilterChip({
  label,
  active,
  color,
  fill,
  onPress,
  selected,
  theme,
  hasTVPreferredFocus,
}: {
  label: string;
  active: boolean;
  color: string;
  fill: string;
  onPress: () => void;
  selected: boolean;
  theme: any;
  hasTVPreferredFocus?: boolean;
}) {
  return (
    <TVFocusablePressable
      onPress={onPress}
      baseStyle={[
        styles.filterChip,
        isTV && styles.filterChipTv,
        {
          backgroundColor: selected ? fill : "transparent",
          borderColor: selected ? color : theme.backgroundTertiary,
        },
      ]}
      focusedStyle={{ ...styles.filterChipFocused, borderColor: color }}
      accessibilityLabel={`Filter ${label}`}
      hasTVPreferredFocus={hasTVPreferredFocus}
    >
      <View
        style={[
          styles.filterDot,
          isTV && styles.filterDotTv,
          { backgroundColor: color },
        ]}
      />
      <ThemedText
        style={[
          styles.filterLabel,
          isTV && styles.filterLabelTv,
          {
            color: selected ? color : theme.textSecondary,
            fontWeight: selected ? "700" : "500",
          },
        ]}
      >
        {label}
      </ThemedText>
    </TVFocusablePressable>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexWrap: "wrap",
  },
  filterBarTv: {
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.lg,
    gap: Spacing.md,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  filterChipTv: {
    minHeight: 52,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderWidth: 2,
  },
  filterChipFocused: {
    transform: [{ scale: 1.05 }],
  },
  filterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  filterDotTv: { width: 10, height: 10, borderRadius: 5 },
  filterLabel: {
    fontSize: 12,
    letterSpacing: 0.3,
  },
  filterLabelTv: { fontSize: 16 },
  countWrap: {
    marginLeft: "auto",
  },
  countText: {
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  countTextTv: { fontSize: 14 },
  list: {
    flex: 1,
  },
  listContent: { paddingBottom: 24 },
  listContentTv: { paddingHorizontal: Spacing["2xl"] },
  entry: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  entryTv: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
  levelBar: {
    width: 3,
    marginRight: 10,
    borderRadius: 2,
    alignSelf: "stretch",
  },
  levelBarTv: { width: 4, marginRight: Spacing.md },
  entryBody: {
    flex: 1,
  },
  entryHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 2,
  },
  entryHeadTv: { marginBottom: Spacing.xs },
  ts: {
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    fontFamily: "monospace",
  },
  tsTv: { fontSize: 14 },
  levelChip: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.xs,
    overflow: "hidden",
  },
  levelChipTv: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 3 },
  sourceChip: {
    fontSize: 10,
    fontWeight: "500",
    fontFamily: "monospace",
  },
  sourceChipTv: { fontSize: 13 },
  entryText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "monospace",
  },
  entryTextTv: { fontSize: 15, lineHeight: 22 },
  empty: {
    paddingTop: 60,
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  emptyText: {
    marginTop: Spacing.md,
    textAlign: "center",
    fontSize: 13,
    lineHeight: 18,
  },
  emptyTextTv: { fontSize: 17, lineHeight: 24 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
  },
  headerBtnTv: {
    width: 56,
    height: 56,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  headerBtnFocused: {
    transform: [{ scale: 1.06 }],
  },
  headerBtnLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  toastWrap: {
    position: "absolute",
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toast: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: BorderRadius.full,
  },
  toastText: {
    fontSize: 12,
    fontWeight: "500",
  },
});
