import { buildXtreamPlaylistUrl, normalizeXtreamServer } from "../xtream";

describe("normalizeXtreamServer", () => {
  it("adds http:// when no scheme is given", () => {
    expect(normalizeXtreamServer("example.com:8080")).toBe(
      "http://example.com:8080",
    );
  });

  it("strips trailing slashes, queries and known endpoints", () => {
    expect(normalizeXtreamServer("https://example.com/")).toBe(
      "https://example.com",
    );
    expect(
      normalizeXtreamServer("http://example.com:80/get.php?username=a"),
    ).toBe("http://example.com:80");
    expect(
      normalizeXtreamServer("http://example.com/iptv/player_api.php"),
    ).toBe("http://example.com/iptv");
  });

  it("rejects empty and non-http input", () => {
    expect(() => normalizeXtreamServer("  ")).toThrow();
    expect(() => normalizeXtreamServer("ftp://example.com")).toThrow();
  });
});

describe("buildXtreamPlaylistUrl", () => {
  it("builds an m3u_plus URL with encoded credentials", () => {
    expect(
      buildXtreamPlaylistUrl({
        server: "example.com:8080",
        username: " user ",
        password: "p&ss word",
      }),
    ).toBe(
      "http://example.com:8080/get.php?username=user&password=p%26ss%20word&type=m3u_plus&output=ts",
    );
  });

  it("requires username and password", () => {
    expect(() =>
      buildXtreamPlaylistUrl({ server: "a.com", username: "", password: "x" }),
    ).toThrow("username");
    expect(() =>
      buildXtreamPlaylistUrl({ server: "a.com", username: "u", password: "" }),
    ).toThrow("password");
  });
});
