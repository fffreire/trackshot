import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptanceList, fakeSearch } from "@/core/fixtures/spotify-search";
import { matchTrack } from "@/core/match";
import type { CatalogTrack, Playlist } from "@/core/types";
import {
  authNotice,
  describeError,
  initialState,
  linksText,
  mergeOutcomes,
  plan,
  reducer,
  retryFailed,
  runImport,
  runMatching,
  toChoice,
  type Action,
  type Choice,
  type Dest,
  type Flow,
  type State,
} from "./flow";

const track = (id: string): CatalogTrack => ({
  provider: "spotify",
  id,
  uri: `spotify:track:${id}`,
  url: `https://open.spotify.com/track/${id}`,
  name: id,
  artists: ["A"],
  album: { name: "X" },
  durationMs: 1,
});
const choice = (id: string, included = true): Choice => ({
  original: { id: `o-${id}`, title: id, originalText: id, position: 0 },
  status: "high",
  candidates: [{ track: track(id), score: 1, reasons: [] }],
  chosen: { track: track(id), score: 1, reasons: [] },
  included,
});
const playlist: Playlist = { id: "pl", name: "Mix", trackCount: 2, editable: true };
const dest = (patch: Partial<Dest> = {}): Dest => ({
  enabled: true,
  target: { kind: "new", name: "New one" },
  skipDuplicates: true,
  playlists: { kind: "ready", value: [playlist] },
  job: { kind: "idle" },
  ...patch,
});

const run = (actions: Action[], state: State = initialState) => actions.reduce(reducer, state);
const flowOf = <S extends Flow["stage"]>(state: State, stage: S) => {
  expect(state.flow.stage).toBe(stage);
  return state.flow as Extract<Flow, { stage: S }>;
};

function mockFetch(handler: (url: string, init?: RequestInit) => [number, unknown]) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const [status, body] = handler(url, init);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("reducer", () => {
  const review = run([{ type: "rows", rows: [{ id: "a", title: "Misery Business", artist: "Paramore" }] }]);

  it("starts review with one empty row when nothing was extracted", () => {
    expect(flowOf(run([{ type: "rows", rows: [] }]), "review").rows).toHaveLength(1);
  });

  it("edits, adds and removes rows in order", () => {
    const state = run([{ type: "add-row" }, { type: "edit-row", id: "a", field: "artist", value: "Hayley" }], review);
    const rows = flowOf(state, "review").rows;
    expect(rows.map((r) => r.artist)).toEqual(["Hayley", ""]);
    expect(flowOf(run([{ type: "remove-row", id: "a" }], state), "review").rows).toHaveLength(1);
  });

  it("drops blank rows when moving to matching and keeps positions", () => {
    const state = run([{ type: "add-row" }, { type: "to-match", targets: ["spotify"] }], review);
    expect(flowOf(state, "match").tracks).toEqual([
      { id: "a", title: "Misery Business", artist: "Paramore", originalText: "Misery Business - Paramore", position: 0 },
    ]);
  });

  it("keeps targets in service order when toggling", () => {
    const state = run(
      [
        { type: "to-match", targets: ["youtube-music"] },
        { type: "toggle-target", provider: "spotify" },
        { type: "toggle-target", provider: "apple-music" },
      ],
      review,
    );
    expect(flowOf(state, "match").targets).toEqual(["spotify", "apple-music", "youtube-music"]);
    expect(flowOf(run([{ type: "toggle-target", provider: "spotify" }], state), "match").targets).toEqual(["apple-music", "youtube-music"]);
  });

  it("never includes a song without a chosen track, and choosing includes it", () => {
    const ambiguous: Choice = { ...choice("x", false), status: "ambiguous", chosen: undefined };
    const matched = run(
      [{ type: "to-match", targets: ["spotify"] }, { type: "match", provider: "spotify", match: { kind: "ready", picks: [ambiguous] } }],
      review,
    );
    const picks = (s: State) => {
      const m = flowOf(s, "match").matches.spotify;
      return m?.kind === "ready" ? m.picks : [];
    };
    expect(picks(run([{ type: "include", provider: "spotify", index: 0, included: true }], matched))[0].included).toBe(false);
    const chosen = run([{ type: "choose", provider: "spotify", index: 0, candidate: ambiguous.candidates[0] }], matched);
    expect(picks(chosen)[0]).toMatchObject({ included: true, chosen: ambiguous.candidates[0] });
  });

  it("defaults to the shared panel with 2+ connected services and goes back without losing matches", () => {
    const matched = run([{ type: "to-match", targets: ["spotify", "apple-music"] }], review);
    const both = flowOf(run([{ type: "to-import", connected: ["spotify", "apple-music"], name: "n" }], matched), "import");
    expect(both.mode).toBe("together");
    expect(Object.keys(both.dests)).toEqual(["spotify", "apple-music"]);
    expect(flowOf(run([{ type: "to-import", connected: ["spotify"], name: "n" }], matched), "import").mode).toBe("separate");
    expect(flowOf(reducer({ ...matched, flow: both }, { type: "back" }), "match").targets).toEqual(["spotify", "apple-music"]);
  });

  it("merges a retry into the earlier result", () => {
    const prior = {
      playlist,
      alreadyThere: [],
      outcomes: [
        { status: "added" as const, trackId: "a" },
        { status: "failed" as const, trackId: "b", reason: "429" },
      ],
    };
    const state = run(
      [
        { type: "to-match", targets: ["spotify"] },
        { type: "to-import", connected: ["spotify"], name: "n" },
        { type: "dest", provider: "spotify", patch: { job: { kind: "submitting", requestId: "r2", prior } } },
        { type: "job-done", provider: "spotify", result: { ...prior, outcomes: [{ status: "added", trackId: "b" }] } },
      ],
      review,
    );
    expect(flowOf(state, "import").dests.spotify?.job).toEqual({
      kind: "done",
      result: { ...prior, outcomes: [{ status: "added", trackId: "a" }, { status: "added", trackId: "b" }] },
    });
  });

  it("start over keeps the loaded services", () => {
    const services: State["services"] = { kind: "ready", value: [] };
    expect(run([{ type: "services", services }, { type: "reset" }], review)).toEqual({ ...initialState, services });
  });
});

describe("helpers", () => {
  it("toChoice preselects only high-confidence matches", async () => {
    const [high, ambiguous] = await Promise.all([matchTrack(acceptanceList[0], fakeSearch), matchTrack(acceptanceList[4], fakeSearch)]);
    expect(toChoice(high)).toMatchObject({ included: true, chosen: { track: { id: "fob-mmrs" } } });
    const unsure = toChoice({ original: ambiguous.original, status: "ambiguous", candidates: ambiguous.candidates });
    expect(unsure.included).toBe(false);
    expect(unsure.chosen).toBeUndefined();
  });

  it("plan skips songs already in the playlist and repeats in the list only when skipping", () => {
    const picks = [choice("a"), choice("b"), choice("a"), choice("c", false)];
    expect(plan(picks, ["b"], true)).toEqual(["add", "already", "already", "out"]);
    expect(plan(picks, ["b"], false)).toEqual(["add", "add", "add", "out"]);
  });

  it("mergeOutcomes replaces failures in order", () => {
    expect(
      mergeOutcomes(
        [
          { status: "failed", trackId: "a", reason: "x" },
          { status: "added", trackId: "b" },
          { status: "failed", trackId: "c", reason: "x" },
        ],
        [
          { status: "added", trackId: "a" },
          { status: "failed", trackId: "c", reason: "y" },
        ],
      ).map((o) => o.status),
    ).toEqual(["added", "added", "failed"]);
  });

  it("describes errors honestly per service", () => {
    expect(describeError({ status: 409, kind: "duplicate-request", message: "" }, "spotify")).toBe(
      "This import was already sent. Check the playlist before retrying.",
    );
    expect(describeError({ status: 429, kind: "rate-limited", message: "", retryAfterSeconds: 30 }, "spotify")).toContain("30 seconds");
    expect(describeError({ status: 429, kind: "rate-limited", message: "" }, "youtube-music")).toContain("midnight Pacific");
    expect(describeError({ status: 401, kind: "not-connected", message: "" }, "apple-music")).toContain("Reconnect Apple Music");
    expect(describeError({ status: 0, kind: "network", message: "" }, "spotify")).toContain("Couldn't reach Spotify");
  });

  it("maps auth errors, including YouTube-prefixed ones", () => {
    expect(authNotice("not-allowlisted")).toMatchObject({ byo: true, text: expect.stringContaining("5 approved accounts") });
    expect(authNotice("youtube-no-channel").text).toContain("YouTube channel");
    expect(authNotice("youtube-access-denied").text).toBe("YouTube Music: You cancelled the login, so nothing was connected.");
    expect(authNotice("weird").text).toContain("(weird)");
  });

  it("copies links one per line", () => {
    expect(linksText([track("a"), track("b")])).toBe("https://open.spotify.com/track/a\nhttps://open.spotify.com/track/b");
  });
});

describe("network flows", () => {
  it("runMatching reports a service-level error when every search fails", async () => {
    mockFetch(() => [401, { error: { kind: "not-connected", message: "Connect spotify first" } }]);
    const actions: Action[] = [];
    await runMatching("spotify", acceptanceList.slice(0, 2), (a) => actions.push(a));
    expect(actions.at(-1)).toMatchObject({ type: "match", match: { kind: "error", error: { status: 401, kind: "not-connected" } } });
  });

  it("runMatching searches through the API and preselects high matches", async () => {
    const calls = mockFetch((url) =>
      new URL(url, "http://x").searchParams.get("title") === "Misery Business"
        ? [200, { tracks: [{ ...track("pmr"), name: "Misery Business", artists: ["Paramore"] }] }]
        : [200, { tracks: [] }],
    );
    const actions: Action[] = [];
    await runMatching("spotify", [acceptanceList[1]], (a) => actions.push(a));
    expect(calls[0].url).toBe("/api/music/spotify/search?title=Misery+Business&artist=Paramore&mode=exact");
    expect(actions.at(-1)).toMatchObject({ match: { kind: "ready", picks: [{ status: "high", included: true }] } });
  });

  it("runImport creates the playlist, then adds the planned tracks once with a requestId", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/playlists") ? [200, { playlist: { ...playlist, id: "new" } }] : [200, { outcomes: [{ status: "added", trackId: "a" }, { status: "added", trackId: "b" }] }],
    );
    const actions: Action[] = [];
    await runImport("spotify", dest(), [choice("a"), choice("x", false), choice("b")], " Mix ", (a) => actions.push(a));
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "/api/music/spotify/playlists"],
      ["POST", "/api/music/spotify/playlists/new/tracks"],
    ]);
    expect(calls[0].body).toEqual({ name: "Mix" });
    const submitting = actions.find((a) => a.type === "dest" && a.patch.job?.kind === "submitting");
    expect(calls[1].body).toEqual({
      trackIds: ["a", "b"],
      requestId: submitting?.type === "dest" && submitting.patch.job?.kind === "submitting" ? submitting.patch.job.requestId : "missing",
    });
    expect(actions.at(-1)).toMatchObject({ type: "job-done", result: { playlist: { id: "new" }, alreadyThere: [] } });
  });

  it("runImport re-checks an existing playlist and sends only new tracks", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/track-ids") ? [200, { trackIds: ["a"] }] : [200, { outcomes: [{ status: "added", trackId: "b" }] }],
    );
    const actions: Action[] = [];
    await runImport("apple-music", dest({ target: { kind: "existing", playlist } }), [choice("a"), choice("b")], "", (a) => actions.push(a));
    expect(calls.map((c) => c.url)).toEqual(["/api/music/apple-music/playlists/pl/track-ids", "/api/music/apple-music/playlists/pl/tracks"]);
    expect(calls[1].body).toMatchObject({ trackIds: ["b"] });
    expect(actions.at(-1)).toMatchObject({ result: { alreadyThere: ["a"] } });
  });

  it("runImport reuses a playlist it already created instead of creating another", async () => {
    const calls = mockFetch((url) => (url.endsWith("/track-ids") ? [200, { trackIds: [] }] : [200, { outcomes: [] }]));
    await runImport("spotify", dest({ created: { ...playlist, id: "made" } }), [choice("a")], "Mix", () => {});
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/playlists"))).toBe(false);
  });

  it("runImport stops on an error and never retries the mutation", async () => {
    const calls = mockFetch((url) => (url.endsWith("/playlists") ? [200, { playlist }] : [502, { error: { kind: "network", message: "boom" } }]));
    const actions: Action[] = [];
    await runImport("spotify", dest(), [choice("a")], "Mix", (a) => actions.push(a));
    expect(calls.filter((c) => c.url.endsWith("/tracks"))).toHaveLength(1);
    expect(actions.at(-1)).toMatchObject({ type: "dest", patch: { job: { kind: "error", error: { kind: "network" } } } });
  });

  it("retryFailed sends only the failed ids with a fresh requestId", async () => {
    const calls = mockFetch(() => [200, { outcomes: [{ status: "added", trackId: "b" }] }]);
    const prior = {
      playlist,
      alreadyThere: [],
      outcomes: [
        { status: "added" as const, trackId: "a" },
        { status: "failed" as const, trackId: "b", reason: "Not attempted after an earlier failure." },
      ],
    };
    await retryFailed("youtube-music", prior, () => {});
    await retryFailed("youtube-music", prior, () => {});
    const bodies = calls.map((c) => c.body as { trackIds: string[]; requestId: string });
    expect(bodies[0].trackIds).toEqual(["b"]);
    expect(bodies[0].requestId).not.toBe(bodies[1].requestId);
  });
});
