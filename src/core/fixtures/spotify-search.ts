import type { CatalogTrack, ExtractedTrack, SearchQuery } from "../types";

function track(
  id: string,
  name: string,
  artists: string[],
  album: string,
  releaseDate: string,
  type: "album" | "single" | "compilation",
  durationMs: number,
  isPlayable = true,
): CatalogTrack {
  return {
    provider: "spotify",
    id,
    uri: `spotify:track:${id}`,
    url: `https://open.spotify.com/track/${id}`,
    name,
    artists,
    album: { name: album, releaseDate, type },
    durationMs,
    isPlayable,
  };
}

/** The list from SPEC section 13, as the extractor would produce it (note: no comma in "Dear Maria"). */
export const acceptanceList: ExtractedTrack[] = [
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
].map(([title, artist], position) => ({
  id: `x${position + 1}`,
  title,
  artist,
  originalText: `${position + 1}. ${title}, ${artist}`,
  position,
}));

/** Track id of the original studio recording each acceptance song should match. */
export const expectedStudioIds = [
  "fob-mmrs",
  "pmr-misery",
  "wtk-juliet",
  "blg-escape",
  "atl-maria",
  "ms-shake-album",
  "avril-gf",
  "vrn-untouched-single",
  "fob-arms",
  "s41-walking",
];

/** Fake `/v1/search` results keyed by the extracted title. Each list mixes the right cut with realistic traps. */
export const searchResults: Record<string, CatalogTrack[]> = {
  "Thnks fr th Mmrs": [
    track("fob-mmrs-live", "Thnks fr th Mmrs - Live", ["Fall Out Boy"], "Live in Phoenix", "2008-04-01", "album", 221000),
    track("fob-mmrs", "Thnks fr th Mmrs", ["Fall Out Boy"], "Infinity On High", "2007-02-05", "album", 203000),
  ],
  "Misery Business": [
    track("pmr-misery-remaster", "Misery Business - 2017 Remaster", ["Paramore"], "RIOT! (Remastered)", "2017-06-12", "album", 211500),
    track("pmr-misery", "Misery Business", ["Paramore"], "RIOT!", "2007-06-12", "album", 211520),
    track(
      "kar-misery",
      "Misery Business (Originally Performed by Paramore) [Karaoke Version]",
      ["Sing2Music"],
      "Pop Punk Karaoke Hits",
      "2015-01-01",
      "compilation",
      212000,
    ),
  ],
  "Check Yes Juliet": [
    track("wtk-juliet", "Check Yes Juliet", ["We The Kings"], "We The Kings", "2007-10-02", "album", 222000),
    track("wtk-juliet-acoustic", "Check Yes Juliet - Acoustic", ["We The Kings"], "Stripped", "2011-05-10", "album", 215000),
  ],
  "The Great Escape": [
    track("pink-escape", "The Great Escape", ["P!nk"], "The Truth About Love", "2012-09-14", "album", 220000),
    track("blg-escape-deluxe", "The Great Escape", ["Boys Like Girls"], "Boys Like Girls (Deluxe Edition)", "2008-03-11", "album", 206000),
    track("blg-escape", "The Great Escape", ["Boys Like Girls"], "Boys Like Girls", "2006-08-22", "album", 206000),
  ],
  "Dear Maria Count Me In": [
    track("atl-maria-live", "Dear Maria, Count Me In - Live", ["All Time Low"], "Straight to DVD", "2010-05-04", "album", 199000),
    track("atl-maria", "Dear Maria, Count Me In", ["All Time Low"], "So Wrong, It's Right", "2007-09-25", "album", 182000),
    track("atl-maria-acoustic", "Dear Maria, Count Me In - Acoustic", ["All Time Low"], "Dear Maria, Count Me In (Acoustic)", "2012-01-20", "single", 190000),
  ],
  "Shake It": [
    track("ms-shake-single", "Shake It", ["Metro Station"], "Shake It", "2008-01-15", "single", 179000),
    track("ms-shake-album", "Shake It", ["Metro Station"], "Metro Station", "2007-09-18", "album", 179000),
    track("ts-shake", "Shake It Off (Taylor's Version)", ["Taylor Swift"], "1989 (Taylor's Version)", "2023-10-27", "album", 219000),
  ],
  Girlfriend: [
    track("kar-gf", "Girlfriend (Made Famous by Avril Lavigne) [Karaoke Version]", ["Party Tyme Karaoke"], "Karaoke Hits 2007", "2008-01-01", "compilation", 216000),
    track("avril-gf-jp", "Girlfriend - Japanese Version", ["Avril Lavigne"], "Girlfriend (Japanese Version)", "2007-05-02", "single", 216000),
    track("avril-gf", "Girlfriend", ["Avril Lavigne"], "The Best Damn Thing", "2007-04-17", "album", 216000),
    track("puth-gf", "Girlfriend", ["Charlie Puth"], "Girlfriend", "2020-06-24", "single", 175000),
  ],
  Untouched: [
    track("vrn-untouched-album", "Untouched", ["The Veronicas"], "Hook Me Up", "2007-10-26", "album", 255000, false),
    track("vrn-untouched-single", "Untouched", ["The Veronicas"], "Untouched", "2007-11-12", "single", 255000),
  ],
  "This Ain't a Scene, It's an Arms Race": [
    track("fob-arms", "This Ain't A Scene, It's An Arms Race", ["Fall Out Boy"], "Infinity On High", "2007-02-05", "album", 212000),
    track("fob-arms-live", "This Ain't A Scene, It's An Arms Race - Live", ["Fall Out Boy"], "Live in Phoenix", "2008-04-01", "album", 230000),
  ],
  "Walking Disaster": [
    track("s41-walking-best", "Walking Disaster", ["Sum 41"], "8 Years of Blood, Sake and Tears: The Best of Sum 41", "2008-11-26", "compilation", 289000),
    track("s41-walking", "Walking Disaster", ["Sum 41"], "Underclass Hero", "2007-07-24", "album", 289000),
  ],
  "Hey There Delilah": [
    track("pwt-delilah-2003", "Hey There Delilah", ["Plain White T's"], "All That We Needed", "2003-01-01", "album", 232000),
    track("pwt-delilah-2006", "Hey There Delilah", ["Plain White T's"], "Every Second Counts", "2006-09-19", "album", 245000),
  ],
  "Song That Does Not Exist": [
    track("noise-1", "Basement", ["Some Band"], "Rooms", "2019-01-01", "album", 200000),
    track("noise-2", "Unknown", ["Another Artist"], "Mystery", "2015-01-01", "single", 180000),
  ],
};

export async function fakeSearch(query: SearchQuery): Promise<CatalogTrack[]> {
  return Object.entries(searchResults).find(([title]) => query.title.includes(title))?.[1] ?? [];
}
