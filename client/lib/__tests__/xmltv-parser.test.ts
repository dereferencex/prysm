import {
  extractEpgUrlsFromM3U,
  parseXmltvTime,
  parseXMLTV,
} from "../xmltv-parser";
import { gzipSync } from "fflate";

jest.mock("../../../modules/tv-player/src/index", () => ({
  fetchPlaylistNative: jest.fn().mockResolvedValue({ success: false, content: "" }),
}));

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "/tmp/",
  downloadAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  deleteAsync: jest.fn(),
  EncodingType: { Base64: "base64" },
}));

describe("xmltv-parser", () => {
  describe("extractEpgUrlsFromM3U", () => {
    it("extracts single url-tvg with .gz extension", () => {
      const m3u = `#EXTM3U url-tvg="http://example.com/epg.xml.gz"\n#EXTINF:-1,Channel 1\nhttp://live.ts`;
      const urls = extractEpgUrlsFromM3U(m3u);
      expect(urls).toEqual(["http://example.com/epg.xml.gz"]);
    });

    it("extracts x-tvg-url and tvg-url with multiple comma or semicolon separated URLs", () => {
      const m3u = `#EXTM3U x-tvg-url="http://a.com/epg1.xml,https://b.com/epg2.xml.gz;http://c.com/epg3.gz"\n#EXTINF:-1,Test`;
      const urls = extractEpgUrlsFromM3U(m3u);
      expect(urls).toEqual([
        "http://a.com/epg1.xml",
        "https://b.com/epg2.xml.gz",
        "http://c.com/epg3.gz",
      ]);
    });

    it("handles headers located within comments or multiple lines down", () => {
      const m3u = `#EXTM3U\n# Comment line 1\n# Comment line 2\n# tvg-url="https://epg.share/guide.xml.gz"\n#EXTINF:-1,Ch 1\nhttp://stream`;
      const urls = extractEpgUrlsFromM3U(m3u);
      expect(urls).toEqual(["https://epg.share/guide.xml.gz"]);
    });
  });

  describe("parseXmltvTime", () => {
    it("parses XMLTV datetime with positive timezone offset", () => {
      // 2025-09-04 18:00:00 UTC+02:00 -> 16:00:00 UTC
      const ms = parseXmltvTime("20250904180000 +0200");
      const expected = Date.UTC(2025, 8, 4, 16, 0, 0);
      expect(ms).toBe(expected);
    });

    it("parses XMLTV datetime with negative timezone offset", () => {
      // 2025-09-04 18:00:00 UTC-05:00 -> 23:00:00 UTC
      const ms = parseXmltvTime("20250904180000 -0500");
      const expected = Date.UTC(2025, 8, 4, 23, 0, 0);
      expect(ms).toBe(expected);
    });

    it("parses XMLTV datetime without timezone offset as UTC", () => {
      const ms = parseXmltvTime("20250904180000");
      const expected = Date.UTC(2025, 8, 4, 18, 0, 0);
      expect(ms).toBe(expected);
    });
  });

  describe("parseXMLTV", () => {
    const fixedNow = Date.UTC(2025, 8, 4, 12, 0, 0); // 12:00 UTC

    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="Prysm Test">
  <channel id="nickelodeon.fr">
    <display-name>Nickelodeon</display-name>
    <display-name>FR - NICKELODEON</display-name>
  </channel>
  <programme start="20250904110000 +0000" stop="20250904130000 +0000" channel="nickelodeon.fr">
    <title><![CDATA[Wylde Pak &amp; Friends]]></title>
    <desc>Exciting adventures in Canyon Valley with Jack &lt;Jack&gt;</desc>
    <icon src="https://example.com/icon.png" />
  </programme>
</tv>`;

    it("extracts channels and programmes with CDATA and HTML entities decoded", () => {
      const result = parseXMLTV(sampleXml, { now: fixedNow });
      expect(result.channelNames.has("nickelodeon.fr")).toBe(true);
      expect(result.channelNames.get("nickelodeon.fr")).toEqual([
        "Nickelodeon",
        "FR - NICKELODEON",
      ]);

      expect(result.programs.length).toBe(1);
      const prog = result.programs[0];
      expect(prog.xmltvChannelId).toBe("nickelodeon.fr");
      expect(prog.title).toBe("Wylde Pak & Friends");
      expect(prog.desc).toBe("Exciting adventures in Canyon Valley with Jack <Jack>");
      expect(prog.icon).toBe("https://example.com/icon.png");
      expect(prog.start).toBe(Date.UTC(2025, 8, 4, 11, 0, 0));
      expect(prog.end).toBe(Date.UTC(2025, 8, 4, 13, 0, 0));
    });

    it("verifies gzip compression and decompression support", () => {
      const utf8 = new TextEncoder().encode(sampleXml);
      const compressed = gzipSync(utf8);
      // Check gzip magic bytes 0x1f 0x8b
      expect(compressed[0]).toBe(0x1f);
      expect(compressed[1]).toBe(0x8b);
    });
  });
});
