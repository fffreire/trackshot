import { z } from "zod";
import { matchAll } from "@/core/match";
import type { CatalogTrack, ExtractedTrack, ImportOutcome, Playlist, ProviderId, ScoredCandidate, TrackMatch } from "@/core/types";

export const SERVICES: { id: ProviderId; name: string }[] = [
  { id: "spotify", name: "Spotify" },
  { id: "apple-music", name: "Apple Music" },
  { id: "youtube-music", name: "YouTube Music" },
];
export const serviceName = (id: ProviderId) => SERVICES.find((s) => s.id === id)?.name ?? id;

export type ServiceStatus = {
  id: ProviderId;
  configured: boolean;
  connected: boolean;
  anonymousSearch: boolean;
  user?: { displayName: string };
};
export type Access = "connected" | "search-only" | "disconnected" | "not-configured";
export const access = (s: ServiceStatus): Access =>
  !s.configured ? "not-configured" : s.connected ? "connected" : s.anonymousSearch ? "search-only" : "disconnected";

export type ApiError = { status: number; kind: string; message: string; retryAfterSeconds?: number };
export type Remote<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; error: ApiError };

export type Row = { id: string; title: string; artist: string };

export type Choice = {
  original: ExtractedTrack;
  status: TrackMatch["status"];
  candidates: ScoredCandidate[];
  chosen?: ScoredCandidate;
  included: boolean;
  error?: string;
};
export type ServiceMatch = { kind: "matching" } | { kind: "ready"; picks: Choice[] } | { kind: "error"; error: ApiError };

export type Target = { kind: "new"; name: string } | { kind: "existing"; playlist: Playlist };
export type ImportResult = { playlist: Playlist; outcomes: ImportOutcome[]; alreadyThere: string[] };
export type Job =
  | { kind: "idle" }
  | { kind: "submitting"; requestId: string; prior?: ImportResult }
  | { kind: "done"; result: ImportResult }
  | { kind: "error"; error: ApiError; prior?: ImportResult };
export type Dest = {
  enabled: boolean;
  target: Target;
  skipDuplicates: boolean;
  playlists: Remote<Playlist[]>;
  existingIds?: Remote<string[]>;
  created?: Playlist;
  job: Job;
};

type Matching = { rows: Row[]; tracks: ExtractedTrack[]; targets: ProviderId[]; matches: Partial<Record<ProviderId, ServiceMatch>> };
export type Ocr = { kind: "idle" } | { kind: "reading"; pct: number } | { kind: "empty" } | { kind: "error"; message: string };
export type Flow =
  | { stage: "upload"; image?: { url: string; name: string }; ocr: Ocr }
  | { stage: "review"; rows: Row[] }
  | ({ stage: "match" } & Matching)
  | ({ stage: "import"; mode: "together" | "separate"; sharedName: string; dests: Partial<Record<ProviderId, Dest>> } & Matching);

export type Notice = { tone: "bad" | "warn"; text: string; byo?: boolean };
export type State = { services: Remote<ServiceStatus[]>; flow: Flow; notice?: Notice };

export type Action =
  | { type: "services"; services: Remote<ServiceStatus[]> }
  | { type: "notice"; notice?: Notice }
  | { type: "image"; image: { url: string; name: string } }
  | { type: "ocr"; ocr: Ocr }
  | { type: "rows"; rows: Row[] }
  | { type: "edit-row"; id: string; field: "title" | "artist"; value: string }
  | { type: "remove-row"; id: string }
  | { type: "add-row" }
  | { type: "to-match"; targets: ProviderId[] }
  | { type: "toggle-target"; provider: ProviderId }
  | { type: "match"; provider: ProviderId; match: ServiceMatch }
  | { type: "choose"; provider: ProviderId; index: number; candidate: ScoredCandidate }
  | { type: "include"; provider: ProviderId; index: number; included: boolean }
  | { type: "candidates"; provider: ProviderId; index: number; candidates: ScoredCandidate[] }
  | { type: "to-import"; connected: ProviderId[]; name: string }
  | { type: "back" }
  | { type: "mode"; mode: "together" | "separate" }
  | { type: "shared-name"; name: string }
  | { type: "dest"; provider: ProviderId; patch: Partial<Dest> }
  | { type: "job-done"; provider: ProviderId; result: ImportResult }
  | { type: "reset" };

export const initialState: State = { services: { kind: "loading" }, flow: { stage: "upload", ocr: { kind: "idle" } } };

export const emptyRow = (): Row => ({ id: crypto.randomUUID(), title: "", artist: "" });

export function toTracks(rows: Row[]): ExtractedTrack[] {
  return rows
    .filter((row) => row.title.trim())
    .map((row, position) => ({
      id: row.id,
      title: row.title.trim(),
      artist: row.artist.trim() || undefined,
      originalText: [row.title, row.artist].filter(Boolean).join(" - "),
      position,
    }));
}

export const toChoice = (match: TrackMatch): Choice =>
  match.status === "high"
    ? { original: match.original, status: "high", candidates: match.candidates, chosen: match.best, included: true }
    : { original: match.original, status: match.status, candidates: match.candidates, included: false, error: "error" in match ? match.error : undefined };

/** Merges a "retry failed" response into the earlier result: each failed outcome is replaced, in order, by the retry's outcome. */
export function mergeOutcomes(prior: ImportOutcome[], retry: ImportOutcome[]): ImportOutcome[] {
  let next = 0;
  return prior.map((outcome) => (outcome.status === "failed" ? (retry[next++] ?? outcome) : outcome));
}

export type Mark = "add" | "already" | "out";
/** What happens to each song (in screenshot order) for one service. With skipping on, repeats within the list count as already there. */
export function plan(picks: Choice[], existingIds: string[], skipDuplicates: boolean): Mark[] {
  const seen = new Set(skipDuplicates ? existingIds : []);
  return picks.map((pick) => {
    if (!pick.included || !pick.chosen) return "out";
    const id = pick.chosen.track.id;
    if (seen.has(id)) return "already";
    if (skipDuplicates) seen.add(id);
    return "add";
  });
}

export const chosenTracks = (picks: Choice[]): CatalogTrack[] =>
  picks.flatMap((pick) => (pick.included && pick.chosen ? [pick.chosen.track] : []));

export const linksText = (tracks: CatalogTrack[]) => tracks.map((track) => track.url).join("\n");
export const listText = (tracks: CatalogTrack[]) =>
  tracks.map((track, i) => `${i + 1}. ${track.name} – ${track.artists.join(", ")}\n   ${track.url}`).join("\n");

export const playlistUrl = (provider: ProviderId, id: string) =>
  ({
    spotify: `https://open.spotify.com/playlist/${id}`,
    "apple-music": "https://music.apple.com/library",
    "youtube-music": `https://music.youtube.com/playlist?list=${id}`,
  })[provider];

export function describeError(error: ApiError, provider: ProviderId): string {
  const service = serviceName(provider);
  if (error.kind === "duplicate-request") return "This import was already sent. Check the playlist before retrying.";
  if (error.kind === "network" || error.status === 0) return `Couldn't reach ${service}. Check your connection and try again.`;
  if (error.kind === "not-connected" || error.kind === "auth" || error.status === 401)
    return `Your ${service} connection has expired. Reconnect ${service} to continue.`;
  if ((error.kind === "rate-limited" || error.status === 429) && provider === "youtube-music")
    return "YouTube's daily search quota for this server is used up. It resets at midnight Pacific time.";
  if (error.kind === "rate-limited" || error.status === 429)
    return `${service} is asking us to slow down. Try again in ${error.retryAfterSeconds ? `${error.retryAfterSeconds} seconds` : "a minute"}.`;
  if (error.kind === "forbidden" || error.status === 403)
    return `${service} didn't allow this. You may not have permission to change this playlist.`;
  if (error.kind === "not-configured" || error.status === 501) return `${service} isn't set up on this server.`;
  if (error.kind === "not-found" || error.status === 404) return `${service} couldn't find that playlist. It may have been deleted.`;
  return `${service} returned an error: ${error.message}`;
}

const AUTH_ERRORS: Record<string, string> = {
  "no-client-id": "Spotify isn't set up on this server yet. You can still connect with your own Spotify app.",
  "invalid-client-id": "That Client ID doesn't look right. It's the 32-character code on your Spotify app's settings page.",
  "access-denied": "You cancelled the login, so nothing was connected.",
  "authorize-failed": "The login couldn't start. Try connecting again.",
  "login-expired": "The login took too long or was opened in another tab. Try connecting again.",
  "state-mismatch": "We couldn't verify that login, so we stopped it to keep your account safe. Try connecting again.",
  "not-allowlisted":
    "This server's Spotify app is in Development Mode, which only lets up to 5 approved accounts sign in, and yours isn't one of them. Use your own Spotify app instead. It takes about two minutes.",
  "token-exchange-failed":
    "The service didn't accept the login. If you used your own Spotify app, check that its redirect URI matches exactly.",
  "profile-failed": "You logged in, but the service didn't return your profile. Try connecting again.",
  "youtube-no-channel":
    "Your Google account has no YouTube channel, and YouTube Music needs one to save playlists. Create a channel on YouTube, then connect again.",
};
export const authNotice = (code: string): Notice => ({
  tone: "bad",
  text:
    AUTH_ERRORS[code] ??
    (code.startsWith("youtube-") && AUTH_ERRORS[code.slice(8)] ? `YouTube Music: ${AUTH_ERRORS[code.slice(8)]}` : undefined) ??
    `The login didn't finish (${code}). Try connecting again.`,
  byo: code === "not-allowlisted" || code === "no-client-id",
});

export function reducer(state: State, action: Action): State {
  const { flow } = state;
  const set = (next: Flow): State => ({ ...state, flow: next });
  switch (action.type) {
    case "services":
      return { ...state, services: action.services };
    case "notice":
      return { ...state, notice: action.notice };
    case "reset":
      return { ...initialState, services: state.services };
    case "image":
      return set({ stage: "upload", image: action.image, ocr: { kind: "reading", pct: 0 } });
    case "ocr":
      return flow.stage === "upload" ? set({ ...flow, ocr: action.ocr }) : state;
    case "rows":
      return set({ stage: "review", rows: action.rows.length ? action.rows : [emptyRow()] });
  }

  if (flow.stage === "review") {
    switch (action.type) {
      case "edit-row":
        return set({ ...flow, rows: flow.rows.map((row) => (row.id === action.id ? { ...row, [action.field]: action.value } : row)) });
      case "remove-row":
        return set({ ...flow, rows: flow.rows.filter((row) => row.id !== action.id) });
      case "add-row":
        return set({ ...flow, rows: [...flow.rows, emptyRow()] });
      case "to-match":
        return set({ stage: "match", rows: flow.rows, tracks: toTracks(flow.rows), targets: action.targets, matches: {} });
    }
    return state;
  }

  if (flow.stage !== "match" && flow.stage !== "import") return state;
  if (action.type === "back") return flow.stage === "import" ? set({ ...flow, stage: "match" }) : set({ stage: "review", rows: flow.rows });

  const picksOf = (provider: ProviderId, update: (picks: Choice[]) => Choice[]): Flow => {
    const match = flow.matches[provider];
    return match?.kind === "ready" ? { ...flow, matches: { ...flow.matches, [provider]: { kind: "ready", picks: update(match.picks) } } } : flow;
  };
  const at = (index: number, update: (pick: Choice) => Choice) => (picks: Choice[]) => picks.map((p, i) => (i === index ? update(p) : p));

  if (flow.stage === "match") {
    switch (action.type) {
      case "toggle-target":
        return set({
          ...flow,
          targets: flow.targets.includes(action.provider)
            ? flow.targets.filter((t) => t !== action.provider)
            : SERVICES.map((s) => s.id).filter((id) => id === action.provider || flow.targets.includes(id)),
        });
      case "match":
        return set({ ...flow, matches: { ...flow.matches, [action.provider]: action.match } });
      case "choose":
        return set(picksOf(action.provider, at(action.index, (p) => ({ ...p, chosen: action.candidate, included: true }))));
      case "include":
        return set(picksOf(action.provider, at(action.index, (p) => ({ ...p, included: action.included && !!p.chosen }))));
      case "candidates":
        return set(picksOf(action.provider, at(action.index, (p) => ({ ...p, candidates: action.candidates }))));
      case "to-import": {
        const dests = Object.fromEntries(
          action.connected.map((id): [ProviderId, Dest] => [
            id,
            { enabled: true, target: { kind: "new", name: action.name }, skipDuplicates: true, playlists: { kind: "loading" }, job: { kind: "idle" } },
          ]),
        );
        return set({ ...flow, stage: "import", mode: action.connected.length > 1 ? "together" : "separate", sharedName: action.name, dests });
      }
    }
    return state;
  }

  const dest = (provider: ProviderId, update: (d: Dest) => Dest): State => {
    const current = flow.dests[provider];
    return current ? set({ ...flow, dests: { ...flow.dests, [provider]: update(current) } }) : state;
  };
  switch (action.type) {
    case "mode":
      return set({ ...flow, mode: action.mode });
    case "shared-name":
      return set({ ...flow, sharedName: action.name });
    case "dest":
      return dest(action.provider, (d) => ({ ...d, ...action.patch }));
    case "job-done":
      return dest(action.provider, (d) => ({
        ...d,
        job: {
          kind: "done",
          result:
            d.job.kind === "submitting" && d.job.prior
              ? { ...d.job.prior, outcomes: mergeOutcomes(d.job.prior.outcomes, action.result.outcomes) }
              : action.result,
        },
      }));
  }
  return state;
}

const errorBody = z.object({ error: z.object({ kind: z.string(), message: z.string(), retryAfterSeconds: z.number().optional() }) });

export async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  try {
    const res = await fetch(path, init?.body ? { ...init, headers: { "content-type": "application/json" } } : init);
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    const parsed = errorBody.safeParse(body);
    return {
      ok: false,
      error: parsed.success
        ? { status: res.status, ...parsed.data.error }
        : { status: res.status, kind: "unknown", message: res.statusText || `HTTP ${res.status}` },
    };
  } catch {
    return { ok: false, error: { status: 0, kind: "network", message: "Network error" } };
  }
}

export const searchPath = (provider: ProviderId, title: string, artist: string | undefined, mode: "exact" | "loose") =>
  `/api/music/${provider}/search?${new URLSearchParams({ title, ...(artist ? { artist } : {}), mode })}`;

export async function runMatching(provider: ProviderId, tracks: ExtractedTrack[], dispatch: (action: Action) => void) {
  dispatch({ type: "match", provider, match: { kind: "matching" } });
  let failure: ApiError | undefined;
  const matches = await matchAll(
    tracks,
    async (query) => {
      const res = await api<{ tracks: CatalogTrack[] }>(searchPath(provider, query.title, query.artist, query.mode));
      if (res.ok) return res.data.tracks;
      failure ??= res.error;
      throw new Error(describeError(res.error, provider));
    },
    { concurrency: 3 },
  );
  dispatch({
    type: "match",
    provider,
    match: failure && matches.every((m) => "error" in m && m.error) ? { kind: "error", error: failure } : { kind: "ready", picks: matches.map(toChoice) },
  });
}

/** Creates the playlist if needed, then adds the planned tracks once. Never retried automatically. */
export async function runImport(provider: ProviderId, dest: Dest, picks: Choice[], name: string, dispatch: (action: Action) => void) {
  const requestId = crypto.randomUUID();
  dispatch({ type: "dest", provider, patch: { job: { kind: "submitting", requestId } } });
  const fail = (error: ApiError) => dispatch({ type: "dest", provider, patch: { job: { kind: "error", error } } });

  let playlist = dest.created ?? (dest.target.kind === "existing" ? dest.target.playlist : undefined);
  let existingIds: string[] = [];
  if (playlist && dest.skipDuplicates) {
    const res = await api<{ trackIds: string[] }>(`/api/music/${provider}/playlists/${encodeURIComponent(playlist.id)}/track-ids`);
    if (!res.ok) return fail(res.error);
    existingIds = res.data.trackIds;
  }
  if (!playlist) {
    const res = await api<{ playlist: Playlist }>(`/api/music/${provider}/playlists`, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    if (!res.ok) return fail(res.error);
    playlist = res.data.playlist;
    dispatch({ type: "dest", provider, patch: { created: playlist } });
  }

  const marks = plan(picks, existingIds, dest.skipDuplicates);
  const ids = (mark: Mark) => picks.flatMap((pick, i) => (marks[i] === mark && pick.chosen ? [pick.chosen.track.id] : []));
  const trackIds = ids("add");
  let outcomes: ImportOutcome[] = [];
  if (trackIds.length) {
    const res = await api<{ outcomes: ImportOutcome[] }>(`/api/music/${provider}/playlists/${encodeURIComponent(playlist.id)}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackIds, requestId }),
    });
    if (!res.ok) return fail(res.error);
    outcomes = res.data.outcomes;
  }
  dispatch({ type: "job-done", provider, result: { playlist, outcomes, alreadyThere: ids("already") } });
}

export async function retryFailed(provider: ProviderId, prior: ImportResult, dispatch: (action: Action) => void) {
  const requestId = crypto.randomUUID();
  dispatch({ type: "dest", provider, patch: { job: { kind: "submitting", requestId, prior } } });
  const trackIds = prior.outcomes.flatMap((o) => (o.status === "failed" ? [o.trackId] : []));
  const res = await api<{ outcomes: ImportOutcome[] }>(`/api/music/${provider}/playlists/${encodeURIComponent(prior.playlist.id)}/tracks`, {
    method: "POST",
    body: JSON.stringify({ trackIds, requestId }),
  });
  if (!res.ok) return dispatch({ type: "dest", provider, patch: { job: { kind: "error", error: res.error, prior } } });
  dispatch({ type: "job-done", provider, result: { ...prior, outcomes: res.data.outcomes } });
}
