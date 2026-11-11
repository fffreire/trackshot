import { z } from "zod";
import { ProviderError, type CatalogTrack, type ImportOutcome, type Playlist, type Provider } from "@/core/types";

const API = "https://api.spotify.com/v1";
const MAX_RETRY_WAIT_SECONDS = 5;

const trackSchema = z.object({
  id: z.string(),
  name: z.string(),
  duration_ms: z.number(),
  is_playable: z.boolean().optional(),
  external_ids: z.object({ isrc: z.string().optional() }).optional(),
  artists: z.array(z.object({ name: z.string() })),
  album: z.object({
    name: z.string(),
    album_type: z.string().optional(),
    release_date: z.string().optional(),
    images: z.array(z.object({ url: z.string() })).optional(),
  }),
});
const searchSchema = z.object({ tracks: z.object({ items: z.array(trackSchema) }) });
const playlistSchema = z.object({
  id: z.string(),
  name: z.string(),
  collaborative: z.boolean(),
  owner: z.object({ id: z.string() }),
  images: z.array(z.object({ url: z.string() })).nullish(),
  items: z.object({ total: z.number() }).nullish(),
});
const playlistPageSchema = z.object({ next: z.string().nullable(), items: z.array(playlistSchema.nullable()) });
const itemPageSchema = z.object({
  next: z.string().nullable(),
  items: z.array(z.object({ item: z.object({ id: z.string().nullable(), type: z.string() }).nullable() })),
});
const meSchema = z.object({ id: z.string() });
const snapshotSchema = z.object({ snapshot_id: z.string() });
const errorSchema = z.object({ error: z.object({ message: z.string().optional(), reason: z.string().optional() }) });

const toTrack = (t: z.infer<typeof trackSchema>): CatalogTrack => ({
  provider: "spotify",
  id: t.id,
  uri: `spotify:track:${t.id}`,
  url: `https://open.spotify.com/track/${t.id}`,
  name: t.name,
  artists: t.artists.map((a) => a.name),
  album: {
    name: t.album.name,
    type: t.album.album_type,
    releaseDate: t.album.release_date,
    imageUrl: t.album.images?.[0]?.url,
  },
  durationMs: t.duration_ms,
  isrc: t.external_ids?.isrc,
  isPlayable: t.is_playable,
});

const toPlaylist = (p: z.infer<typeof playlistSchema>, meId: string): Playlist => ({
  id: p.id,
  name: p.name,
  trackCount: p.items?.total ?? 0,
  imageUrl: p.images?.[0]?.url,
  editable: p.owner.id === meId || p.collaborative,
});

const field = (value: string) => `"${value.replaceAll('"', "")}"`;

export function createSpotifyProvider(token: string, market: string = "from_token"): Provider {
  async function call<T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const res = await fetch(path.startsWith("https://") ? path : API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    }).catch(() => {
      throw new ProviderError("network", "Could not reach Spotify");
    });

    if (res.ok) {
      const parsed = schema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new ProviderError("unknown", "Spotify returned an unexpected response");
      return parsed.data;
    }

    const retryAfter = Number(res.headers.get("Retry-After")) || undefined;
    const wait = retryAfter ?? attempt + 1;
    const retryable = (res.status === 429 || res.status >= 500) && (init.method ?? "GET") === "GET";
    if (retryable && attempt < 2 && wait <= MAX_RETRY_WAIT_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return call(schema, path, init, attempt + 1);
    }

    const error = errorSchema.safeParse(await res.json().catch(() => null));
    const detail = error.success ? (error.data.error.reason ?? error.data.error.message) : undefined;
    const message = `Spotify responded ${res.status}${detail ? ` (${detail})` : ""}`;
    if (res.status === 401) throw new ProviderError("auth", message);
    if (res.status === 403) throw new ProviderError("forbidden", message);
    if (res.status === 404) throw new ProviderError("not-found", message);
    if (res.status === 429) throw new ProviderError("rate-limited", message, retryAfter);
    throw new ProviderError("unknown", message);
  }

  const search = async (q: string) => {
    const params = new URLSearchParams({ q, type: "track", limit: "10", market });
    return (await call(searchSchema, `/search?${params}`)).tracks.items.map(toTrack);
  };

  return {
    id: "spotify",
    search: ({ title, artist, mode }) =>
      search(
        mode === "exact"
          ? `track:${field(title)}${artist ? ` artist:${field(artist)}` : ""}`
          : `${title} ${artist ?? ""}`.trim(),
      ),
    findByIsrc: (isrc) => search(`isrc:${isrc}`),

    async listPlaylists() {
      const me = await call(meSchema, "/me");
      const playlists: Playlist[] = [];
      for (let url: string | null = "/me/playlists?limit=50"; url;) {
        const page: z.infer<typeof playlistPageSchema> = await call(playlistPageSchema, url);
        playlists.push(...page.items.flatMap((p) => (p ? [toPlaylist(p, me.id)] : [])));
        url = page.next;
      }
      return playlists.sort((a, b) => Number(b.editable) - Number(a.editable));
    },

    async playlistTrackIds(playlistId) {
      const ids: string[] = [];
      for (
        let url: string | null = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`;
        url;
      ) {
        const page: z.infer<typeof itemPageSchema> = await call(itemPageSchema, url);
        ids.push(...page.items.flatMap(({ item }) => (item?.type === "track" && item.id ? [item.id] : [])));
        url = page.next;
      }
      return ids;
    },

    async createPlaylist(name) {
      const me = await call(meSchema, "/me");
      const created = await call(playlistSchema, "/me/playlists", {
        method: "POST",
        body: JSON.stringify({ name, public: false }),
      });
      return toPlaylist(created, me.id);
    },

    async addTracks(playlistId, trackIds) {
      const outcomes: ImportOutcome[] = [];
      for (let i = 0; i < trackIds.length; i += 100) {
        const chunk = trackIds.slice(i, i + 100);
        try {
          await call(snapshotSchema, `/playlists/${encodeURIComponent(playlistId)}/items`, {
            method: "POST",
            body: JSON.stringify({ uris: chunk.map((id) => `spotify:track:${id}`) }),
          });
          outcomes.push(...chunk.map((trackId) => ({ status: "added" as const, trackId })));
        } catch (error) {
          const reason = error instanceof ProviderError ? error.message : "Unknown error";
          return [...outcomes, ...trackIds.slice(i).map((trackId) => ({ status: "failed" as const, trackId, reason }))];
        }
      }
      return outcomes;
    },
  };
}
