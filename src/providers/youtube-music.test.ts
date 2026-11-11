import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/core/types";
import { createYouTubeMusicProvider, parseDuration, parseVideoTitle, youTubeMusicConnector } from "./youtube-music";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const apiError = (status: number, reason: string, message = reason) =>
  json({ error: { code: status, message, errors: [{ reason, message }] } }, status);
const fetchMock = vi.fn<typeof fetch>();
const calledUrl = (call: number) => new URL(String(fetchMock.mock.calls[call][0]));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("parseVideoTitle", () => {
  it.each([
    ["Misery Business", "Paramore - Topic", "Misery Business", "Paramore"],
    ["Paramore: Misery Business [OFFICIAL VIDEO]", "Paramore", "Paramore: Misery Business", "Paramore"],
    ["Paramore - Misery Business (Official Video)", "Paramore", "Misery Business", "Paramore"],
    ["Fall Out Boy - Thnks fr th Mmrs (Official Music Video)", "FallOutBoyVEVO", "Thnks fr th Mmrs", "Fall Out Boy"],
    ["All Time Low – Dear Maria, Count Me In [Official Audio]", "All Time Low", "Dear Maria, Count Me In", "All Time Low"],
    ["Girlfriend (Lyrics)", "Avril Lavigne", "Girlfriend", "Avril Lavigne"],
    ["Shake It (Official Lyric Video) (HD)", "Metro Station", "Shake It", "Metro Station"],
    ["Sum 41 - Walking Disaster", "7clouds", "Sum 41 - Walking Disaster", "7clouds"],
    ["Untouched (Live) (Official Video)", "The Veronicas", "Untouched (Live)", "The Veronicas"],
  ])("%s on %s", (title, channel, name, artist) => {
    expect(parseVideoTitle(title, channel)).toEqual({ name, artist });
  });
});

describe("parseDuration", () => {
  it.each([
    ["PT3M25S", 205_000],
    ["PT45S", 45_000],
    ["PT1H2M3S", 3_723_000],
    ["PT4M", 240_000],
    ["P1DT1S", 86_401_000],
    ["P0D", 0],
    ["garbage", 0],
  ])("%s", (iso, ms) => expect(parseDuration(iso)).toBe(ms));
});

const video = (id: string, title: string, channelTitle: string, duration = "PT3M20S") => ({
  id,
  snippet: {
    title,
    channelTitle,
    publishedAt: "2007-06-12T10:00:00Z",
    thumbnails: { default: { url: `https://i.ytimg.com/${id}/default.jpg` }, high: { url: `https://i.ytimg.com/${id}/hq.jpg` } },
  },
  contentDetails: { duration },
});

describe("search", () => {
  it("searches music videos, fetches durations and maps them with Topic channels first", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [{ id: { videoId: "vid1" } }, { id: { videoId: "vid2" } }] }))
      .mockResolvedValueOnce(
        json({
          items: [
            video("vid2", "Misery Business", "Paramore - Topic", "PT3M31S"),
            video("vid1", "Paramore - Misery Business [Official Music Video]", "Paramore"),
          ],
        }),
      );
    const tracks = await createYouTubeMusicProvider({ apiKey: "KEY" }).search({
      title: "Misery Business",
      artist: "Paramore",
      mode: "exact",
    });

    expect(Object.fromEntries(calledUrl(0).searchParams)).toEqual({
      part: "snippet",
      type: "video",
      videoCategoryId: "10",
      q: '"Misery Business" Paramore',
      maxResults: "10",
      key: "KEY",
    });
    expect(calledUrl(1).pathname).toBe("/youtube/v3/videos");
    expect(calledUrl(1).searchParams.get("id")).toBe("vid1,vid2");
    expect(tracks).toEqual([
      {
        provider: "youtube-music",
        id: "vid2",
        uri: "vid2",
        url: "https://music.youtube.com/watch?v=vid2",
        name: "Misery Business",
        artists: ["Paramore"],
        album: { name: "", releaseDate: "2007-06-12", imageUrl: "https://i.ytimg.com/vid2/hq.jpg" },
        durationMs: 211_000,
      },
      expect.objectContaining({ id: "vid1", name: "Misery Business", artists: ["Paramore"], durationMs: 200_000 }),
    ]);
    expect(tracks[0].isrc).toBeUndefined();
  });

  it("uses a loose query and the bearer token when connected, and skips videos.list with no hits", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    const result = await createYouTubeMusicProvider({ accessToken: "AT" }).search({ title: "Girlfriend", mode: "loose" });
    expect(result).toEqual([]);
    expect(calledUrl(0).searchParams.get("q")).toBe("Girlfriend");
    expect(calledUrl(0).searchParams.has("key")).toBe(false);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer AT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["quotaExceeded", "rateLimitExceeded"])("maps a 403 %s to rate-limited with a daily-quota message", async (reason) => {
    fetchMock.mockResolvedValueOnce(apiError(403, reason));
    const error = await createYouTubeMusicProvider({ apiKey: "KEY" })
      .search({ title: "x", mode: "loose" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "rate-limited", message: expect.stringContaining("daily YouTube API quota") });
  });

  it("maps other errors", async () => {
    const provider = createYouTubeMusicProvider({ accessToken: "AT" });
    const kindOf = (res: Response | Error) => {
      if (res instanceof Error) fetchMock.mockRejectedValueOnce(res);
      else fetchMock.mockResolvedValueOnce(res);
      return provider.search({ title: "x", mode: "loose" }).catch((e: ProviderError) => e.kind);
    };
    expect(await kindOf(apiError(401, "authError"))).toBe("auth");
    expect(await kindOf(apiError(403, "forbidden"))).toBe("forbidden");
    expect(await kindOf(apiError(404, "notFound"))).toBe("not-found");
    expect(await kindOf(json({}, 500))).toBe("unknown");
    expect(await kindOf(new TypeError("offline"))).toBe("network");
  });
});

describe("playlists", () => {
  it("lists every page of the user's playlists as editable", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          items: [{ id: "PL1", snippet: { title: "One", thumbnails: {} }, contentDetails: { itemCount: 3 } }],
          nextPageToken: "page2",
        }),
      )
      .mockResolvedValueOnce(
        json({ items: [{ id: "PL2", snippet: { title: "Two", thumbnails: {} }, contentDetails: { itemCount: 0 } }] }),
      );
    expect(await createYouTubeMusicProvider({ accessToken: "AT" }).listPlaylists()).toEqual([
      { id: "PL1", name: "One", trackCount: 3, imageUrl: undefined, editable: true },
      { id: "PL2", name: "Two", trackCount: 0, imageUrl: undefined, editable: true },
    ]);
    expect(Object.fromEntries(calledUrl(0).searchParams)).toEqual({
      part: "snippet,contentDetails",
      mine: "true",
      maxResults: "50",
    });
    expect(calledUrl(1).searchParams.get("pageToken")).toBe("page2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("collects video ids across playlistItems pages", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [{ contentDetails: { videoId: "a" } }], nextPageToken: "n" }))
      .mockResolvedValueOnce(json({ items: [{ contentDetails: { videoId: "b" } }] }));
    expect(await createYouTubeMusicProvider({ accessToken: "AT" }).playlistTrackIds("PL1")).toEqual(["a", "b"]);
  });

  it("creates a private playlist", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "PLnew", snippet: { title: "Snap", thumbnails: {} } }));
    expect(await createYouTubeMusicProvider({ accessToken: "AT" }).createPlaylist("Snap")).toEqual({
      id: "PLnew",
      name: "Snap",
      trackCount: 0,
      editable: true,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      snippet: { title: "Snap" },
      status: { privacyStatus: "private" },
    });
  });

  it("refuses user methods without an access token and never calls YouTube", async () => {
    const anonymous = createYouTubeMusicProvider({ apiKey: "KEY" });
    await expect(anonymous.listPlaylists()).rejects.toMatchObject({ kind: "auth" });
    await expect(anonymous.addTracks("PL1", ["a"])).rejects.toMatchObject({ kind: "auth" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("addTracks", () => {
  it("inserts one item per call, in order", async () => {
    fetchMock.mockResolvedValue(json({ id: "item" }));
    expect(await createYouTubeMusicProvider({ accessToken: "AT" }).addTracks("PL1", ["a", "b", "c"])).toEqual([
      { status: "added", trackId: "a" },
      { status: "added", trackId: "b" },
      { status: "added", trackId: "c" },
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).snippet)).toEqual(
      ["a", "b", "c"].map((videoId) => ({ playlistId: "PL1", resourceId: { kind: "youtube#video", videoId } })),
    );
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("stops at the first failure, marks the rest failed and does not retry", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "item" })).mockResolvedValueOnce(apiError(403, "quotaExceeded"));
    const outcomes = await createYouTubeMusicProvider({ accessToken: "AT" }).addTracks("PL1", ["a", "b", "c", "d"]);
    expect(outcomes).toEqual([
      { status: "added", trackId: "a" },
      { status: "failed", trackId: "b", reason: expect.stringContaining("daily YouTube API quota") },
      { status: "failed", trackId: "c", reason: "Not attempted after an earlier failure." },
      { status: "failed", trackId: "d", reason: "Not attempted after an earlier failure." },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("youTubeMusicConnector", () => {
  it("is not configured without Google credentials", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("YOUTUBE_API_KEY", "");
    expect(youTubeMusicConnector.configured()).toBe(false);
    expect(await youTubeMusicConnector.user()).toEqual({ ok: false, reason: "not-configured" });
    expect(await youTubeMusicConnector.anonymous()).toEqual({ ok: false, reason: "not-configured" });
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    expect(youTubeMusicConnector.configured()).toBe(false);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    expect(youTubeMusicConnector.configured()).toBe(true);
  });

  it("offers anonymous search with only an API key", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "KEY");
    const access = await youTubeMusicConnector.anonymous();
    expect(access.ok && access.provider.id).toBe("youtube-music");
  });
});
