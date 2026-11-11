import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/core/types";
import { DELETE as disconnect, POST as connect } from "@/app/api/auth/apple-music/route";
import { GET as tokenRoute } from "@/app/api/auth/apple-music/token/route";
import { appleCookie, appleDeveloperToken, appleMusicConnector, createAppleMusicProvider } from "./apple-music";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));

vi.mock("next/server", async (original) => ({ ...(await original<object>()), connection: async () => {} }));

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
const song = (id: string, isrc = `ISRC${id}`) => ({
  id,
  type: "songs",
  attributes: {
    name: `Song ${id}`,
    artistName: "Paramore",
    albumName: "Riot!",
    url: `https://music.apple.com/us/album/riot/1?i=${id}`,
    durationInMillis: 211_000,
    isrc,
    releaseDate: "2007-06-12",
    artwork: { url: "https://is1-ssl.mzstatic.com/image/thumb/a/{w}x{h}bb.jpg", width: 3000, height: 3000 },
    playParams: { id, kind: "song" },
  },
});
const playlist = (id: string, canEdit: boolean) => ({
  id,
  type: "library-playlists",
  attributes: { name: id, canEdit },
});

let publicKey: CryptoKey;
let pem: string;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const provider = () => createAppleMusicProvider({ developerToken: "dev", userToken: "user", storefront: "gb" });
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init }));

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  publicKey = pair.publicKey;
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  pem = `-----BEGIN PRIVATE KEY-----\\n${pkcs8.match(/.{1,64}/g)?.join("\\n")}\\n-----END PRIVATE KEY-----`;
});

beforeEach(() => {
  jar.clear();
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
  vi.stubEnv("APPLE_KEY_ID", "KEY1234567");
  vi.stubEnv("APPLE_PRIVATE_KEY", pem);
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("appleDeveloperToken", () => {
  it("signs an ES256 JWT with kid, iss, iat and exp within 6 months, and caches it", async () => {
    const token = await appleDeveloperToken();
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    const { iss, iat, exp } = JSON.parse(Buffer.from(claims, "base64url").toString());
    expect(iss).toBe("TEAM123456");
    expect(Math.abs(iat - Date.now() / 1000)).toBeLessThan(5);
    expect(exp - iat).toBeGreaterThan(0);
    expect(exp - iat).toBeLessThanOrEqual(15_777_000);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
    expect(await appleDeveloperToken()).toBe(token);
  });
});

describe("Apple Music provider", () => {
  it("maps catalog songs and sends exact and loose term searches", async () => {
    fetchMock.mockImplementation(async () => json({ results: { songs: { data: [song("1")] } } }));
    const [track] = await provider().search({ title: "Misery Business", artist: "Paramore", mode: "exact" });
    expect(track).toEqual({
      provider: "apple-music",
      id: "1",
      uri: "1",
      url: "https://music.apple.com/us/album/riot/1?i=1",
      name: "Song 1",
      artists: ["Paramore"],
      album: {
        name: "Riot!",
        releaseDate: "2007-06-12",
        imageUrl: "https://is1-ssl.mzstatic.com/image/thumb/a/300x300bb.jpg",
      },
      durationMs: 211_000,
      isrc: "ISRC1",
      isPlayable: true,
    });
    await provider().search({ title: "Misery Business", artist: "Paramore", mode: "loose" });
    const [exact, loose] = calls().map(({ url }) => new URL(url));
    expect(exact.pathname).toBe("/v1/catalog/gb/search");
    expect(Object.fromEntries(exact.searchParams)).toEqual({
      types: "songs",
      term: "Misery Business Paramore",
      limit: "10",
    });
    expect(loose.searchParams.get("term")).toBe("Misery Business");
    expect(calls()[0].init?.headers).toEqual({ Authorization: "Bearer dev", "Music-User-Token": "user" });
  });

  it("returns no tracks when the search has no songs", async () => {
    fetchMock.mockResolvedValue(json({ results: {} }));
    expect(await provider().search({ title: "zzz", mode: "loose" })).toEqual([]);
  });

  it("looks songs up by ISRC", async () => {
    fetchMock.mockResolvedValue(json({ data: [song("7", "USAT20700001")] }));
    const tracks = await provider().findByIsrc?.("USAT20700001");
    expect(tracks?.map((t) => t.isrc)).toEqual(["USAT20700001"]);
    expect(calls()[0].url).toBe("https://api.music.apple.com/v1/catalog/gb/songs?filter[isrc]=USAT20700001");
  });

  it("lists every library playlist across pages, editable first", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ data: [playlist("a", false), playlist("b", true)], next: "/v1/me/library/playlists?offset=100" }),
      )
      .mockResolvedValueOnce(json({ data: [playlist("c", false), playlist("d", true)] }));
    const playlists = await provider().listPlaylists();
    expect(playlists.map((p) => [p.id, p.editable])).toEqual([
      ["b", true],
      ["d", true],
      ["a", false],
      ["c", false],
    ]);
    expect(calls().map((c) => c.url)).toEqual([
      "https://api.music.apple.com/v1/me/library/playlists?limit=100",
      "https://api.music.apple.com/v1/me/library/playlists?offset=100",
    ]);
  });

  it("reads catalog ids of playlist tracks and treats an empty playlist (404) as no tracks", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { id: "i.1", attributes: { playParams: { catalogId: "11" } } },
          { id: "i.2", attributes: {} },
        ],
      }),
    );
    expect(await provider().playlistTrackIds("p.1")).toEqual(["11"]);
    fetchMock.mockResolvedValueOnce(json({ errors: [{ status: "404", title: "Not Found" }] }, 404));
    expect(await provider().playlistTrackIds("p.1")).toEqual([]);
  });

  it("creates a playlist", async () => {
    fetchMock.mockResolvedValue(json({ data: [playlist("p.new", true)] }, 201));
    expect(await provider().createPlaylist("Pop punk")).toEqual({
      id: "p.new",
      name: "p.new",
      editable: true,
    });
    expect(JSON.parse(String(calls()[0].init?.body))).toEqual({ attributes: { name: "Pop punk" } });
  });

  it("adds catalog songs in ordered batches of 100", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    const outcomes = await provider().addTracks("p.1", ids);
    expect(outcomes).toEqual(ids.map((trackId) => ({ status: "added", trackId })));
    const bodies = calls().map((c) => JSON.parse(String(c.init?.body)).data as { id: string; type: string }[]);
    expect(bodies.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(bodies.flat().map((d) => d.id)).toEqual(ids);
    expect(bodies[0][0]).toEqual({ id: "0", type: "songs" });
    expect(calls()[0].url).toBe("https://api.music.apple.com/v1/me/library/playlists/p.1/tracks");
  });

  it("marks the failed batch and the rest as failed without retrying", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ errors: [{ detail: "Unable to update tracks" }] }, 500));
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    const outcomes = await provider().addTracks("p.1", ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcomes.slice(0, 100).every((o) => o.status === "added")).toBe(true);
    expect(outcomes.slice(100)).toEqual(
      ids.slice(100).map((trackId) => ({ status: "failed", trackId, reason: "Unable to update tracks" })),
    );
  });

  it("maps 429 to rate-limited with Retry-After", async () => {
    fetchMock.mockResolvedValue(json({ errors: [{ title: "Too Many Requests" }] }, 429, { "Retry-After": "12" }));
    const error = await provider()
      .search({ title: "x", mode: "loose" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "rate-limited", retryAfterSeconds: 12, message: "Too Many Requests" });
    await expect(provider().addTracks("p.1", ["1"])).rejects.toMatchObject({ kind: "rate-limited" });
  });

  it("refuses library calls without a user token", async () => {
    const anonymous = createAppleMusicProvider({ developerToken: "dev", storefront: "us" });
    await expect(anonymous.listPlaylists()).rejects.toMatchObject({ kind: "auth" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Apple Music connector and routes", () => {
  const request = (method: string, origin: string, body?: unknown) =>
    new Request("http://127.0.0.1:3000/api/auth/apple-music", {
      method,
      headers: { origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("is not configured without env", async () => {
    vi.stubEnv("APPLE_PRIVATE_KEY", "");
    expect(appleMusicConnector.configured()).toBe(false);
    expect(await appleMusicConnector.anonymous()).toEqual({ ok: false, reason: "not-configured" });
    expect((await tokenRoute()).status).toBe(501);
  });

  it("serves the developer token when configured and searches anonymously in the us storefront", async () => {
    expect(await (await tokenRoute()).json()).toEqual({ developerToken: await appleDeveloperToken() });
    const access = await appleMusicConnector.anonymous();
    if (!access.ok) throw new Error("expected access");
    fetchMock.mockResolvedValue(json({ results: {} }));
    await access.provider.search({ title: "x", mode: "loose" });
    expect(calls()[0].url).toContain("/v1/catalog/us/search");
    expect(calls()[0].init?.headers).not.toHaveProperty("Music-User-Token");
  });

  it("connects with a user token, stores storefront in ts_apple, and disconnects", async () => {
    expect(await appleMusicConnector.user()).toEqual({ ok: false, reason: "not-connected" });
    expect((await connect(request("POST", "https://evil.example", { userToken: "mut" }))).status).toBe(403);
    expect((await connect(request("POST", "http://127.0.0.1:3000", {}))).status).toBe(400);

    fetchMock.mockResolvedValueOnce(json({ data: [{ id: "br", type: "storefronts" }] }));
    expect((await connect(request("POST", "http://127.0.0.1:3000", { userToken: "mut" }))).status).toBe(204);
    expect(calls()[0].url).toBe("https://api.music.apple.com/v1/me/storefront");
    expect(jar.get("ts_apple")).not.toContain("mut");
    expect(await appleCookie.get()).toEqual({ userToken: "mut", storefront: "br" });
    expect(await appleMusicConnector.status()).toEqual({ connected: true });

    const access = await appleMusicConnector.user();
    if (!access.ok) throw new Error("expected access");
    fetchMock.mockResolvedValueOnce(json({ results: {} }));
    await access.provider.search({ title: "x", mode: "loose" });
    expect(calls()[1].url).toContain("/v1/catalog/br/search");
    expect(calls()[1].init?.headers).toMatchObject({ "Music-User-Token": "mut" });

    expect((await disconnect(request("DELETE", "https://evil.example"))).status).toBe(403);
    expect((await disconnect(request("DELETE", "http://127.0.0.1:3000"))).status).toBe(204);
    expect(await appleMusicConnector.status()).toEqual({ connected: false });
  });

  it("rejects an invalid user token with 401", async () => {
    fetchMock.mockResolvedValueOnce(json({ errors: [{ title: "Unauthorized" }] }, 401));
    const res = await connect(request("POST", "http://127.0.0.1:3000", { userToken: "bad" }));
    expect(res.status).toBe(401);
    expect(jar.has("ts_apple")).toBe(false);
  });
});
