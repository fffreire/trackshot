import { z } from "zod";
import { fakeSearch } from "@/core/fixtures/spotify-search";
import { ProviderError, type Provider, type ProviderErrorKind, type ProviderId } from "@/core/types";
import { getAccessToken } from "@/spotify/auth";
import { sessionCookie } from "@/spotify/session";
import { appleMusicConnector } from "./apple-music";
import { createSpotifyProvider } from "./spotify";

export type ProviderAccess =
  { ok: true; provider: Provider } | { ok: false; reason: "not-connected" | "expired" | "not-configured" };

export interface Connector {
  configured(): boolean;
  user(): Promise<ProviderAccess>;
  anonymous(): Promise<ProviderAccess>;
  status(): Promise<{ connected: boolean; user?: { displayName: string } }>;
}

const searchOnly = (provider: Provider): Provider => {
  const denied = async () => {
    throw new ProviderError("auth", "Connect your account to use playlists");
  };
  return { ...provider, listPlaylists: denied, playlistTrackIds: denied, createPlaylist: denied, addTracks: denied };
};

const sessionStatus = async () => {
  const session = await sessionCookie.get();
  return session ? { connected: true, user: { displayName: session.user.displayName } } : { connected: false };
};

const appTokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });
let spotifyAppToken: { token: string; expiresAt: number } | undefined;

const spotifyConnector: Connector = {
  // Users can always bring their own Client ID, so login is available even without one configured.
  configured: () => true,
  async user() {
    const access = await getAccessToken();
    if (access.ok) return { ok: true, provider: createSpotifyProvider(access.token) };
    return { ok: false, reason: access.reason === "not-connected" ? "not-connected" : "expired" };
  },
  async anonymous() {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !secret) return { ok: false, reason: "not-configured" };
    if (!spotifyAppToken || spotifyAppToken.expiresAt - Date.now() < 60_000) {
      const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
      }).catch(() => {
        throw new ProviderError("network", "Could not reach Spotify");
      });
      const parsed = appTokenSchema.safeParse(res.ok ? await res.json().catch(() => null) : null);
      if (!parsed.success) throw new ProviderError("unknown", `Spotify app token request failed (${res.status})`);
      spotifyAppToken = { token: parsed.data.access_token, expiresAt: Date.now() + parsed.data.expires_in * 1000 };
    }
    return { ok: true, provider: searchOnly(createSpotifyProvider(spotifyAppToken.token, "US")) };
  },
  status: sessionStatus,
};

function mockConnector(id: ProviderId): Connector {
  const playlists = [
    { id: "mock-editable", name: "Pop Punk 2007", editable: true, trackIds: ["fob-mmrs"] },
    { id: "mock-followed", name: "Followed Playlist", editable: false, trackIds: ["pmr-misery"] },
    ...[
      "Road Trip",
      "Gym",
      "Chill Evenings",
      "Focus",
      "Throwbacks",
      "Summer 2026",
      "Rainy Day",
      "Party",
      "Running",
      "Sunday Morning",
      "Indie Finds",
      "Late Night Drive",
      "Workout Mix",
      "Study Beats",
      "Emo Revival",
      "Acoustic",
      "Dinner Party",
      "Wedding Ideas",
      "90s Hits",
      "Coffee Shop",
      "Feel Good",
      "Discover Weekly",
      "Top 50 Global",
    ].map((name, i) => ({ id: `mock-${i + 3}`, name, editable: i < 20, trackIds: [] as string[] })),
  ].sort((a, b) => Number(b.editable) - Number(a.editable));
  const find = (playlistId: string) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) throw new ProviderError("not-found", "Playlist not found");
    return playlist;
  };
  const toPlaylist = ({ trackIds, ...p }: (typeof playlists)[number]) => ({ ...p, trackCount: trackIds.length });
  const provider: Provider = {
    id,
    search: async (query) => (await fakeSearch(query)).map((track) => ({ ...track, provider: id })),
    listPlaylists: async () => playlists.map(toPlaylist),
    playlistTrackIds: async (playlistId) => find(playlistId).trackIds,
    async createPlaylist(name) {
      const playlist = { id: `mock-${playlists.length + 1}`, name, editable: true, trackIds: [] };
      playlists.unshift(playlist);
      return toPlaylist(playlist);
    },
    async addTracks(playlistId, trackIds) {
      const playlist = find(playlistId);
      if (!playlist.editable) throw new ProviderError("forbidden", "You can't edit this playlist");
      playlist.trackIds.push(...trackIds);
      return trackIds.map((trackId) => ({ status: "added", trackId }));
    },
  };
  return {
    configured: () => true,
    user: async () => ((await sessionCookie.get()) ? { ok: true, provider } : { ok: false, reason: "not-connected" }),
    anonymous: async () => ({ ok: true, provider: searchOnly(provider) }),
    status: sessionStatus,
  };
}

export const connectors: Partial<Record<ProviderId, Connector>> =
  process.env.MOCK_PROVIDERS === "1"
    ? {
        spotify: mockConnector("spotify"),
        "apple-music": mockConnector("apple-music"),
        "youtube-music": mockConnector("youtube-music"),
      }
    : { spotify: spotifyConnector, "apple-music": appleMusicConnector };

type ErrorKind = ProviderErrorKind | "not-connected" | "not-configured" | "invalid-request" | "duplicate-request";
const httpStatus: Record<ErrorKind, number> = {
  auth: 401,
  "not-connected": 401,
  forbidden: 403,
  "not-found": 404,
  "duplicate-request": 409,
  "rate-limited": 429,
  "invalid-request": 400,
  "not-configured": 501,
  network: 502,
  unknown: 502,
};

export const errorResponse = (kind: ErrorKind, message: string, retryAfterSeconds?: number) =>
  Response.json({ error: { kind, message, retryAfterSeconds } }, { status: httpStatus[kind] });

export async function handle(
  params: Promise<{ provider: string }>,
  access: (connector: Connector) => Promise<ProviderAccess>,
  action: (provider: Provider, id: ProviderId) => Promise<Response>,
): Promise<Response> {
  const { provider: id } = await params;
  const connector = Object.hasOwn(connectors, id) ? connectors[id as ProviderId] : undefined;
  if (!connector) return errorResponse("not-found", `Unknown provider: ${id}`);
  if (!connector.configured()) return errorResponse("not-configured", `${id} is not configured on this server`);
  try {
    const granted = await access(connector);
    if (granted.ok) return await action(granted.provider, id as ProviderId);
    if (granted.reason === "not-configured")
      return errorResponse("not-configured", `${id} is not configured on this server`);
    if (granted.reason === "expired") return errorResponse("auth", "Your session expired, please reconnect");
    return errorResponse("not-connected", `Connect ${id} first`);
  } catch (error) {
    if (error instanceof ProviderError) return errorResponse(error.kind, error.message, error.retryAfterSeconds);
    throw error;
  }
}
