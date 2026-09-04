import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import type { Channel } from "@/types/playlist";
import type { EpgProgram, EpgNowNext } from "@/types/epg";
import { usePlaylist } from "./PlaylistContext";
import { fetchAndParseEPG } from "@/lib/xmltv-parser";
import { saveEpgCache, getEpgCache, clearEpgCache } from "@/lib/epg-storage";

interface EpgContextType {
  /** Effective URL: manual override wins over auto-detected url-tvg */
  effectiveUrl: string | null;
  autoDetectedUrls: string[];
  isManualOverride: boolean;
  programs: EpgProgram[];
  nowNextMap: Map<string, EpgNowNext>;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
  programCount: number;
  getNowNext: (channelId: string) => EpgNowNext | undefined;
  getProgramsForChannel: (
    channelId: string,
    from?: number,
    to?: number,
  ) => EpgProgram[];
  refreshEpg: (force?: boolean) => Promise<void>;
  clearCache: () => Promise<void>;
}

const EpgContext = createContext<EpgContextType | undefined>(undefined);

function buildChannelMatcher(
  channels: Channel[],
  channelNames: Map<string, string[]>,
) {
  // xmltvId lower -> xmltvId, display-name lower -> xmltvId
  const lookup = new Map<string, string>();
  for (const [id, names] of channelNames) {
    lookup.set(id.toLowerCase(), id);
    for (const n of names) {
      const k = n.toLowerCase().trim();
      if (k && !lookup.has(k)) lookup.set(k, id);
    }
  }
  const channelToXmltv = new Map<string, string>();
  for (const ch of channels) {
    const candidates = [
      ch.tvgId?.trim(),
      ch.tvgName?.trim(),
      ch.name?.trim(),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      const hit = lookup.get(c.toLowerCase());
      if (hit) {
        channelToXmltv.set(ch.id, hit);
        break;
      }
    }
  }
  return channelToXmltv;
}

function computeNowNext(
  programs: EpgProgram[],
  now: number,
): Map<string, EpgNowNext> {
  const byChannel = new Map<string, EpgProgram[]>();
  for (const p of programs) {
    const arr = byChannel.get(p.channelId);
    if (arr) arr.push(p);
    else byChannel.set(p.channelId, [p]);
  }
  const map = new Map<string, EpgNowNext>();
  for (const [cid, list] of byChannel) {
    list.sort((a, b) => a.start - b.start);
    let nowP: EpgProgram | undefined;
    let nextP: EpgProgram | undefined;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.start <= now && p.end > now) {
        nowP = p;
        nextP = list[i + 1];
        break;
      } else if (p.start > now) {
        nextP = p;
        break;
      }
    }
    if (nowP || nextP) map.set(cid, { now: nowP, next: nextP });
  }
  return map;
}

export function EpgProvider({ children }: { children: ReactNode }) {
  const { playlist, settings, updateSettings } = usePlaylist();
  const [programs, setPrograms] = useState<EpgProgram[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const loadingRef = useRef(false);
  const lastPlaylistIdRef = useRef<string | null>(null);

  const playlistId = playlist?.id ?? null;
  const autoDetectedUrls = useMemo(
    () => playlist?.epgUrls ?? [],
    [playlist?.epgUrls],
  );
  const manualOverride = playlistId
    ? (settings.epgUrlOverrides[playlistId] ?? "").trim()
    : "";
  const effectiveUrl = manualOverride || autoDetectedUrls[0] || null;
  const isManualOverride = Boolean(manualOverride);

  // Auto-enable EPG when a source is detected (once, until user toggles)
  useEffect(() => {
    if (
      effectiveUrl &&
      playlistId &&
      !settings.showEpg &&
      !settings.epgUserSet
    ) {
      void updateSettings({ showEpg: true });
    }
  }, [
    effectiveUrl,
    playlistId,
    settings.showEpg,
    settings.epgUserSet,
    updateSettings,
  ]);

  // Drop stale programs when playlist changes or EPG disabled
  useEffect(() => {
    if (lastPlaylistIdRef.current !== playlistId) {
      lastPlaylistIdRef.current = playlistId;
      setPrograms([]);
      setLastUpdated(null);
      setError(null);
    }
    if (!settings.showEpg) {
      setPrograms([]);
    }
  }, [playlistId, settings.showEpg]);

  const refreshEpg = useCallback(
    async (force = false) => {
      if (!playlist || !effectiveUrl || !settings.showEpg) return;
      if (loadingRef.current) return;
      loadingRef.current = true;
      setIsLoading(true);
      setError(null);
      try {
        if (!force) {
          const cached = await getEpgCache(playlist.id);
          const maxAge = settings.epgRefreshHours * 3600 * 1000;
          if (
            cached &&
            cached.sourceUrl === effectiveUrl &&
            Date.now() - cached.lastUpdated < maxAge &&
            cached.programs.length > 0
          ) {
            setPrograms(cached.programs);
            setLastUpdated(cached.lastUpdated);
            return;
          }
        }
        const { programs: raw, channelNames } =
          await fetchAndParseEPG(effectiveUrl);
        const matcher = buildChannelMatcher(playlist.channels, channelNames);
        // Build reverse map xmltvId -> channelIds
        const reverse = new Map<string, string[]>();
        for (const [cid, xid] of matcher) {
          const arr = reverse.get(xid);
          if (arr) arr.push(cid);
          else reverse.set(xid, [cid]);
        }
        const mapped: EpgProgram[] = [];
        raw.forEach((r, i) => {
          const cids = reverse.get(r.xmltvChannelId);
          if (!cids) return;
          for (const cid of cids) {
            mapped.push({ ...r, id: `${r.id}_${i}_${cid}`, channelId: cid });
          }
        });
        mapped.sort((a, b) => a.start - b.start);
        setPrograms(mapped);
        const ts = Date.now();
        setLastUpdated(ts);
        await saveEpgCache({
          playlistId: playlist.id,
          sourceUrl: effectiveUrl,
          lastUpdated: ts,
          programCount: mapped.length,
          programs: mapped,
        });
      } catch (e: any) {
        // Fall back to cache on failure
        const cached = await getEpgCache(playlist.id);
        if (cached && cached.programs.length > 0) {
          setPrograms(cached.programs);
          setLastUpdated(cached.lastUpdated);
        } else {
          setError(e?.message || "Failed to load EPG");
        }
      } finally {
        loadingRef.current = false;
        setIsLoading(false);
      }
    },
    [playlist, effectiveUrl, settings.showEpg, settings.epgRefreshHours],
  );

  // Initial load: cache first, then refresh in background
  useEffect(() => {
    if (!playlistId || !settings.showEpg || !effectiveUrl) return;
    let cancelled = false;
    (async () => {
      const cached = await getEpgCache(playlistId);
      if (!cancelled && cached && cached.sourceUrl === effectiveUrl) {
        setPrograms(cached.programs);
        setLastUpdated(cached.lastUpdated);
      }
      if (!cancelled) void refreshEpg(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistId, effectiveUrl, settings.showEpg, refreshEpg]);

  // Re-roll now/next every minute without refetch
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const nowNextMap = useMemo(
    () => computeNowNext(programs, tick),
    [programs, tick],
  );

  const programsByChannel = useMemo(() => {
    const m = new Map<string, EpgProgram[]>();
    for (const p of programs) {
      const arr = m.get(p.channelId);
      if (arr) arr.push(p);
      else m.set(p.channelId, [p]);
    }
    return m;
  }, [programs]);

  const getNowNext = useCallback(
    (channelId: string) => nowNextMap.get(channelId),
    [nowNextMap],
  );

  const getProgramsForChannel = useCallback(
    (channelId: string, from?: number, to?: number) => {
      const list = programsByChannel.get(channelId) ?? [];
      if (from == null && to == null) return list;
      return list.filter(
        (p) => (from == null || p.end > from) && (to == null || p.start < to),
      );
    },
    [programsByChannel],
  );

  const clearCache = useCallback(async () => {
    if (!playlistId) return;
    await clearEpgCache(playlistId);
    setPrograms([]);
    setLastUpdated(null);
  }, [playlistId]);

  const value: EpgContextType = {
    effectiveUrl,
    autoDetectedUrls,
    isManualOverride,
    programs,
    nowNextMap,
    isLoading,
    error,
    lastUpdated,
    programCount: programs.length,
    getNowNext,
    getProgramsForChannel,
    refreshEpg,
    clearCache,
  };

  return <EpgContext.Provider value={value}>{children}</EpgContext.Provider>;
}

export function useEpg() {
  const ctx = useContext(EpgContext);
  if (!ctx) throw new Error("useEpg must be used within EpgProvider");
  return ctx;
}
