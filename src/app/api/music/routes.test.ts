import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorResponse } from "@/providers/registry";
import { sessionCookie } from "@/spotify/session";
import { GET as searchRoute } from "./[provider]/search/route";
import { GET as listPlaylists, POST as createPlaylist } from "./[provider]/playlists/route";
import { POST as addTracks } from "./[provider]/playlists/[id]/tracks/route";
import { GET as statusRoute } from "./status/route";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const search = (provider: string, query: string, ip = "1.1.1.1") =>
  searchRoute(
    new NextRequest(`http://127.0.0.1:3000/api/music/${provider}/search?${query}`, {
      headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
    }),
    ctx({ provider }),
  );
const post = (body: unknown) =>
  new NextRequest("http://127.0.0.1:3000/api", { method: "POST", body: JSON.stringify(body) });
const connect = () =>
  sessionCookie.set({
    clientId: "cid",
    accessToken: "user-token",
    refreshToken: "rt",
    expiresAt: Date.now() + 3600_000,
    user: { id: "me", displayName: "Fer" },
  });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  jar.clear();
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("SPOTIFY_CLIENT_ID", "cid");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.startsWith("https://accounts.spotify.com/api/token"))
      return json({ access_token: "app", expires_in: 3600 });
    if (url.includes("/v1/search")) return json({ tracks: { items: [] } });
    if (url.includes("/items")) return json({ snapshot_id: "s" }, 201);
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("music routes", () => {
  it("validates input and rejects unknown providers", async () => {
    expect((await search("spotify", "mode=exact")).status).toBe(400);
    expect((await search("spotify", "title=x&mode=fuzzy")).status).toBe(400);
    expect((await search("deezer", "title=x")).status).toBe(404);
    expect((await createPlaylist(post({ name: " " }), ctx({ provider: "spotify" }))).status).toBe(400);
    expect((await addTracks(post({ trackIds: [] }), ctx({ provider: "spotify", id: "pl1" }))).status).toBe(400);
  });

  it("requires a connected account for playlists", async () => {
    const res = await listPlaylists(new Request("http://127.0.0.1:3000/api"), ctx({ provider: "spotify" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { kind: "not-connected", message: "Connect spotify first" } });
  });

  it("searches with the user's token when connected", async () => {
    await connect();
    expect((await search("spotify", "title=Misery%20Business&artist=Paramore&mode=exact")).status).toBe(200);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer user-token" });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("market")).toBe("from_token");
  });

  it("rate limits anonymous search per IP", async () => {
    for (let i = 0; i < 30; i++) expect((await search("spotify", "title=x", "9.9.9.9")).status).toBe(200);
    const limited = await search("spotify", "title=x", "9.9.9.9");
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toMatchObject({ kind: "rate-limited", retryAfterSeconds: 600 });
    expect((await search("spotify", "title=x", "8.8.8.8")).status).toBe(200);
  });

  it("returns 401 for anonymous search without app credentials", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "");
    expect((await search("spotify", "title=x", "7.7.7.7")).status).toBe(401);
  });

  it("rejects a repeated requestId with 409 without calling Spotify again", async () => {
    await connect();
    const body = { trackIds: ["a", "b"], requestId: "req-12345678" };
    const first = await addTracks(post(body), ctx({ provider: "spotify", id: "pl1" }));
    expect(await first.json()).toEqual({
      outcomes: [
        { status: "added", trackId: "a" },
        { status: "added", trackId: "b" },
      ],
    });
    const again = await addTracks(post(body), ctx({ provider: "spotify", id: "pl1" }));
    expect(again.status).toBe(409);
    expect((await again.json()).error.kind).toBe("duplicate-request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps provider errors to HTTP statuses", async () => {
    await connect();
    for (const [status, kind, http] of [
      [401, "auth", 401],
      [403, "forbidden", 403],
      [404, "not-found", 404],
      [429, "rate-limited", 429],
      [400, "unknown", 502],
    ] as const) {
      fetchMock.mockResolvedValueOnce(json({}, status, { "Retry-After": "60" }));
      const res = await listPlaylists(new Request("http://127.0.0.1:3000/api"), ctx({ provider: "spotify" }));
      expect([res.status, (await res.json()).error.kind]).toEqual([http, kind]);
    }
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect((await listPlaylists(new Request("http://127.0.0.1:3000/api"), ctx({ provider: "spotify" }))).status).toBe(
      502,
    );

    expect(
      Object.fromEntries(
        (["not-connected", "invalid-request", "not-configured", "duplicate-request", "network"] as const).map(
          (kind) => [kind, errorResponse(kind, "x").status],
        ),
      ),
    ).toEqual({
      "not-connected": 401,
      "invalid-request": 400,
      "not-configured": 501,
      "duplicate-request": 409,
      network: 502,
    });
  });

  it("reports provider status without tokens", async () => {
    await connect();
    expect(await (await statusRoute()).json()).toEqual({
      providers: [
        { id: "spotify", configured: true, anonymousSearch: true, connected: true, user: { displayName: "Fer" } },
      ],
    });
  });
});

describe("MOCK_PROVIDERS", () => {
  it("serves an in-memory library for every provider without network", async () => {
    vi.resetModules();
    vi.stubEnv("MOCK_PROVIDERS", "1");
    const { connectors } = await import("@/providers/registry");
    expect(Object.keys(connectors)).toEqual(["spotify", "apple-music", "youtube-music"]);
    await connect();
    const access = await connectors["apple-music"]!.user();
    if (!access.ok) throw new Error("expected access");
    const playlists = await access.provider.listPlaylists();
    expect(playlists.length).toBeGreaterThanOrEqual(25);
    expect(playlists.findIndex((p) => !p.editable)).toBeGreaterThan(playlists.findLastIndex((p) => p.editable));
    expect(await access.provider.playlistTrackIds("mock-editable")).toEqual(["fob-mmrs"]);
    await expect(access.provider.addTracks("mock-followed", ["x"])).rejects.toMatchObject({ kind: "forbidden" });
    const [track] = await access.provider.search({ title: "Misery Business", mode: "exact" });
    expect(track.provider).toBe("apple-music");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
