export type ProviderId = "spotify" | "apple-music" | "youtube-music";

export interface ExtractedTrack {
  id: string;
  title: string;
  artist?: string;
  originalText: string;
  position: number;
}

export interface CatalogTrack {
  provider: ProviderId;
  id: string;
  uri: string;
  url: string;
  name: string;
  artists: string[];
  album: { name: string; releaseDate?: string; imageUrl?: string; type?: string };
  durationMs: number;
  isrc?: string;
  isPlayable?: boolean;
}

export interface ScoredCandidate {
  track: CatalogTrack;
  score: number;
  reasons: string[];
}

export type TrackMatch =
  | { original: ExtractedTrack; status: "high"; best: ScoredCandidate; candidates: ScoredCandidate[] }
  | { original: ExtractedTrack; status: "ambiguous"; candidates: ScoredCandidate[] }
  | { original: ExtractedTrack; status: "unmatched"; candidates: []; error?: string };

export interface Playlist {
  id: string;
  name: string;
  trackCount?: number;
  imageUrl?: string;
  editable: boolean;
}

export type ImportOutcome =
  | { status: "added"; trackId: string }
  | { status: "skipped-duplicate"; trackId: string }
  | { status: "failed"; trackId: string; reason: string };

export interface SearchQuery {
  title: string;
  artist?: string;
  mode: "exact" | "loose";
}

export interface Provider {
  id: ProviderId;
  search(query: SearchQuery): Promise<CatalogTrack[]>;
  findByIsrc?(isrc: string): Promise<CatalogTrack[]>;
  listPlaylists(): Promise<Playlist[]>;
  playlistTrackIds(playlistId: string): Promise<string[]>;
  createPlaylist(name: string): Promise<Playlist>;
  addTracks(playlistId: string, trackIds: string[]): Promise<ImportOutcome[]>;
}

export type ProviderErrorKind = "auth" | "forbidden" | "rate-limited" | "not-found" | "network" | "unknown";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
