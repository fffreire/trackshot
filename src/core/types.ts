export interface ExtractedTrack {
  id: string;
  title: string;
  artist?: string;
  originalText: string;
  position: number;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: { name: string; releaseDate?: string; imageUrl?: string; type?: string };
  durationMs: number;
  isPlayable?: boolean;
}

export interface ScoredCandidate {
  track: SpotifyTrack;
  score: number;
  reasons: string[];
}

export type TrackMatch =
  | { original: ExtractedTrack; status: "high"; best: ScoredCandidate; candidates: ScoredCandidate[] }
  | { original: ExtractedTrack; status: "ambiguous"; candidates: ScoredCandidate[] }
  | { original: ExtractedTrack; status: "unmatched"; candidates: [] };

export interface Playlist {
  id: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
  editable: boolean;
}

export type ImportOutcome =
  | { status: "added"; uri: string }
  | { status: "skipped-duplicate"; uri: string }
  | { status: "failed"; uri: string; reason: string };
