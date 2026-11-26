import {
  buildXtreamApiUrl,
  buildXtreamPlaylistUrl,
  checkXtreamAccount,
  normalizeXtreamServer,
  parseXtreamGetUrl,
  pickXtreamOutput,
  xtreamLiveToChannels,
} from "../xtream";

describe("buildXtreamApiUrl", () => {
  it("points at player_api.php with the credentials", () => {
    expect(
      buildXtreamApiUrl({ server: "a.com", username: "u", password: "p" }),
    ).toBe("http://a.com/player_api.php?username=u&password=p");
  });
});

describe("checkXtreamAccount", () => {
  it("accepts an active, authenticated account", () => {
    expect(
      checkXtreamAccount('{"user_info":{"auth":1,"status":"Active"}}'),
    ).toBeNull();
  });

  it("reports wrong credentials", () => {
    expect(checkXtreamAccount('{"user_info":{"auth":0}}')).toBe(
      "Wrong username or password",
    );
  });

  it("reports inactive accounts", () => {
    expect(
      checkXtreamAccount('{"user_info":{"auth":1,"status":"Expired"}}'),
    ).toBe("Your Xtream account is expired");
  });

  it("does not block on unrecognised responses", () => {
    expect(checkXtreamAccount("<html>nope</html>")).toBeNull();
    expect(checkXtreamAccount("[]")).toBeNull();
  });
});

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

describe("parseXtreamGetUrl", () => {
  it("round-trips a URL built by buildXtreamPlaylistUrl", () => {
    const url = buildXtreamPlaylistUrl({
      server: "http://a.com:8080/iptv",
      username: "u",
      password: "p&q",
    });
    expect(parseXtreamGetUrl(url)).toEqual({
      base: "http://a.com:8080/iptv",
      username: "u",
      password: "p&q",
    });
  });

  it("ignores non-Xtream URLs", () => {
    expect(parseXtreamGetUrl("http://a.com/list.m3u")).toBeNull();
    expect(parseXtreamGetUrl("http://a.com/get.php?type=m3u")).toBeNull();
  });
});

describe("pickXtreamOutput", () => {
  it("prefers ts, then m3u8", () => {
    expect(pickXtreamOutput({ allowed_output_formats: ["m3u8", "ts"] })).toBe(
      "ts",
    );
    expect(pickXtreamOutput({ allowed_output_formats: ["m3u8"] })).toBe("m3u8");
    expect(pickXtreamOutput(undefined)).toBe("ts");
  });
});

describe("xtreamLiveToChannels", () => {
  const categories = [
    { category_id: "2", category_name: "Sports" },
    { category_id: "1", category_name: "News" },
    { category_id: "3", category_name: "Empty" },
  ];
  const streams = [
    {
      num: 2,
      name: "News One",
      stream_id: 20,
      category_id: "1",
      stream_icon: "http://img/n.png",
      epg_channel_id: "news.one",
    },
    { num: 1, name: "Sport One", stream_id: 10, category_id: "2" },
    { num: 3, name: "Lost", stream_id: 30, category_id: "99" },
    { num: 4, name: "No id" },
  ];

  it("builds live stream URLs in provider order", () => {
    const out = xtreamLiveToChannels(
      "http://a.com",
      "u",
      "p",
      categories,
      streams,
    );
    expect(out.channels.map((c) => c.url)).toEqual([
      "http://a.com/live/u/p/10.ts",
      "http://a.com/live/u/p/20.ts",
      "http://a.com/live/u/p/30.ts",
    ]);
    expect(out.channels[1]).toMatchObject({
      name: "News One",
      group: "News",
      logo: "http://img/n.png",
      tvgId: "news.one",
    });
    expect(out.channels[2].group).toBe("Uncategorized");
    expect(out.categories).toEqual(["Sports", "News", "Uncategorized"]);
  });

  it("handles junk input without throwing", () => {
    expect(xtreamLiveToChannels("http://a.com", "u", "p", null, {})).toEqual({
      channels: [],
      categories: [],
    });
  });
});
