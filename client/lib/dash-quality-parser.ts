import { VideoQuality } from "@/components/AdvancedVideoPlayer";

/**
 * DASH manifest quality parser.
 *
 * Uses pure regex/string parsing instead of DOMParser — DOMParser is a
 * browser API that is not available in React Native's JS environment and
 * caused a silent ReferenceError that made DASH quality detection always
 * return [].
 */

interface DASHRepresentation {
  id: string;
  bandwidth: number;
  width?: number;
  height?: number;
}

export async function parseDASHQualities(
  manifestUrl: string,
  customHeaders?: Record<string, string>,
): Promise<VideoQuality[]> {
  try {
    const response = await fetch(manifestUrl, {
      headers: {
        Accept: "*/*",
        ...(customHeaders || {}),
      },
    });

    if (!response.ok) {
      console.warn("Failed to fetch DASH manifest:", response.status);
      return [];
    }

    const content = await response.text();
    return parseDASHManifest(content);
  } catch (error) {
    console.warn("Error parsing DASH qualities:", error);
    return [];
  }
}

function parseDASHManifest(content: string): VideoQuality[] {
  const representations = extractRepresentations(content);
  if (representations.length === 0) return [];

  representations.sort((a, b) => b.bandwidth - a.bandwidth);

  const qualities: VideoQuality[] = representations.map((rep) => {
    let label: string;
    let resolution: string;

    if (rep.height) {
      if (rep.height >= 2160) {
        label = "4K";
        resolution = "2160p";
      } else if (rep.height >= 1440) {
        label = "1440p";
        resolution = "1440p";
      } else if (rep.height >= 1080) {
        label = "1080p";
        resolution = "1080p";
      } else if (rep.height >= 720) {
        label = "720p";
        resolution = "720p";
      } else if (rep.height >= 480) {
        label = "480p";
        resolution = "480p";
      } else if (rep.height >= 360) {
        label = "360p";
        resolution = "360p";
      } else {
        label = `${rep.height}p`;
        resolution = `${rep.height}p`;
      }
    } else {
      const kbps = Math.round(rep.bandwidth / 1000);
      if (kbps >= 8000) {
        label = "High";
        resolution = "High Quality";
      } else if (kbps >= 4000) {
        label = "Medium-High";
        resolution = "Medium-High";
      } else if (kbps >= 2000) {
        label = "Medium";
        resolution = "Medium Quality";
      } else if (kbps >= 1000) {
        label = "Low";
        resolution = "Low Quality";
      } else {
        label = "Very Low";
        resolution = "Very Low Quality";
      }
    }

    return {
      label,
      resolution,
      bitrate: rep.bandwidth,
    };
  });

  return deduplicateQualities(qualities);
}

/**
 * Extracts video Representation elements from a DASH MPD manifest using
 * regex parsing — no DOM dependency.
 *
 * Strategy:
 *  1. Split the manifest into AdaptationSet blocks.
 *  2. Keep only video adaptation sets (mimeType starts with "video/" or
 *     contentType="video", or has no type but contains Representation elements
 *     with width/height attributes indicating video).
 *  3. Within each video AdaptationSet, extract all Representation elements
 *     and their bandwidth/width/height attributes.
 */
function extractRepresentations(content: string): DASHRepresentation[] {
  const representations: DASHRepresentation[] = [];

  // Split on AdaptationSet opening tags — captures everything up to the next one
  // or to the end of the manifest.
  const adaptationSetRegex = /<AdaptationSet([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi;
  let asMatch: RegExpExecArray | null;

  while ((asMatch = adaptationSetRegex.exec(content)) !== null) {
    const asAttrs = asMatch[1];
    const asBody = asMatch[2];

    // Determine if this is a video AdaptationSet
    const mimeType = getAttr(asAttrs, "mimeType") ?? getAttr(asAttrs, "mimetype") ?? "";
    const contentType = getAttr(asAttrs, "contentType") ?? getAttr(asAttrs, "contenttype") ?? "";

    const isVideo =
      mimeType.startsWith("video/") ||
      contentType === "video" ||
      // If neither attribute is present, check if Representations have height/width
      // (audio-only tracks won't have these)
      (!mimeType && !contentType && /height=["']\d+["']/i.test(asBody));

    if (!isVideo) continue;

    // Extract each Representation within this AdaptationSet
    // Inherit width/height/codecs from AdaptationSet if not on the Representation itself
    const asWidth = parseInt(getAttr(asAttrs, "width") ?? "0", 10) || undefined;
    const asHeight = parseInt(getAttr(asAttrs, "height") ?? "0", 10) || undefined;

    const repRegex = /<Representation([^>]*)\/?>/gi;
    let repMatch: RegExpExecArray | null;

    while ((repMatch = repRegex.exec(asBody)) !== null) {
      const repAttrs = repMatch[1];
      const id = getAttr(repAttrs, "id") ?? "";
      const bandwidth = parseInt(getAttr(repAttrs, "bandwidth") ?? "0", 10);
      const width = parseInt(getAttr(repAttrs, "width") ?? "0", 10) || asWidth;
      const height = parseInt(getAttr(repAttrs, "height") ?? "0", 10) || asHeight;

      if (bandwidth > 0) {
        representations.push({
          id,
          bandwidth,
          width: width || undefined,
          height: height || undefined,
        });
      }
    }
  }

  return representations;
}

/** Extracts the value of a named XML attribute from an attribute string. */
function getAttr(attrs: string, name: string): string | undefined {
  const regex = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = attrs.match(regex);
  return match ? match[1] : undefined;
}

function deduplicateQualities(qualities: VideoQuality[]): VideoQuality[] {
  return qualities.reduce((acc: VideoQuality[], quality) => {
    const existing = acc.find((q) => q.resolution === quality.resolution);
    if (!existing) {
      acc.push(quality);
    } else if (
      quality.bitrate &&
      existing.bitrate &&
      quality.bitrate > existing.bitrate
    ) {
      const index = acc.indexOf(existing);
      acc[index] = quality;
    }
    return acc;
  }, []);
}

export function isDASHStream(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.includes(".mpd") ||
    lowerUrl.includes("/dash/") ||
    lowerUrl.includes("manifest.mpd")
  );
}
