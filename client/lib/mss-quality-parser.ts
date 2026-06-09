import { VideoQuality } from "@/components/AdvancedVideoPlayer";

/**
 * Microsoft Smooth Streaming manifest quality parser.
 *
 * Uses pure regex/string parsing instead of DOMParser — DOMParser is a
 * browser API that is not available in React Native's JS environment and
 * caused a silent ReferenceError that made MSS quality detection always
 * return [].
 */

interface MSSQualityLevel {
  index: number;
  bitrate: number;
  width?: number;
  height?: number;
}

export async function parseMSSQualities(
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
      console.warn("Failed to fetch MSS manifest:", response.status);
      return [];
    }

    const content = await response.text();
    return parseMSSManifest(content);
  } catch (error) {
    console.warn("Error parsing MSS qualities:", error);
    return [];
  }
}

function parseMSSManifest(content: string): VideoQuality[] {
  // Verify this is a SmoothStreamingMedia document
  if (!/<SmoothStreamingMedia/i.test(content)) return [];

  const levels = extractQualityLevels(content);
  if (levels.length === 0) return [];

  levels.sort((a, b) => b.bitrate - a.bitrate);

  const qualities: VideoQuality[] = levels.map((rep) => {
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
      const kbps = Math.round(rep.bitrate / 1000);
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
      bitrate: rep.bitrate,
    };
  });

  return deduplicateQualities(qualities);
}

/**
 * Extracts QualityLevel elements from the video StreamIndex of a Smooth
 * Streaming manifest using regex parsing — no DOM dependency.
 *
 * Structure:
 *   <SmoothStreamingMedia>
 *     <StreamIndex Type="video" ...>
 *       <QualityLevel Index="0" Bitrate="..." MaxWidth="..." MaxHeight="..." .../>
 *     </StreamIndex>
 *   </SmoothStreamingMedia>
 */
function extractQualityLevels(content: string): MSSQualityLevel[] {
  const levels: MSSQualityLevel[] = [];

  // Match each StreamIndex block
  const streamIndexRegex = /<StreamIndex([^>]*)>([\s\S]*?)<\/StreamIndex>/gi;
  let siMatch: RegExpExecArray | null;

  while ((siMatch = streamIndexRegex.exec(content)) !== null) {
    const siAttrs = siMatch[1];
    const siBody = siMatch[2];

    // Only process video stream indexes
    const type = getAttr(siAttrs, "Type") ?? getAttr(siAttrs, "type") ?? "";
    if (type.toLowerCase() !== "video") continue;

    // Extract each QualityLevel within this StreamIndex
    const qlRegex = /<QualityLevel([^>]*)\/?>/gi;
    let qlMatch: RegExpExecArray | null;

    while ((qlMatch = qlRegex.exec(siBody)) !== null) {
      const qlAttrs = qlMatch[1];
      const index = parseInt(getAttr(qlAttrs, "Index") ?? "0", 10);
      const bitrate = parseInt(getAttr(qlAttrs, "Bitrate") ?? "0", 10);
      const width = parseInt(getAttr(qlAttrs, "MaxWidth") ?? "0", 10) || undefined;
      const height = parseInt(getAttr(qlAttrs, "MaxHeight") ?? "0", 10) || undefined;

      if (bitrate > 0) {
        levels.push({ index, bitrate, width, height });
      }
    }
  }

  return levels;
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

export function isMSSStream(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.includes(".ism/") ||
    lowerUrl.includes(".ismc") ||
    lowerUrl.includes("/smoothstreaming/") ||
    lowerUrl.includes("manifest.isml")
  );
}
