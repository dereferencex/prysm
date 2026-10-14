import { existsSync, readFileSync } from "fs";
import { gunzipSync } from "zlib";
import { parseXMLTV, parseXMLTVAsync } from "../xmltv-parser";

jest.mock("../../../modules/tv-player/src/index", () => ({
  fetchPlaylistNative: jest.fn(),
}));

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "/tmp/",
  downloadAsync: jest.fn(),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  deleteAsync: jest.fn(),
}));

jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation(() => ({
    bytes: jest.fn().mockResolvedValue(new Uint8Array()),
  })),
}));

const GZ = `${process.env.TEMP}\\epg.xml.gz`;

describe("xmltv bench (real feed)", () => {
  it("parses the real mjh EPG quickly", async () => {
    if (!existsSync(GZ)) {
      console.log("no real feed available, skipping bench");
      return;
    }
    const gz = readFileSync(GZ);
    const xml = gunzipSync(gz).toString("utf8");
    console.log(`xml: ${xml.length} chars`);

    let t = Date.now();
    const sync = parseXMLTV(xml);
    console.log(`parseXMLTV: ${Date.now() - t}ms, ${sync.programs.length} programs, ${sync.channelNames.size} channels`);

    t = Date.now();
    const async_ = await parseXMLTVAsync(xml);
    console.log(`parseXMLTVAsync: ${Date.now() - t}ms, ${async_.programs.length} programs, ${async_.channelNames.size} channels`);

    expect(sync.programs.length).toBeGreaterThan(1000);
    expect(sync.channelNames.size).toBe(288);
    expect(async_.programs.length).toBe(sync.programs.length);
    expect(async_.channelNames.size).toBe(sync.channelNames.size);
    const sample = sync.programs[Math.floor(sync.programs.length / 2)];
    const match = async_.programs.find((p) => p.id === sample.id);
    expect(match).toBeTruthy();
    expect(match!.title).toBe(sample.title);
    expect(match!.desc).toBe(sample.desc);
    expect(match!.icon).toBe(sample.icon);
    expect(match!.xmltvChannelId).toBe(sample.xmltvChannelId);
  }, 120000);
});
