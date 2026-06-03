import { VideoQuality } from "@/components/AdvancedVideoPlayer";

interface DASHRepresentation {
  id: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  baseUrl: string;
}

export async function parseDASHQualities(
  manifestUrl: string,
): Promise<VideoQuality[]> {
  try {
    const response = await fetch(manifestUrl, {
      headers: { Accept: "*/*" },
    });

    if (!response.ok) {
      console.warn("Failed to fetch DASH manifest:", response.status);
      return [];
    }

    const content = await response.text();
    return parseDASHManifest(content, manifestUrl);
  } catch (error) {
    console.warn("Error parsing DASH qualities:", error);
    return [];
  }
}

function parseDASHManifest(content: string, baseUrl: string): VideoQuality[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");

  const representations = extractRepresentations(doc);
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

function extractRepresentations(doc: Document): DASHRepresentation[] {
  const representations: DASHRepresentation[] = [];

  // Look for video adaptation sets (mimeType starts with "video/")
  const adaptationSets = Array.from(doc.querySelectorAll("AdaptationSet"));

  for (const adaptationSet of adaptationSets) {
    const mimeType = adaptationSet.getAttribute("mimeType") || "";

    // Skip non-video adaptation sets (audio, subtitles)
    if (mimeType && !mimeType.startsWith("video/")) continue;

    // Check for video-specific attributes to confirm it's a video set
    const contentType = adaptationSet.getAttribute("contentType");
    if (contentType && contentType !== "video") continue;

    const reps = Array.from(adaptationSet.querySelectorAll("Representation"));

    for (const rep of reps) {
      const id = rep.getAttribute("id") || "";
      const bandwidth = parseInt(rep.getAttribute("bandwidth") || "0", 10);
      const width = rep.getAttribute("width")
        ? parseInt(rep.getAttribute("width")!, 10)
        : undefined;
      const height = rep.getAttribute("height")
        ? parseInt(rep.getAttribute("height")!, 10)
        : undefined;
      const codecs = rep.getAttribute("codecs") || undefined;

      // Get the base URL for this representation
      const baseUrlEl = rep.querySelector("BaseURL");
      const baseUrl = baseUrlEl?.textContent?.trim() || "";

      if (bandwidth > 0) {
        representations.push({
          id,
          bandwidth,
          width,
          height,
          codecs,
          baseUrl,
        });
      }
    }
  }

  return representations;
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
