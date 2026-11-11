import type { ExtractedTrack } from "./types";

type Line = { raw: string; body: string };

// List markers, tolerating OCR reading 1 as I or l: "1.", "1)", "#1", "1 -", "01 ", "l.", "I0."
const NUMBER = /^#?\s*(?:[\dIl|]{1,2}\s*[.):]|\d{1,2}\s*[-–—]\s|\d{1,2}\s)\s*/;
// Track lengths and player scrubber times: "3:31", "-2:10".
const DURATION = /^-?\d{1,2}:\d{2}$/;
const DECORATIVE = /[\p{Extended_Pictographic}\u{1F100}-\u{1F1FF}←-⇿☀-➿⬀-⯿️‍⃣]/gu;
const HASHTAG = /(?:^|\s)#[\p{L}_][\p{L}\d_]*/gu;
const NOISE = [
  /^[^\p{L}]*$/u,
  /^@|^(?:posted by )?[ur]\/\w/i,
  /^(?:[\d.,]+\s*[kmb]?\s*(?:likes?|views?|comments?|shares?|upvotes?|points?|replies)?\s*)+$/i,
  /^\d+\s*(?:[smhdwy]|min|mins|hours?|days?|weeks?|months?|years?)(?:\s+ago)?$/i,
  /^(?:(?:follow|following|for you|friends|reply|share|send message|send|repost|sponsored|see translation|lyrics|airplay|up next|explicit|e|shazam|play full song|play|shuffle|autoplay)\s*)+$/i,
  /^(?:original (?:sound|audio)|playing on)\b/i,
  /^\d+ songs?\b/i,
  /[·•]\s*(?:19|20)\d{2}$/,
];

// Title/artist separators, tried in order:
// 1. the first " - ", "–", "—", "|", "·" or "•" (titles rarely contain these),
// 2. the last " by ",
// 3. the last comma, so commas inside titles stay in the title:
//    "This Ain't a Scene, It's an Arms Race, Fall Out Boy" splits before "Fall Out Boy".
const SEPARATORS = [/^(.+?)(?:\s+-\s+|\s*[–—|·•]\s*)(.+)$/, /^(.+)\s+by\s+(.+)$/i, /^(.+),([^,]+)$/];

const clean = (line: string) =>
  line
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(DECORATIVE, " ")
    .replace(HASHTAG, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*•·]\s+/, "")
    // An emoji OCR couldn't read often ends a line as a stray symbol or two: "Paramore &", "Sum 41 \g".
    .replace(/\s+(?![\p{L}\p{N}]+$)\S{1,2}$/u, "")
    .replace(/\s+(?:E|Explicit)$/, "");

function split(body: string): [string, string?] {
  for (const separator of SEPARATORS) {
    const match = body.match(separator);
    if (match) return [match[1], match[2]];
  }
  return [body];
}

// Title-cases text only when it is ALL CAPS or all lowercase, so spellings like "Thnks fr th Mmrs" survive.
function tidy(text: string) {
  const value = text.trim().replace(/^"(.*)"$/, "$1").trim();
  if (value !== value.toUpperCase() && value !== value.toLowerCase()) return value;
  return value.toLowerCase().replace(/(^|[\s(])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

const fewSeparators = (lines: Line[]) => lines.filter((line) => split(line.body).length === 2).length < lines.length / 2;

// Title and artist on alternating lines. When durations are present (playlists, player scrubbers),
// a row is the two lines right above a duration, which skips headers such as the playlist name.
function pairLines(lines: Line[]): Line[][] {
  const content = lines.filter((line) => !DURATION.test(line.body));
  if (content.length === lines.length) return content.flatMap((line, i) => (i % 2 ? [] : [content.slice(i, i + 2)]));
  const segments: Line[][] = [[]];
  for (const line of lines) {
    if (DURATION.test(line.body)) segments.push([]);
    else segments.at(-1)?.push(line);
  }
  return segments.filter((segment) => segment.length >= 2).map((segment) => segment.slice(-2));
}

// Each entry is [title line] or [title line, artist line].
function toEntries(lines: Line[]): Line[][] {
  const content = lines.filter((line) => !DURATION.test(line.body));
  if (content.some((line) => NUMBER.test(line.body))) {
    // A numbered entry is its numbered line plus the unnumbered lines under it; text before the first number is dropped.
    const groups: Line[][] = [];
    for (const line of content) {
      if (NUMBER.test(line.body)) groups.push([{ ...line, body: line.body.replace(NUMBER, "") }]);
      else groups.at(-1)?.push(line);
    }
    if (fewSeparators(groups.map(([head]) => head))) return groups.map((group) => group.slice(0, 2));
    // In an inline list, unnumbered lines are a wrapped item, except after the last item, where they are a caption.
    return groups.map((group, i) =>
      i < groups.length - 1 ? [{ raw: group.map((line) => line.raw).join("\n"), body: group.map((line) => line.body).join(" ") }] : group.slice(0, 1),
    );
  }
  if (fewSeparators(content)) return pairLines(lines);
  return content.filter((line) => split(line.body).length === 2).map((line) => [line]);
}

export function parseTracks(text: string): ExtractedTrack[] {
  const lines = text
    .split(/\r?\n/)
    .map((raw) => ({ raw: raw.trim(), body: clean(raw) }))
    .filter((line) => DURATION.test(line.body) || !NOISE.some((noise) => noise.test(line.body)));

  return toEntries(lines)
    .map((entry) => {
      const [title, artist] = entry.length === 2 ? [entry[0].body, entry[1].body] : split(entry[0].body);
      return { title: tidy(title), artist: artist ? tidy(artist) : undefined, originalText: entry.map((line) => line.raw).join("\n") };
    })
    .filter((track) => track.title)
    .map((track, i) => ({ id: `t${i + 1}`, ...track, position: i + 1 }));
}
