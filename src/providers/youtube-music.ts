import { z } from "zod";
import { ProviderError, type CatalogTrack, type ImportOutcome, type Playlist, type Provider } from "@/core/types";
import { getAccessToken, youtubeSessionCookie } from "@/youtube/auth";
import type { Connector } from "./registry";

const API = "https://www.googleapis.com/youtube/v3";
const QUOTA_REASONS = ["quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"];
const VIDEO_TAG =
  /\s*[([]\s*(?:official\s+)?(?:hd\s+|hq\s+|music\s+|lyrics?\s+)?(?:video|audio|lyrics?|visuali[sz]er|hd|hq|4k)\s*[)\]]/gi;

const thumbnails = z.record(z.string(), z.object({ url: z.string() })).optional();
const errorSchema = z.object({
  error: z.object({ message: z.string(), errors: z.array(z.object({ reason: z.string() })).optional() }),
});
const searchSchema = z.object({ items: z.array(z.object({ id: z.object({ videoId: z.string() }) })) });
const videosSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({ title: z.string(), channelTitle: z.string(), publishedAt: z.string(), thumbnails }),
      contentDetails: z.object({ duration: z.string() }),
    }),
  ),
});
const playlistSchema = z.object({
  id: z.string(),
  snippet: z.object({ title: z.string(), thumbnails }),
  contentDetails: z.object({ itemCount: z.number() }).optional(),
});
const playlistsSchema = z.object({ items: z.array(playlistSchema), nextPageToken: z.string().optional() });
const playlistItemsSchema = z.object({
  items: z.array(z.object({ contentDetails: z.object({ videoId: z.string() }) })),
  nextPageToken: z.string().optional(),
});

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/vevo$/, "");

export function parseVideoTitle(title: string, channelTitle: string) {
  const channel = channelTitle.replace(/ - Topic$/, "");
  const name = title.replace(VIDEO_TAG, "").trim();
  const [head, ...rest] = name.split(/\s+[-–—]\s+/);
  return rest.length > 0 && key(head) === key(channel)
    ? { name: rest.join(" - "), artist: head }
    : { name, artist: channel };
}

export function parseDuration(iso: string) {
  const [, d, h, m, s] = (/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso) ?? []).map((n) => Number(n ?? 0));
  if (d === undefined) return 0;
  return (((d * 24 + h) * 60 + m) * 60 + s) * 1000;
}

const imageOf = (t: z.infer<typeof thumbnails>) => (t?.high ?? t?.medium ?? t?.default)?.url;

export function createYouTubeMusicProvider({ accessToken, apiKey }: { accessToken?: string; apiKey?: string }): Provider {
  async function request<T>(schema: z.ZodType<T>, path: string, params: Record<string, string>, body?: unknown) {
    const url = new URL(`${API}/${path}`);
    url.search = new URLSearchParams(accessToken ? params : { ...params, key: apiKey ?? "" }).toString();
    const res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => {
      throw new ProviderError("network", "Could not reach YouTube.");
    });
    const json: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const error = errorSchema.safeParse(json);
      const message = error.success ? error.data.error.message : `YouTube returned ${res.status}`;
      const reasons = error.success ? (error.data.error.errors ?? []).map((e) => e.reason) : [];
      if (res.status === 429 || (res.status === 403 && reasons.some((r) => QUOTA_REASONS.includes(r)))) {
        throw new ProviderError(
          "rate-limited",
          "This app has used up its daily YouTube API quota. It resets at midnight Pacific Time.",
        );
      }
      if (res.status === 401) throw new ProviderError("auth", message);
      if (res.status === 403) throw new ProviderError("forbidden", message);
      if (res.status === 404) throw new ProviderError("not-found", message);
      throw new ProviderError("unknown", message);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ProviderError("unknown", "Unexpected response from YouTube.");
    return parsed.data;
  }

  const requireUser = () => {
    if (!accessToken) throw new ProviderError("auth", "Connect YouTube Music first.");
  };

  return {
    id: "youtube-music",

    async search({ title, artist, mode }) {
      const q = mode === "exact" ? `"${title}"${artist ? ` ${artist}` : ""}` : [title, artist].filter(Boolean).join(" ");
      const found = await request(searchSchema, "search", {
        part: "snippet",
        type: "video",
        videoCategoryId: "10",
        q,
        maxResults: "10",
      });
      const ids = found.items.map((item) => item.id.videoId);
      if (ids.length === 0) return [];

      const videos = await request(videosSchema, "videos", { part: "contentDetails,snippet", id: ids.join(",") });
      const preference = (video: (typeof videos.items)[number]) =>
        (video.snippet.channelTitle.endsWith(" - Topic") ? 0 : 2) +
        (video.snippet.title.toLowerCase().includes(title.toLowerCase()) ? 0 : 1);
      return ids
        .flatMap((id) => videos.items.filter((video) => video.id === id))
        .sort((a, b) => preference(a) - preference(b))
        .map((video): CatalogTrack => {
          const { name, artist: channel } = parseVideoTitle(video.snippet.title, video.snippet.channelTitle);
          return {
            provider: "youtube-music",
            id: video.id,
            uri: video.id,
            url: `https://music.youtube.com/watch?v=${video.id}`,
            name,
            artists: [channel],
            album: {
              name: "",
              releaseDate: video.snippet.publishedAt.slice(0, 10),
              imageUrl: imageOf(video.snippet.thumbnails),
            },
            durationMs: parseDuration(video.contentDetails.duration),
          };
        });
    },

    async listPlaylists() {
      requireUser();
      const playlists: Playlist[] = [];
      let pageToken = "";
      do {
        const page = await request(playlistsSchema, "playlists", {
          part: "snippet,contentDetails",
          mine: "true",
          maxResults: "50",
          ...(pageToken && { pageToken }),
        });
        for (const item of page.items) {
          playlists.push({
            id: item.id,
            name: item.snippet.title,
            trackCount: item.contentDetails?.itemCount ?? 0,
            imageUrl: imageOf(item.snippet.thumbnails),
            editable: true,
          });
        }
        pageToken = page.nextPageToken ?? "";
      } while (pageToken);
      return playlists;
    },

    async playlistTrackIds(playlistId) {
      requireUser();
      const ids: string[] = [];
      let pageToken = "";
      do {
        const page = await request(playlistItemsSchema, "playlistItems", {
          part: "contentDetails",
          playlistId,
          maxResults: "50",
          ...(pageToken && { pageToken }),
        });
        ids.push(...page.items.map((item) => item.contentDetails.videoId));
        pageToken = page.nextPageToken ?? "";
      } while (pageToken);
      return ids;
    },

    async createPlaylist(name) {
      requireUser();
      const created = await request(
        playlistSchema,
        "playlists",
        { part: "snippet,status" },
        { snippet: { title: name }, status: { privacyStatus: "private" } },
      );
      return { id: created.id, name: created.snippet.title, trackCount: 0, editable: true };
    },

    async addTracks(playlistId, trackIds) {
      requireUser();
      const outcomes: ImportOutcome[] = [];
      for (const [index, trackId] of trackIds.entries()) {
        try {
          await request(
            z.unknown(),
            "playlistItems",
            { part: "snippet" },
            { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId: trackId } } },
          );
          outcomes.push({ status: "added", trackId });
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Could not add the song.";
          outcomes.push({ status: "failed", trackId, reason });
          for (const rest of trackIds.slice(index + 1)) {
            outcomes.push({ status: "failed", trackId: rest, reason: "Not attempted after an earlier failure." });
          }
          break;
        }
      }
      return outcomes;
    },
  };
}

const configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const youTubeMusicConnector: Connector = {
  configured,

  async user() {
    if (!configured()) return { ok: false, reason: "not-configured" };
    const access = await getAccessToken();
    if (!access.ok) return { ok: false, reason: access.reason === "not-connected" ? "not-connected" : "expired" };
    return { ok: true, provider: createYouTubeMusicProvider({ accessToken: access.token }) };
  },

  async anonymous() {
    const apiKey = process.env.YOUTUBE_API_KEY;
    return apiKey ? { ok: true, provider: createYouTubeMusicProvider({ apiKey }) } : { ok: false, reason: "not-configured" };
  },

  async status() {
    const session = configured() ? await youtubeSessionCookie.get() : null;
    return session ? { connected: true, user: { displayName: session.user.displayName } } : { connected: false };
  },
};
