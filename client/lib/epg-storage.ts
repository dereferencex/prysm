import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EpgProgram, EpgCache } from "@/types/epg";

const KEYS = {
  META: "prysm_epg_meta_",
  CHUNKS: "prysm_epg_chunks_",
};

const CHUNK_SIZE = 400;

interface EpgMeta {
  playlistId: string;
  sourceUrl: string;
  lastUpdated: number;
  programCount: number;
  chunkCount: number;
}

export async function saveEpgCache(cache: EpgCache): Promise<void> {
  const chunkCount = Math.ceil(cache.programs.length / CHUNK_SIZE);
  const meta: EpgMeta = {
    playlistId: cache.playlistId,
    sourceUrl: cache.sourceUrl,
    lastUpdated: cache.lastUpdated,
    programCount: cache.programs.length,
    chunkCount,
  };
  await AsyncStorage.setItem(
    `${KEYS.META}${cache.playlistId}`,
    JSON.stringify(meta),
  );
  for (let i = 0; i < chunkCount; i++) {
    const chunk = cache.programs.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    await AsyncStorage.setItem(
      `${KEYS.CHUNKS}${cache.playlistId}_${i}`,
      JSON.stringify(chunk),
    );
  }
  // Remove stale chunks from a previously larger cache
  // (best-effort, ignore errors)
  try {
    let i = chunkCount;
    for (; i < chunkCount + 20; i++) {
      const k = `${KEYS.CHUNKS}${cache.playlistId}_${i}`;
      const v = await AsyncStorage.getItem(k);
      if (v == null) break;
      await AsyncStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

export async function getEpgCache(
  playlistId: string,
): Promise<EpgCache | null> {
  try {
    const metaStr = await AsyncStorage.getItem(`${KEYS.META}${playlistId}`);
    if (!metaStr) return null;
    const meta: EpgMeta = JSON.parse(metaStr);
    const programs: EpgProgram[] = [];
    for (let i = 0; i < meta.chunkCount; i++) {
      const chunkStr = await AsyncStorage.getItem(
        `${KEYS.CHUNKS}${playlistId}_${i}`,
      );
      if (chunkStr) {
        const chunk: EpgProgram[] = JSON.parse(chunkStr);
        programs.push(...chunk);
      }
    }
    return {
      playlistId: meta.playlistId,
      sourceUrl: meta.sourceUrl,
      lastUpdated: meta.lastUpdated,
      programCount: meta.programCount,
      programs,
    };
  } catch (e) {
    console.warn("Error reading EPG cache:", e);
    return null;
  }
}

export async function clearEpgCache(playlistId: string): Promise<void> {
  try {
    const metaStr = await AsyncStorage.getItem(`${KEYS.META}${playlistId}`);
    let chunkCount = 20;
    if (metaStr) {
      chunkCount = Math.max((JSON.parse(metaStr) as EpgMeta).chunkCount, 0);
    }
    const keys = [`${KEYS.META}${playlistId}`];
    for (let i = 0; i < chunkCount + 5; i++) {
      keys.push(`${KEYS.CHUNKS}${playlistId}_${i}`);
    }
    await AsyncStorage.multiRemove(keys);
  } catch (e) {
    console.warn("Error clearing EPG cache:", e);
  }
}
