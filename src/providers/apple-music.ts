import { z } from "zod";
import {
  ProviderError,
  type CatalogTrack,
  type ImportOutcome,
  type Playlist,
  type Provider,
  type ProviderErrorKind,
} from "@/core/types";
import { cookie } from "@/spotify/session";
import type { Connector } from "./registry";

const API = "https://api.music.apple.com";
const BATCH_SIZE = 100;
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const artworkSchema = z.object({ url: z.string() }).optional();
const songSchema = z.object({
  id: z.string(),
  attributes: z.object({
    name: z.string(),
    artistName: z.string(),
    albumName: z.string().default(""),
    url: z.string(),
    durationInMillis: z.number().default(0),
    isrc: z.string().optional(),
    releaseDate: z.string().optional(),
    artwork: artworkSchema,
    playParams: z.object({}).optional(),
  }),
});
const playlistSchema = z.object({
  id: z.string(),
  attributes: z.object({ name: z.string(), canEdit: z.boolean().default(false), artwork: artworkSchema }),
});
const libraryTrackSchema = z.object({
  attributes: z.object({ playParams: z.object({ catalogId: z.string().optional() }).optional() }).optional(),
});
const page = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), next: z.string().optional() });
const errorSchema = z.object({
  errors: z.array(z.object({ title: z.string().optional(), detail: z.string().optional() })),
});

export const appleCookie = cookie(
  "ts_apple",
  z.object({ userToken: z.string(), storefront: z.string() }),
  180 * 24 * 60 * 60,
);

let cachedToken: { token: string; expiresAt: number } | undefined;

export async function appleDeveloperToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - now > 24 * 60 * 60) return cachedToken.token;
  const { APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = process.env;
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    throw new Error("APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY must be set");
  }
  const der = Buffer.from(APPLE_PRIVATE_KEY.replace(/\\n/g, "\n").replace(/-----[^-]+-----|\s/g, ""), "base64");
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const input = `${encode({ alg: "ES256", kid: APPLE_KEY_ID })}.${encode({ iss: APPLE_TEAM_ID, iat: now, exp: expiresAt })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  cachedToken = { token: `${input}.${Buffer.from(signature).toString("base64url")}`, expiresAt };
  return cachedToken.token;
}

type Tokens = { developerToken: string; userToken?: string };

async function appleFetch<T>(
  { developerToken, userToken }: Tokens,
  path: string,
  schema: z.ZodType<T> | null,
  init?: RequestInit,
) {
  if (path.startsWith("/v1/me") && !userToken) throw new ProviderError("auth", "Connect Apple Music first");
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${developerToken}`,
        ...(userToken && { "Music-User-Token": userToken }),
        ...(init?.body && { "Content-Type": "application/json" }),
      },
    });
  } catch {
    throw new ProviderError("network", "Could not reach Apple Music");
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const error = errorSchema.safeParse(body).data?.errors[0];
    const message = error?.detail || error?.title || `Apple Music returned ${res.status}`;
    if (res.status === 429)
      throw new ProviderError("rate-limited", message, Number(res.headers.get("retry-after")) || undefined);
    const kinds: Record<number, ProviderErrorKind> = { 401: "auth", 403: "forbidden", 404: "not-found" };
    throw new ProviderError(kinds[res.status] ?? "unknown", message);
  }
  if (!schema) return null as T;
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ProviderError("unknown", "Unexpected response from Apple Music");
  return parsed.data;
}

async function allPages<T>(tokens: Tokens, path: string, item: z.ZodType<T>) {
  const items: T[] = [];
  for (let next: string | undefined = path; next;) {
    const result: { data: T[]; next?: string } = await appleFetch(tokens, next, page(item));
    items.push(...result.data);
    next = result.next;
  }
  return items;
}

export async function appleStorefront(userToken: string) {
  const result = await appleFetch(
    { developerToken: await appleDeveloperToken(), userToken },
    "/v1/me/storefront",
    z.object({ data: z.array(z.object({ id: z.string() })).min(1) }),
  );
  return result.data[0].id;
}

const artworkUrl = (artwork?: { url: string }) => artwork?.url.replace("{w}x{h}", "300x300");

const toTrack = ({ id, attributes: a }: z.infer<typeof songSchema>): CatalogTrack => ({
  provider: "apple-music",
  id,
  uri: id,
  url: a.url,
  name: a.name,
  artists: [...new Set([a.artistName, ...a.artistName.split(/ & |, /)])],
  album: { name: a.albumName, releaseDate: a.releaseDate, imageUrl: artworkUrl(a.artwork) },
  durationMs: a.durationInMillis,
  isrc: a.isrc,
  isPlayable: a.playParams !== undefined,
});

const toPlaylist = ({ id, attributes: a }: z.infer<typeof playlistSchema>): Playlist => ({
  id,
  name: a.name,
  imageUrl: artworkUrl(a.artwork),
  editable: a.canEdit,
});

export function createAppleMusicProvider({
  developerToken,
  userToken,
  storefront,
}: Tokens & { storefront: string }): Provider {
  const tokens = { developerToken, userToken };
  const catalog = `/v1/catalog/${encodeURIComponent(storefront)}`;
  const tracksPath = (playlistId: string) => `/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks`;

  return {
    id: "apple-music",
    async search({ title, artist, mode }) {
      const term = mode === "exact" && artist ? `${title} ${artist}` : title;
      const params = new URLSearchParams({ types: "songs", term, limit: "10" });
      const result = await appleFetch(
        tokens,
        `${catalog}/search?${params}`,
        z.object({ results: z.object({ songs: page(songSchema).optional() }) }),
      );
      return (result.results.songs?.data ?? []).map(toTrack);
    },
    async findByIsrc(isrc) {
      const result = await appleFetch(
        tokens,
        `${catalog}/songs?filter[isrc]=${encodeURIComponent(isrc)}`,
        page(songSchema),
      );
      return result.data.map(toTrack);
    },
    async listPlaylists() {
      const playlists = await allPages(tokens, "/v1/me/library/playlists?limit=100", playlistSchema);
      return playlists.map(toPlaylist).sort((a, b) => Number(b.editable) - Number(a.editable));
    },
    async playlistTrackIds(playlistId) {
      try {
        const tracks = await allPages(tokens, `${tracksPath(playlistId)}?limit=100`, libraryTrackSchema);
        return tracks.flatMap((t) => t.attributes?.playParams?.catalogId ?? []);
      } catch (error) {
        if (error instanceof ProviderError && error.kind === "not-found") return [];
        throw error;
      }
    },
    async createPlaylist(name) {
      const result = await appleFetch(
        tokens,
        "/v1/me/library/playlists",
        z.object({ data: z.array(playlistSchema).min(1) }),
        {
          method: "POST",
          body: JSON.stringify({ attributes: { name } }),
        },
      );
      return toPlaylist(result.data[0]);
    },
    async addTracks(playlistId, trackIds) {
      const outcomes: ImportOutcome[] = [];
      for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
        const batch = trackIds.slice(i, i + BATCH_SIZE);
        try {
          await appleFetch(tokens, tracksPath(playlistId), null, {
            method: "POST",
            body: JSON.stringify({ data: batch.map((id) => ({ id, type: "songs" })) }),
          });
        } catch (error) {
          if (i === 0) throw error;
          const reason = error instanceof ProviderError ? error.message : "Unknown error";
          return [...outcomes, ...trackIds.slice(i).map((trackId) => ({ status: "failed" as const, trackId, reason }))];
        }
        outcomes.push(...batch.map((trackId) => ({ status: "added" as const, trackId })));
      }
      return outcomes;
    },
  };
}

export const appleMusicConnector: Connector = {
  configured: () => Boolean(process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
  async anonymous() {
    if (!appleMusicConnector.configured()) return { ok: false, reason: "not-configured" };
    return {
      ok: true,
      provider: createAppleMusicProvider({ developerToken: await appleDeveloperToken(), storefront: "us" }),
    };
  },
  async user() {
    if (!appleMusicConnector.configured()) return { ok: false, reason: "not-configured" };
    const session = await appleCookie.get();
    if (!session) return { ok: false, reason: "not-connected" };
    return {
      ok: true,
      provider: createAppleMusicProvider({ developerToken: await appleDeveloperToken(), ...session }),
    };
  },
  status: async () => ({ connected: (await appleCookie.get()) !== null }),
};
