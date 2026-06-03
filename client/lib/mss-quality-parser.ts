import { VideoQuality } from "@/components/AdvancedVideoPlayer";

interface MSSQualityLevel {
  index: number;
  bitrate: number;
  width?: number;
  height?: number;
  codecPrivateData?: string;
}

export async function parseMSSQualities(
  manifestUrl: string,
): Promise<VideoQuality[]> {
  try {
    const response = await fetch(manifestUrl, {
      headers: { Accept: "*/*" },
    });

    if (!response.ok) {
      console.warn("Failed to fetch MSS manifest:", response.status);
      return [];
    }

    const content = await response.text();
    return parseMSSManifest(content, manifestUrl);
  } catch (error) {
    console.warn("Error parsing MSS qualities:", error);
    return [];
  }
}

function parseMSSManifest(content: string, baseUrl: string): VideoQuality[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");

  // Check if it's a valid SmoothStreamingMedia document
  const root = doc.querySelector("SmoothStreamingMedia");
  if (!root) return [];

  const representations = extractQualityLevels(doc);
  if (representations.length === 0) return [];

  representations.sort((a, b) => b.bitrate - a.bitrate);

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

function extractQualityLevels(doc: Document): MSSQualityLevel[] {
  const levels: MSSQualityLevel[] = [];

  // SmoothStreamingMedia > StreamIndex > QualityLevel
  const streamIndexes = Array.from(doc.querySelectorAll("StreamIndex"));

  for (const streamIndex of streamIndexes) {
    const type = streamIndex.getAttribute("Type") || "";

    // Only process video stream indexes
    if (type.toLowerCase() !== "video") continue;

    const qualityLevels = Array.from(streamIndex.querySelectorAll("QualityLevel"));

    for (const level of qualityLevels) {
      const index = parseInt(level.getAttribute("Index") || "0", 10);
      const bitrate = parseInt(level.getAttribute("Bitrate") || "0", 10);
      const width = level.getAttribute("MaxWidth")
        ? parseInt(level.getAttribute("MaxWidth")!, 10)
        : undefined;
      const height = level.getAttribute("MaxHeight")
        ? parseInt(level.getAttribute("MaxHeight")!, 10)
        : undefined;
      const codecPrivateData = level.getAttribute("CodecPrivateData") || undefined;

      if (bitrate > 0) {
        levels.push({
          index,
          bitrate,
          width,
          height,
          codecPrivateData,
        });
      }
    }
  }

  return levels;
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
