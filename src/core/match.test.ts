import { describe, expect, it, vi } from "vitest";
import { acceptanceList, expectedStudioIds, fakeSearch, searchResults } from "./fixtures/spotify-search";
import { FLOOR_THRESHOLD, HIGH_THRESHOLD, matchAll, matchTrack, normalize, scoreCandidate } from "./match";
import type { ExtractedTrack, SearchQuery, TrackMatch } from "./types";

const extracted = (title: string, artist?: string, originalText = `${title}${artist ? `, ${artist}` : ""}`): ExtractedTrack => ({
  id: title,
  title,
  artist,
  originalText,
  position: 0,
});

const ids = (m: TrackMatch) => m.candidates.map((c) => c.track.id);

describe("normalize", () => {
  it.each([
    ["Dear Maria, Count Me In", "dear maria count me in"],
    ["Beyoncé", "beyonce"],
    ["This Ain’t A Scene, It's An Arms Race", "this aint a scene its an arms race"],
    ["Rock & Roll", "rock and roll"],
    ["Song (feat. Someone)", "song"],
    ["Song feat. Someone", "song"],
    ["Misery Business - 2017 Remaster", "misery business"],
    ["Misery Business – 2017 Remaster", "misery business"],
    ["Thnks fr th Mmrs (Live)", "thnks fr th mmrs"],
    ["  Too   many    spaces ", "too many spaces"],
  ])("%s → %s", (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe("scoreCandidate", () => {
  const [mmrs] = acceptanceList;

  it("gives an exact studio match a full score with readable reasons", () => {
    const c = scoreCandidate(mmrs, searchResults["Thnks fr th Mmrs"][1]);
    expect(c.score).toBe(1);
    expect(c.reasons).toEqual(["title exact", "artist exact"]);
  });

  it("penalizes an unrequested live version", () => {
    const c = scoreCandidate(mmrs, searchResults["Thnks fr th Mmrs"][0]);
    expect(c.score).toBeCloseTo(0.75);
    expect(c.reasons).toContain("live version −0.25");
  });

  it("does not penalize a version the original asked for, and penalizes its absence", () => {
    const wantsLive = extracted("Thnks fr th Mmrs (Live)", "Fall Out Boy");
    const [live, studio] = searchResults["Thnks fr th Mmrs"].map((t) => scoreCandidate(wantsLive, t));
    expect(live.score).toBe(1);
    expect(studio.reasons).toContain("not the requested live version −0.25");
  });

  it("only lightly penalizes a remaster", () => {
    const c = scoreCandidate(acceptanceList[1], searchResults["Misery Business"][0]);
    expect(c.score).toBeCloseTo(0.97);
    expect(c.reasons).toContain("remaster −0.03");
  });

  it("counts featured artists", () => {
    const c = scoreCandidate(extracted("Song", "Guest"), { ...searchResults.Untouched[1], name: "Song", artists: ["Main", "Guest"] });
    expect(c.reasons).toContain("artist exact");
  });

  it("strongly penalizes unplayable tracks", () => {
    const c = scoreCandidate(acceptanceList[7], searchResults.Untouched[0]);
    expect(c.score).toBeCloseTo(0.5);
    expect(c.reasons).toContain("not playable −0.50");
  });

  it("tolerates OCR-ish title variation", () => {
    const c = scoreCandidate(extracted("Thnks fr th Mmr", "Fall Out Boy"), searchResults["Thnks fr th Mmrs"][1]);
    expect(c.score).toBeGreaterThan(HIGH_THRESHOLD);
    expect(c.reasons[0]).toMatch(/^title fuzzy 0\.\d\d$/);
  });
});

describe("matchTrack", () => {
  it("auto-picks the studio cut of 'Dear Maria Count Me In' (no comma) over live and acoustic", async () => {
    const m = await matchTrack(acceptanceList[4], fakeSearch);
    expect(m.status).toBe("high");
    if (m.status !== "high") return;
    expect(m.best.track.id).toBe("atl-maria");
    expect(ids(m)).toEqual(expect.arrayContaining(["atl-maria-live", "atl-maria-acoustic"]));
  });

  it("picks Avril's studio 'Girlfriend' over karaoke, Japanese version and another artist", async () => {
    const m = await matchTrack(acceptanceList[6], fakeSearch);
    expect(m.status === "high" && m.best.track.id).toBe("avril-gf");
    expect(ids(m)).not.toContain("kar-gf");
  });

  it("still auto-picks when the only studio cut is a remaster", async () => {
    const m = await matchTrack(acceptanceList[1], async () => [searchResults["Misery Business"][0]]);
    expect(m.status === "high" && m.best.track.id).toBe("pmr-misery-remaster");
  });

  it("treats a deluxe reissue of the same recording as no rival and prefers the earliest release", async () => {
    const m = await matchTrack(acceptanceList[3], fakeSearch);
    expect(m.status === "high" && m.best.track.id).toBe("blg-escape");
    expect(ids(m)).toContain("blg-escape-deluxe");
  });

  it("is ambiguous when two different studio recordings score the same", async () => {
    const m = await matchTrack(extracted("Hey There Delilah", "Plain White T's"), fakeSearch);
    expect(m.status).toBe("ambiguous");
    expect(ids(m)).toEqual(["pwt-delilah-2003", "pwt-delilah-2006"]);
  });

  it("is ambiguous when the artist is missing and two artists share the title", async () => {
    const m = await matchTrack(extracted("Girlfriend"), fakeSearch);
    expect(m.status).toBe("ambiguous");
    expect(ids(m).slice(0, 2)).toEqual(["avril-gf", "puth-gf"]);
    expect(m.candidates.length).toBeLessThanOrEqual(5);
  });

  it("is unmatched when nothing relevant comes back", async () => {
    const m = await matchTrack(extracted("Song That Does Not Exist", "Nobody"), fakeSearch);
    expect(m).toMatchObject({ status: "unmatched", candidates: [] });
  });

  it("never auto-picks an unplayable track", async () => {
    const m = await matchTrack(acceptanceList[7], async () => [searchResults.Untouched[0]]);
    expect(m.status).toBe("ambiguous");
    expect(m.candidates[0].score).toBeGreaterThanOrEqual(FLOOR_THRESHOLD);
  });

  it("uses the exact query first and stops when it is good enough", async () => {
    const search = vi.fn(fakeSearch);
    await matchTrack(acceptanceList[0], search);
    expect(search.mock.calls).toEqual([[{ title: "Thnks fr th Mmrs", artist: "Fall Out Boy", mode: "exact" }]]);
  });

  it("falls back to a loose query when the exact one finds nothing", async () => {
    const search = vi.fn(async (q: SearchQuery) => (q.mode === "exact" ? [] : fakeSearch(q)));
    const m = await matchTrack(acceptanceList[0], search);
    expect(search.mock.calls.map(([q]) => q.mode)).toEqual(["exact", "loose"]);
    expect(m.status === "high" && m.best.track.id).toBe("fob-mmrs");
  });

  it("searches by title only when there is no artist", async () => {
    const search = vi.fn(fakeSearch);
    await matchTrack(extracted("Girlfriend"), search);
    expect(search.mock.calls.map(([q]) => q.artist)).toEqual([undefined, undefined]);
  });
});

describe("matchAll", () => {
  it("matches every acceptance song to its studio recording, in order", async () => {
    const matches = await matchAll(acceptanceList, fakeSearch);
    expect(matches.map((m) => m.original.id)).toEqual(acceptanceList.map((t) => t.id));
    expect(matches.map((m) => (m.status === "high" ? m.best.track.id : m.status))).toEqual(expectedStudioIds);
  });

  it("preserves order even when later searches resolve first", async () => {
    const search = async (q: SearchQuery) => {
      await new Promise((r) => setTimeout(r, q.title.includes("Thnks") ? 20 : 0));
      return fakeSearch(q);
    };
    const matches = await matchAll(acceptanceList.slice(0, 4), search, { concurrency: 4 });
    expect(matches.map((m) => m.original.id)).toEqual(["x1", "x2", "x3", "x4"]);
  });

  it("never runs more searches at once than the concurrency limit", async () => {
    let running = 0;
    let peak = 0;
    const search = async (q: SearchQuery) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return fakeSearch(q);
    };
    await matchAll(acceptanceList, search, { concurrency: 2 });
    expect(peak).toBe(2);
  });

  it("marks only the track whose search throws as unmatched", async () => {
    const search = async (q: SearchQuery) => {
      if (q.title.includes("Girlfriend")) throw new Error("429 Too Many Requests");
      return fakeSearch(q);
    };
    const matches = await matchAll(acceptanceList, search);
    expect(matches.map((m) => m.status)).toEqual(["high", "high", "high", "high", "high", "high", "unmatched", "high", "high", "high"]);
  });
});
