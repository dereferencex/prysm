import {
  parseKodiProp,
  parseM3U,
} from "../m3u-parser";
import type { Channel } from "@/types/playlist";

// ── parseKodiProp: direct unit tests ──────────────────────────────────────────

describe("parseKodiProp", () => {
  test("parses a simple key=value directive", () => {
    expect(parseKodiProp("#KODIPROP:foo=bar")).toEqual({
      key: "foo",
      value: "bar",
    });
  });

  test("preserves a ':' in the value (ClearKey KID:KEY)", () => {
    const line =
      "#KODIPROP:inputstream.adaptive.license_key=nrQFDeRLSAKTLifXUIPiZg:FmY0xnWCPCNaSpRG-tUuTQ";
    const parsed = parseKodiProp(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.key).toBe("inputstream.adaptive.license_key");
    // The full KID:KEY pair must survive, including the colon.
    expect(parsed!.value).toBe(
      "nrQFDeRLSAKTLifXUIPiZg:FmY0xnWCPCNaSpRG-tUuTQ",
    );
  });

  test("preserves a full ClearKey JSON document (value contains ':' and ',')", () => {
    const json =
      '{"keys":[{"kty":"oct","kid":"nrQFDeRLSAKTLifXUIPiZg","k":"FmY0xnWCPCNaSpRG-tUuTQ"}],"type":"temporary"}';
    const line = `#KODIPROP:inputstream.adaptive.license_key=${json}`;
    const parsed = parseKodiProp(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.key).toBe("inputstream.adaptive.license_key");
    expect(parsed!.value).toBe(json);
  });

  test("preserves multiple ':' characters in the value", () => {
    const line =
      "#KODIPROP:inputstream.adaptive.license_key=https://license.example.com:8080/path";
    const parsed = parseKodiProp(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.value).toBe(
      "https://license.example.com:8080/path",
    );
  });

  test("splits only on the FIRST '=' and keeps '=' in the value", () => {
    const line = "#KODIPROP:inputstream.adaptive.license_key=a=b:c";
    const parsed = parseKodiProp(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.key).toBe("inputstream.adaptive.license_key");
    expect(parsed!.value).toBe("a=b:c");
  });

  test("returns null for a non-KODIPROP line", () => {
    expect(parseKodiProp("#EXTINF:-1,Channel")).toBeNull();
    expect(parseKodiProp("#KODIPROP")).toBeNull();
    expect(parseKodiProp("#KODIPROPX:foo=bar")).toBeNull();
    expect(parseKodiProp("https://example.com/stream.mpd")).toBeNull();
  });

  test("returns null for a KODIPROP line without '='", () => {
    expect(parseKodiProp("#KODIPROP:inputstream.adaptive")).toBeNull();
    expect(parseKodiProp("#KODIPROP:")).toBeNull();
  });

  test("trims surrounding whitespace from key and value", () => {
    const line =
      "#KODIPROP:  inputstream.adaptive.license_type  =  org.w3.clearkey  ";
    const parsed = parseKodiProp(line.trim());
    // Note: parseKodiProp strips the prefix only; caller is expected to pass
    // a trimmed line (parseM3U trims all lines). Verify the raw split behavior.
    // The leading spaces here go to the key because trim() was applied to the
    // whole line by the caller in parseM3U, so pass a pre-trimmed line.
    const trimmed = line.trim();
    const p = parseKodiProp(trimmed);
    expect(p!.key).toBe("inputstream.adaptive.license_type");
    expect(p!.value).toBe("org.w3.clearkey");
  });
});

// ── parseM3U: end-to-end ClearKey channel parsing ────────────────────────────

const CLEARKEY_PLAYLIST = `#EXTM3U

#EXTINF:-1 tvg-id="axinom-clearkey-json" tvg-name="Axinom ClearKey (JSON)" group-title="Test",Axinom ClearKey Test (JSON)
#KODIPROP:inputstream=inputstream.adaptive
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey
#KODIPROP:inputstream.adaptive.license_key={"keys":[{"kty":"oct","kid":"nrQFDeRLSAKTLifXUIPiZg","k":"FmY0xnWCPCNaSpRG-tUuTQ"}],"type":"temporary"}
https://media.axprod.net/TestVectors/v7-MultiDRM-SingleKey/Manifest_1080p_ClearKey.mpd

#EXTINF:-1 tvg-id="axinom-clearkey-simple" tvg-name="Axinom ClearKey (KID:KEY)" group-title="Test",Axinom ClearKey Test (KID:KEY)
#KODIPROP:inputstream=inputstream.adaptive
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey
#KODIPROP:inputstream.adaptive.license_key=nrQFDeRLSAKTLifXUIPiZg:FmY0xnWCPCNaSpRG-tUuTQ
https://media.axprod.net/TestVectors/v7-MultiDRM-SingleKey/Manifest_1080p_ClearKey.mpd
`;

const JSON_LICENSE =
  '{"keys":[{"kty":"oct","kid":"nrQFDeRLSAKTLifXUIPiZg","k":"FmY0xnWCPCNaSpRG-tUuTQ"}],"type":"temporary"}';
const KIDKEY_LICENSE = "nrQFDeRLSAKTLifXUIPiZg:FmY0xnWCPCNaSpRG-tUuTQ";
const STREAM_URL =
  "https://media.axprod.net/TestVectors/v7-MultiDRM-SingleKey/Manifest_1080p_ClearKey.mpd";

describe("parseM3U — ClearKey formats", () => {
  let channels: Channel[];

  beforeAll(() => {
    const playlist = parseM3U(CLEARKEY_PLAYLIST, "test");
    channels = playlist.channels;
  });

  test("emits BOTH channels (neither is dropped)", () => {
    expect(channels).toHaveLength(2);
  });

  test("channel names are parsed from the EXTINF comma suffix", () => {
    expect(channels.map((c) => c.name)).toEqual([
      "Axinom ClearKey Test (JSON)",
      "Axinom ClearKey Test (KID:KEY)",
    ]);
  });

  test("the JSON ClearKey channel carries the full JSON license_key verbatim", () => {
    expect(channels[0].drm).toEqual({
      type: "clearkey",
      licenseServer: JSON_LICENSE,
    });
  });

  test("the KID:KEY ClearKey channel carries the full KID:KEY pair verbatim", () => {
    expect(channels[1].drm).toEqual({
      type: "clearkey",
      licenseServer: KIDKEY_LICENSE,
    });
  });

  test("both channels keep the stream URL intact", () => {
    expect(channels[0].url).toBe(STREAM_URL);
    expect(channels[1].url).toBe(STREAM_URL);
  });

  test("duplicate-URL channels get DISTINCT ids so list renderers don't drop one", () => {
    expect(channels[0].id).not.toBe(channels[1].id);
    expect(channels[0].id).toMatch(/^ch_/);
    expect(channels[1].id).toMatch(/^ch_/);
  });

  test("parsing the same playlist twice produces identical ids (stable)", () => {
    const second = parseM3U(CLEARKEY_PLAYLIST, "test").channels;
    expect(second.map((c) => c.id)).toEqual(channels.map((c) => c.id));
  });
});

// ── parseM3U: invalid KODIPROP handling ──────────────────────────────────────

describe("parseM3U — invalid #KODIPROP lines", () => {
  test("a KODIPROP without '=' is ignored but the channel is still created", () => {
    const playlist = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-id="x" group-title="G",Ch\n#KODIPROP:inputstream.adaptive\nhttps://example.com/a.mpd`,
      "p",
    );
    expect(playlist.channels).toHaveLength(1);
    expect(playlist.channels[0].name).toBe("Ch");
    // No license type / key declared → no DRM info.
    expect(playlist.channels[0].drm).toBeUndefined();
  });

  test("a non-KODIPROP '#KODIPROPX:' line is ignored", () => {
    const playlist = parseM3U(
      `#EXTM3U\n#EXTINF:-1 group-title="G",Ch\n#KODIPROPX:inputstream.adaptive.license_key=foo:bar\nhttps://example.com/a.mpd`,
      "p",
    );
    expect(playlist.channels).toHaveLength(1);
    expect(playlist.channels[0].drm).toBeUndefined();
  });

  test("only the first '=' splits key from value (extra '=' stays in value)", () => {
    const playlist = parseM3U(
      `#EXTM3U\n#EXTINF:-1 group-title="G",Ch\n#KODIPROP:inputstream.adaptive.license_key=KID:KEY=trail\nhttps://example.com/a.mpd`,
      "p",
    );
    expect(playlist.channels[0].drm?.licenseServer).toBe(
      "KID:KEY=trail",
    );
  });
});