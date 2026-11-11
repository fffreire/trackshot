import type { CatalogTrack, ExtractedTrack, ScoredCandidate, SearchQuery, TrackMatch } from "./types";

export const HIGH_THRESHOLD = 0.85;
export const FLOOR_THRESHOLD = 0.5;
export const CLEAR_MARGIN = 0.1;

const TITLE_WEIGHT = 0.6;
const ARTIST_WEIGHT = 0.4;
const UNKNOWN_ARTIST_SIMILARITY = 0.5;
const VERSION_PENALTY = 0.25;
const REMASTER_PENALTY = 0.03;
const COMPILATION_PENALTY = 0.05;
const UNPLAYABLE_PENALTY = 0.5;
const SAME_RECORDING_MS = 3000;
const MAX_ALTERNATIVES = 5;

const VERSION_TAGS: [string, RegExp][] = [
  ["live", /\blive\b/],
  ["acoustic", /\bacoustic\b/],
  ["remix", /\bremix(ed)?\b|\brmx\b/],
  ["karaoke", /\bkaraoke\b/],
  ["instrumental", /\binstrumental\b/],
  ["cover", /\bcovers?\b|\btribute\b|originally performed by|made famous by|in the style of/],
  ["sped up", /\bsped up\b|\bspeed up\b/],
  ["slowed", /\bslowed\b/],
  ["demo", /\bdemo\b/],
  ["re-recorded", /\bre-?recorded\b|\w['’]s version\b/],
  ["language", /\b(japanese|spanish|english|french|german|italian|portuguese|korean|chinese) version\b/],
];

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/['‘’`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[([].*?[)\]]/g, " ")
    .replace(/\s-\s.*$/, "")
    .replace(/\s(feat|ft|featuring)\.?\s.*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Dice coefficient over character bigrams, ignoring spaces, so "count me in" ≈ "countmein". */
function similarity(a: string, b: string): number {
  const x = normalize(a).replace(/ /g, "");
  const y = normalize(b).replace(/ /g, "");
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) grams.set(x.slice(i, i + 2), (grams.get(x.slice(i, i + 2)) ?? 0) + 1);
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const left = grams.get(y.slice(i, i + 2)) ?? 0;
    if (left > 0) {
      grams.set(y.slice(i, i + 2), left - 1);
      hits++;
    }
  }
  return (2 * hits) / (x.length + y.length - 2);
}

function penalties(original: ExtractedTrack, track: CatalogTrack): [string, number][] {
  const asked = `${original.title} ${original.originalText}`.toLowerCase();
  const text = `${track.name} ${track.album.name}`.toLowerCase();
  const found: [string, number][] = [];
  for (const [tag, re] of VERSION_TAGS) {
    if (re.test(text) !== re.test(asked)) {
      found.push([re.test(text) ? `${tag} version` : `not the requested ${tag} version`, VERSION_PENALTY]);
    }
  }
  if (/\bremaster/.test(text)) found.push(["remaster", REMASTER_PENALTY]);
  if (track.album.type === "compilation") found.push(["compilation", COMPILATION_PENALTY]);
  if (track.isPlayable === false) found.push(["not playable", UNPLAYABLE_PENALTY]);
  return found;
}

/**
 * Heuristic score in 0..1, not a calibrated probability:
 * 0.6 × title similarity + 0.4 × best artist similarity (0.5 when no artist was extracted),
 * minus penalties for unrequested versions, remasters, compilations and unplayable tracks.
 */
export function scoreCandidate(original: ExtractedTrack, track: CatalogTrack): ScoredCandidate {
  const reasons: string[] = [];
  const title = similarity(original.title, track.name);
  reasons.push(title === 1 ? "title exact" : `title fuzzy ${title.toFixed(2)}`);

  let artist = UNKNOWN_ARTIST_SIMILARITY;
  if (original.artist) {
    artist = Math.max(0, ...track.artists.map((a) => similarity(original.artist ?? "", a)));
    reasons.push(artist === 1 ? "artist exact" : `artist fuzzy ${artist.toFixed(2)}`);
  } else {
    reasons.push("no artist to compare");
  }

  let score = TITLE_WEIGHT * title + ARTIST_WEIGHT * artist;
  for (const [reason, amount] of penalties(original, track)) {
    score -= amount;
    reasons.push(`${reason} −${amount.toFixed(2)}`);
  }
  return { track, score: Math.min(1, Math.max(0, score)), reasons };
}

export async function matchTrack(
  original: ExtractedTrack,
  search: (query: SearchQuery) => Promise<CatalogTrack[]>,
): Promise<TrackMatch> {
  const queries: SearchQuery[] = [
    { title: original.title, artist: original.artist, mode: "exact" },
    { title: original.title, artist: original.artist, mode: "loose" },
  ];

  const byId = new Map<string, ScoredCandidate>();
  for (const query of queries) {
    for (const track of await search(query)) {
      if (!byId.has(track.id)) byId.set(track.id, scoreCandidate(original, track));
    }
    if ([...byId.values()].some((c) => c.score >= HIGH_THRESHOLD)) break;
  }

  const candidates = [...byId.values()]
    .filter((c) => c.score >= FLOOR_THRESHOLD)
    .sort((a, b) => b.score - a.score || (a.track.album.releaseDate ?? "9").localeCompare(b.track.album.releaseDate ?? "9"))
    .slice(0, MAX_ALTERNATIVES);
  const [best, ...rest] = candidates;
  if (!best) return { original, status: "unmatched", candidates: [] };

  const rivals = rest.filter(
    (c) =>
      best.score - c.score < CLEAR_MARGIN &&
      penalties(original, c.track).length === 0 &&
      !(
        c.track.artists.some((a) => best.track.artists.includes(a)) &&
        Math.abs(c.track.durationMs - best.track.durationMs) <= SAME_RECORDING_MS
      ),
  );
  return best.score >= HIGH_THRESHOLD && rivals.length === 0
    ? { original, status: "high", best, candidates }
    : { original, status: "ambiguous", candidates };
}

export async function matchAll(
  tracks: ExtractedTrack[],
  search: (query: SearchQuery) => Promise<CatalogTrack[]>,
  { concurrency = 3 } = {},
): Promise<TrackMatch[]> {
  const results: TrackMatch[] = new Array(tracks.length);
  let next = 0;
  const worker = async () => {
    while (next < tracks.length) {
      const i = next++;
      results[i] = await matchTrack(tracks[i], search).catch(
        (error: unknown): TrackMatch => ({
          original: tracks[i],
          status: "unmatched",
          candidates: [],
          error: error instanceof Error ? error.message : "Search failed",
        }),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tracks.length) }, worker));
  return results;
}
