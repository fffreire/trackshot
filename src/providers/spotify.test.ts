import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/core/types";
import { connectors } from "./registry";
import { createSpotifyProvider } from "./spotify";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const apiTrack = {
  id: "t1",
  name: "Misery Business",
  duration_ms: 211520,
  is_playable: false,
  external_ids: { isrc: "USAT20700001" },
  artists: [{ name: "Paramore" }],
  album: {
    name: "RIOT!",
    album_type: "album",
    release_date: "2007-06-12",
    images: [{ url: "https://i.scdn.co/a.jpg" }],
  },
};

const mockFetch = (...responses: Response[]) => {
  const fetchMock = vi.fn<typeof fetch>();
  for (const res of responses) fetchMock.mockResolvedValueOnce(res);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
const url = (fetchMock: ReturnType<typeof mockFetch>, call: number) => new URL(String(fetchMock.mock.calls[call][0]));
const body = (fetchMock: ReturnType<typeof mockFetch>, call: number) =>
  JSON.parse(String(fetchMock.mock.calls[call][1]?.body)) as { uris: string[] };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("spotify provider", () => {
  it("maps tracks with ISRC, playability and album details", async () => {
    mockFetch(json({ tracks: { items: [apiTrack] } }));
    expect(await createSpotifyProvider("tok").search({ title: "Misery Business", mode: "loose" })).toEqual([
      {
        provider: "spotify",
        id: "t1",
        uri: "spotify:track:t1",
        url: "https://open.spotify.com/track/t1",
        name: "Misery Business",
        artists: ["Paramore"],
        album: { name: "RIOT!", type: "album", releaseDate: "2007-06-12", imageUrl: "https://i.scdn.co/a.jpg" },
        durationMs: 211520,
        isrc: "USAT20700001",
        isPlayable: false,
      },
    ]);
  });

  it("builds fielded exact queries, plain loose queries and ISRC lookups", async () => {
    const fetchMock = mockFetch(...Array.from({ length: 3 }, () => json({ tracks: { items: [] } })));
    const spotify = createSpotifyProvider("tok");
    await spotify.search({ title: 'Say "Hi"', artist: "Paramore", mode: "exact" });
    await spotify.search({ title: "Misery Business", artist: "Paramore", mode: "loose" });
    await spotify.findByIsrc?.("USAT20700001");
    expect(url(fetchMock, 0).searchParams.get("q")).toBe('track:"Say Hi" artist:"Paramore"');
    expect(url(fetchMock, 1).searchParams.get("q")).toBe("Misery Business Paramore");
    expect(url(fetchMock, 2).searchParams.get("q")).toBe("isrc:USAT20700001");
    expect(Object.fromEntries(url(fetchMock, 0).searchParams)).toMatchObject({
      type: "track",
      limit: "10",
      market: "from_token",
    });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("adds 230 tracks in ordered chunks of 100/100/30", async () => {
    const fetchMock = mockFetch(...Array.from({ length: 3 }, () => json({ snapshot_id: "s" }, 201)));
    const ids = Array.from({ length: 230 }, (_, i) => `id${i}`);
    const outcomes = await createSpotifyProvider("tok").addTracks("pl1", ids);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "POST"]);
    expect(url(fetchMock, 0).pathname).toBe("/v1/playlists/pl1/items");
    expect([0, 1, 2].map((call) => body(fetchMock, call).uris.length)).toEqual([100, 100, 30]);
    expect([0, 1, 2].flatMap((call) => body(fetchMock, call).uris)).toEqual(ids.map((id) => `spotify:track:${id}`));
    expect(outcomes).toEqual(ids.map((trackId) => ({ status: "added", trackId })));
  });

  it("stops at the first failed chunk without retrying the POST", async () => {
    const fetchMock = mockFetch(
      json({ snapshot_id: "s" }, 201),
      json({ error: { status: 500, message: "boom" } }, 500),
    );
    const ids = Array.from({ length: 230 }, (_, i) => `id${i}`);
    const outcomes = await createSpotifyProvider("tok").addTracks("pl1", ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcomes.slice(0, 100).every((o) => o.status === "added")).toBe(true);
    expect(outcomes.slice(100)).toEqual(
      ids.slice(100).map((trackId) => ({ status: "failed", trackId, reason: "Spotify responded 500 (boom)" })),
    );
  });

  it("does not retry a POST that got 429", async () => {
    const fetchMock = mockFetch(
      json({ error: { status: 429, reason: "QUOTA_EXCEEDED" } }, 429, { "Retry-After": "1" }),
    );
    const outcomes = await createSpotifyProvider("tok").addTracks("pl1", ["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([
      { status: "failed", trackId: "a", reason: "Spotify responded 429 (QUOTA_EXCEEDED)" },
      { status: "failed", trackId: "b", reason: "Spotify responded 429 (QUOTA_EXCEEDED)" },
    ]);
  });

  it("retries a GET after 429, honoring Retry-After", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(json({}, 429, { "Retry-After": "2" }), json({ tracks: { items: [apiTrack] } }));
    const result = createSpotifyProvider("tok").search({ title: "x", mode: "loose" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces rate-limited when Retry-After is too long, or after two retries", async () => {
    mockFetch(json({}, 429, { "Retry-After": "30" }));
    await expect(createSpotifyProvider("tok").search({ title: "x", mode: "loose" })).rejects.toMatchObject({
      kind: "rate-limited",
      retryAfterSeconds: 30,
    });

    vi.useFakeTimers();
    const fetchMock = mockFetch(json({}, 503), json({}, 503), json({}, 503));
    const result = createSpotifyProvider("tok").search({ title: "x", mode: "loose" });
    const settled = expect(result).rejects.toMatchObject({ kind: "unknown" });
    await vi.runAllTimersAsync();
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps 403 to forbidden and 401 to auth", async () => {
    mockFetch(json({ error: { status: 403, message: "Forbidden" } }, 403), json({}, 401));
    const spotify = createSpotifyProvider("tok");
    const forbidden = await spotify.search({ title: "x", mode: "loose" }).catch((e: unknown) => e);
    expect(forbidden).toBeInstanceOf(ProviderError);
    expect(forbidden).toMatchObject({ kind: "forbidden" });
    await expect(spotify.listPlaylists()).rejects.toMatchObject({ kind: "auth" });
  });

  it("flags playlists editable when owned or collaborative, across pages", async () => {
    const playlist = (id: string, owner: string, collaborative = false) => ({
      id,
      name: id,
      collaborative,
      owner: { id: owner },
      images: null,
      ...(owner === "me" || collaborative ? { items: { total: 3 } } : {}),
    });
    const fetchMock = mockFetch(
      json({ id: "me" }),
      json({
        next: "https://api.spotify.com/v1/me/playlists?offset=50&limit=50",
        items: [playlist("mine", "me"), null],
      }),
      json({ next: null, items: [playlist("collab", "other", true), playlist("followed", "other")] }),
    );
    expect(await createSpotifyProvider("tok").listPlaylists()).toEqual([
      { id: "mine", name: "mine", trackCount: 3, imageUrl: undefined, editable: true },
      { id: "collab", name: "collab", trackCount: 3, imageUrl: undefined, editable: true },
      { id: "followed", name: "followed", trackCount: 0, imageUrl: undefined, editable: false },
    ]);
    expect(url(fetchMock, 2).searchParams.get("offset")).toBe("50");
  });

  it("lists all 120 playlists across 3 pages, editable first", async () => {
    const page = (offset: number, count: number, next: boolean) =>
      json({
        next: next ? `https://api.spotify.com/v1/me/playlists?offset=${offset + 50}&limit=50` : null,
        items: Array.from({ length: count }, (_, i) => ({
          id: `p${offset + i}`,
          name: `p${offset + i}`,
          collaborative: false,
          owner: { id: (offset + i) % 3 === 0 ? "me" : "other" },
        })),
      });
    const fetchMock = mockFetch(json({ id: "me" }), page(0, 50, true), page(50, 50, true), page(100, 20, false));
    const playlists = await createSpotifyProvider("tok").listPlaylists();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(url(fetchMock, 1).search).toBe("?limit=50");
    expect(playlists).toHaveLength(120);
    expect(playlists.slice(0, 40).every((p) => p.editable)).toBe(true);
    expect(playlists.slice(40).every((p) => !p.editable)).toBe(true);
    expect(playlists.slice(0, 3).map((p) => p.id)).toEqual(["p0", "p3", "p6"]);
  });

  it("paginates playlist track ids, skipping episodes and local files", async () => {
    const fetchMock = mockFetch(
      json({
        next: "https://api.spotify.com/v1/playlists/pl1/items?offset=50",
        items: [{ item: { id: "a", type: "track" } }, { item: { id: "e", type: "episode" } }],
      }),
      json({
        next: null,
        items: [{ item: { id: null, type: "track" } }, { item: null }, { item: { id: "b", type: "track" } }],
      }),
    );
    expect(await createSpotifyProvider("tok").playlistTrackIds("pl1")).toEqual(["a", "b"]);
    expect(url(fetchMock, 0).pathname).toBe("/v1/playlists/pl1/items");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("spotify connector", () => {
  it("caches the client-credentials token and searches with market=US", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "cid");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    const fetchMock = mockFetch(
      json({ access_token: "app-token", token_type: "Bearer", expires_in: 3600 }),
      json({ tracks: { items: [] } }),
      json({ tracks: { items: [] } }),
    );
    for (let i = 0; i < 2; i++) {
      const access = await connectors.spotify!.anonymous();
      if (!access.ok) throw new Error("expected anonymous access");
      await access.provider.search({ title: "x", mode: "loose" });
      await expect(access.provider.listPlaylists()).rejects.toMatchObject({ kind: "auth" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Basic ${btoa("cid:secret")}` });
    expect(String(fetchMock.mock.calls[0][1]?.body)).toBe("grant_type=client_credentials");
    expect(url(fetchMock, 1).searchParams.get("market")).toBe("US");
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({ Authorization: "Bearer app-token" });
  });

  it("is not configured for anonymous search without app credentials", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "");
    expect(await connectors.spotify!.anonymous()).toEqual({ ok: false, reason: "not-configured" });
  });
});
