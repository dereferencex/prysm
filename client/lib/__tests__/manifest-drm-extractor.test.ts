import { extractDRMFromManifest } from "../manifest-drm-extractor";
import { clearManifestCache } from "../manifest-fetch-cache";

const originalFetch = global.fetch;

function setManifest(body: string): void {
  global.fetch = jest.fn(async () => ({
    ok: true,
    text: async () => body,
  })) as unknown as typeof global.fetch;
}

// The extractor now uses a shared manifest fetch cache so the HLS quality
// parser and DRM extractor don't both fetch the same manifest. Tests reuse
// the same URL with different bodies, so clear the cache between tests.
beforeEach(() => {
  clearManifestCache();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Regression: HLS AES-128 is native HLS encryption (ExoPlayer decrypts it
// directly), NOT EME/CDM DRM. It must not be reported as ClearKey/Widevine.
describe("extractDRMFromManifest — HLS AES-128 is NOT DRM", () => {
  test("AES-128 with KEYFORMAT=identity and a URL is not classified as ClearKey", async () => {
    setManifest(
      "#EXTM3U\n#EXT-X-VERSION:3\n" +
        '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin",KEYFORMAT="identity"\n' +
        "#EXTINF:10.0,\nseg0.ts\n#EXT-X-ENDLIST\n",
    );
    const drm = await extractDRMFromManifest(
      "https://cdn.example.com/master.m3u8",
    );
    expect(drm).toBeUndefined();
  });

  test("AES-128 without KEYFORMAT is not classified as DRM", async () => {
    setManifest(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin"\n' +
        "#EXTINF:10.0,\nseg0.ts\n",
    );
    const drm = await extractDRMFromManifest(
      "https://cdn.example.com/master.m3u8",
    );
    expect(drm).toBeUndefined();
  });
});

describe("extractDRMFromManifest — real DRM is still detected", () => {
  test("HLS ClearKey (SAMPLE-AES + ClearKey UUID + data: URI) is detected", async () => {
    const json =
      '{"keys":[{"kty":"oct","kid":"nrQFDeRLSAKTLifXUIPiZg","k":"FmY0xnWCPCNaSpRG-tUuTQ"}],"type":"temporary"}';
    const dataUri =
      "data:application/json;base64," +
      Buffer.from(json, "utf-8").toString("base64");
    setManifest(
      "#EXTM3U\n" +
        `#EXT-X-KEY:METHOD=SAMPLE-AES,URI="${dataUri}",KEYFORMAT="urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b"\n` +
        "#EXTINF:10.0,\nseg0.ts\n",
    );
    const drm = await extractDRMFromManifest(
      "https://cdn.example.com/master.m3u8",
    );
    expect(drm?.type).toBe("clearkey");
    expect(drm?.licenseKey).toBeTruthy();
  });

  test("HLS Widevine (SAMPLE-AES + Widevine UUID KEYFORMAT + URL) is detected", async () => {
    setManifest(
      "#EXTM3U\n" +
        '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="https://license.example.com/wv",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"\n' +
        "#EXTINF:10.0,\nseg0.ts\n",
    );
    const drm = await extractDRMFromManifest(
      "https://cdn.example.com/master.m3u8",
    );
    expect(drm?.type).toBe("widevine");
    expect(drm?.licenseServer).toBe("https://license.example.com/wv");
  });

  test("DASH with Widevine ContentProtection + dashif:laurl is detected", async () => {
    setManifest(
      "<MPD><AdaptationSet>" +
        '<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed">' +
        "<dashif:laurl>https://license.example.com/wv</dashif:laurl>" +
        "</ContentProtection></AdaptationSet></MPD>",
    );
    const drm = await extractDRMFromManifest(
      "https://cdn.example.com/manifest.mpd",
    );
    expect(drm?.type).toBe("widevine");
    expect(drm?.licenseServer).toBe("https://license.example.com/wv");
  });

  test("clear DASH manifest (no ContentProtection) is not DRM", async () => {
    setManifest(
      '<MPD><AdaptationSet><Representation mimeType="video/mp4"/></AdaptationSet></MPD>',
    );
    const drm = await extractDRMFromManifest(
      "https://cdn.example.com/manifest.mpd",
    );
    expect(drm).toBeUndefined();
  });
});
