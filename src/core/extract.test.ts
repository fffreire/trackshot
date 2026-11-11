import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTracks } from "./extract";
import { acceptanceList } from "./fixtures/spotify-search";

const pairs = (text: string) => parseTracks(text).map(({ title, artist }) => [title, artist]);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseTracks", () => {
  it("extracts the 2007 pop-punk TikTok list in order", () => {
    const tracks = parseTracks(fixture("poppunk-2007.txt"));
    expect(tracks.map(({ title, artist }) => [title, artist])).toEqual([
      ["Thnks fr th Mmrs", "Fall Out Boy"],
      ["Misery Business", "Paramore"],
      ["Check Yes Juliet", "We The Kings"],
      ["The Great Escape", "Boys Like Girls"],
      ["Dear Maria Count Me In", "All Time Low"],
      ["Shake It", "Metro Station"],
      ["Girlfriend", "Avril Lavigne"],
      ["Untouched", "The Veronicas"],
      ["This Ain't a Scene, It's an Arms Race", "Fall Out Boy"],
      ["Walking Disaster", "Sum 41"],
    ]);
    expect(tracks.map((track) => [track.id, track.position])).toEqual(
      Array.from({ length: 10 }, (_, i) => [`t${i + 1}`, i + 1]),
    );
    expect(tracks[1].originalText).toBe("2. Misery Business , Paramore 🎸");
  });

  it("parses what tesseract.js actually read from e2e/fixtures/poppunk-2007.png", () => {
    expect(pairs(fixture("poppunk-2007-ocr.txt"))).toEqual(acceptanceList.map(({ title, artist }) => [title, artist]));
  });

  it("returns [] for empty or noise-only input", () => {
    expect(parseTracks("")).toEqual([]);
    expect(parseTracks("  \n\n")).toEqual([]);
    expect(parseTracks("@someone\n12.3K likes\nFollow\n3h ago\n#fyp #music")).toEqual([]);
  });

  it.each([
    ["1.", "1. Misery Business - Paramore"],
    ["1)", "1) Misery Business - Paramore"],
    ["#1", "#1 Misery Business - Paramore"],
    ["1 -", "1 - Misery Business - Paramore"],
    ["01", "01 Misery Business - Paramore"],
    ["l.", "l. Misery Business - Paramore"],
    ["I.", "I. Misery Business - Paramore"],
    ["|)", "|) Misery Business - Paramore"],
  ])("strips the %s list marker", (_, line) => {
    expect(pairs(line)).toEqual([["Misery Business", "Paramore"]]);
  });

  it("reads I0. and Il. as two-digit markers", () => {
    expect(pairs("9. Girlfriend, Avril Lavigne\nI0. Untouched, The Veronicas\nIl. Shake It, Metro Station")).toEqual([
      ["Girlfriend", "Avril Lavigne"],
      ["Untouched", "The Veronicas"],
      ["Shake It", "Metro Station"],
    ]);
  });

  it("does not treat a leading I in an unnumbered title as a marker", () => {
    expect(pairs("I Write Sins Not Tragedies - Panic! at the Disco")).toEqual([
      ["I Write Sins Not Tragedies", "Panic! at the Disco"],
    ]);
  });

  it.each([
    ["comma", "Misery Business, Paramore"],
    ["hyphen", "Misery Business - Paramore"],
    ["en dash", "Misery Business – Paramore"],
    ["em dash", "Misery Business — Paramore"],
    ["by", "Misery Business by Paramore"],
    ["pipe", "Misery Business | Paramore"],
    ["pipe without spaces", "Misery Business|Paramore"],
  ])("splits on a %s", (_, line) => {
    expect(pairs(line)).toEqual([["Misery Business", "Paramore"]]);
  });

  it("splits comma lists on the last comma so titles keep their commas", () => {
    expect(pairs("This Ain't a Scene, It's an Arms Race, Fall Out Boy")).toEqual([
      ["This Ain't a Scene, It's an Arms Race", "Fall Out Boy"],
    ]);
  });

  it("prefers a dash over commas in the title", () => {
    expect(pairs("This Ain't a Scene, It's an Arms Race - Fall Out Boy")).toEqual([
      ["This Ain't a Scene, It's an Arms Race", "Fall Out Boy"],
    ]);
  });

  it("keeps hyphens inside words", () => {
    expect(pairs("Check Yes-Juliet - We The Kings")).toEqual([["Check Yes-Juliet", "We The Kings"]]);
  });

  it("pairs numbered titles with the artist line below", () => {
    const text = [
      "pop punk songs from 2007",
      "1. Thnks fr th Mmrs",
      "Fall Out Boy",
      "2. This Ain't a Scene, It's an Arms Race",
      "Fall Out Boy",
      "3. Misery Business",
      "♥ 2.1K",
      "Paramore",
    ].join("\n");
    const tracks = parseTracks(text);
    expect(tracks.map(({ title, artist }) => [title, artist])).toEqual([
      ["Thnks fr th Mmrs", "Fall Out Boy"],
      ["This Ain't a Scene, It's an Arms Race", "Fall Out Boy"],
      ["Misery Business", "Paramore"],
    ]);
    expect(tracks[0].originalText).toBe("1. Thnks fr th Mmrs\nFall Out Boy");
  });

  it("pairs unnumbered title and artist lines", () => {
    expect(pairs("Misery Business\nParamore\nGirlfriend\nAvril Lavigne")).toEqual([
      ["Misery Business", "Paramore"],
      ["Girlfriend", "Avril Lavigne"],
    ]);
  });

  it("skips header and caption lines in unnumbered inline lists", () => {
    expect(pairs("songs that defined 2007\nMisery Business - Paramore\nGirlfriend - Avril Lavigne\nwho else??")).toEqual([
      ["Misery Business", "Paramore"],
      ["Girlfriend", "Avril Lavigne"],
    ]);
  });

  it("ignores captions under numbered inline items", () => {
    expect(pairs("1. Misery Business, Paramore\n2. Girlfriend, Avril Lavigne\nwhich one is your fav?")).toEqual([
      ["Misery Business", "Paramore"],
      ["Girlfriend", "Avril Lavigne"],
    ]);
  });

  it("joins numbered inline items that wrap onto the next line", () => {
    expect(pairs("5. Dear Maria Count Me In, All Time\nLow\n6. Shake It, Metro Station\nwhich one is your fav?")).toEqual([
      ["Dear Maria Count Me In", "All Time Low"],
      ["Shake It", "Metro Station"],
    ]);
  });

  it("drops a stray symbol left by an emoji OCR couldn't read", () => {
    expect(pairs("2. Misery Business, Paramore &\n10. Walking Disaster, Sum 41 \\g\n11. September - Earth, Wind & Fire")).toEqual([
      ["Misery Business", "Paramore"],
      ["Walking Disaster", "Sum 41"],
      ["September", "Earth, Wind & Fire"],
    ]);
  });

  it("keeps numbered items that have no artist", () => {
    expect(parseTracks("1. Misery Business\n2. Girlfriend, Avril Lavigne\n3. Untouched, The Veronicas")).toEqual([
      { id: "t1", title: "Misery Business", originalText: "1. Misery Business", position: 1 },
      { id: "t2", title: "Girlfriend", artist: "Avril Lavigne", originalText: "2. Girlfriend, Avril Lavigne", position: 2 },
      { id: "t3", title: "Untouched", artist: "The Veronicas", originalText: "3. Untouched, The Veronicas", position: 3 },
    ]);
  });

  it("strips emojis, decorative characters, bullets and hashtags", () => {
    expect(pairs("★ Misery Business ♪ - Paramore 🎵🔥\n• Girlfriend, Avril Lavigne\n→ Shake It - Metro Station\n- Untouched, The Veronicas #fyp")).toEqual([
      ["Misery Business", "Paramore"],
      ["Girlfriend", "Avril Lavigne"],
      ["Shake It", "Metro Station"],
      ["Untouched", "The Veronicas"],
    ]);
  });

  it("reads keycap emoji numbers as list markers", () => {
    expect(pairs("1️⃣ Misery Business, Paramore\n2️⃣ Girlfriend, Avril Lavigne")).toEqual([
      ["Misery Business", "Paramore"],
      ["Girlfriend", "Avril Lavigne"],
    ]);
  });

  it("drops TikTok, Instagram and Reddit UI text", () => {
    const text = [
      "Posted by u/emo_kid 5h",
      "r/poppunk",
      "Misery Business - Paramore",
      "1,204 upvotes",
      "Reply  Share",
      "See translation",
      "12:04",
      "Sponsored",
      "Girlfriend - Avril Lavigne",
    ].join("\n");
    expect(pairs(text)).toEqual([
      ["Misery Business", "Paramore"],
      ["Girlfriend", "Avril Lavigne"],
    ]);
  });

  it("normalizes spacing and smart quotes", () => {
    expect(pairs("   This   Ain’t a Scene,It’s an Arms Race ,   Fall Out Boy  \n“Misery Business” - Paramore")).toEqual([
      ["This Ain't a Scene,It's an Arms Race", "Fall Out Boy"],
      ["Misery Business", "Paramore"],
    ]);
  });

  it("fixes ALL CAPS and all lowercase but preserves intentional spellings", () => {
    expect(pairs("MISERY BUSINESS - PARAMORE\nthis ain't a scene, it's an arms race, fall out boy\nThnks fr th Mmrs - Fall Out Boy")).toEqual([
      ["Misery Business", "Paramore"],
      ["This Ain't A Scene, It's An Arms Race", "Fall Out Boy"],
      ["Thnks fr th Mmrs", "Fall Out Boy"],
    ]);
  });

  describe("other screenshot layouts", () => {
    it("reads an Apple Music now-playing screen", () => {
      expect(parseTracks(fixture("now-playing-apple-music.txt"))).toEqual([
        { id: "t1", title: "Misery Business", artist: "Paramore", originalText: "Misery Business 🅴\nParamore", position: 1 },
      ]);
    });

    it("reads a YouTube Music now-playing screen", () => {
      expect(pairs("Song   Video\nShake It E\nMetro Station\nUp next   Lyrics\n0:47\n-2:13")).toEqual([["Shake It", "Metro Station"]]);
    });

    it("reads an Instagram story music sticker", () => {
      expect(pairs(fixture("story-sticker.txt"))).toEqual([["Girlfriend", "Avril Lavigne"]]);
    });

    it("reads a TikTok sound label and drops original sounds", () => {
      expect(pairs("♫ Shake It - Metro Station")).toEqual([["Shake It", "Metro Station"]]);
      expect(parseTracks("♫ original sound - @poppunkforever")).toEqual([]);
      expect(parseTracks("Original audio · poppunk.daily")).toEqual([]);
    });

    it("reads a Shazam result", () => {
      expect(pairs(fixture("shazam.txt"))).toEqual([["Check Yes Juliet", "We The Kings"]]);
    });

    it("reads an Apple Music playlist, skipping the header, subtitles and durations", () => {
      expect(pairs(fixture("apple-music-playlist.txt"))).toEqual([
        ["Thnks fr th Mmrs", "Fall Out Boy"],
        ["Misery Business", "Paramore"],
        ["Check Yes Juliet", "We The Kings"],
        ["Girlfriend", "Avril Lavigne"],
      ]);
    });
  });
});
