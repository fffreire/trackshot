# Good first issues

Each section below is one issue: the `##` heading is the title and the `Labels:` line lists its labels, so a script can create them.

## Export matched songs as text or CSV

Labels: enhancement, good first issue

**Why.** People without a connected account (no-login mode) can only copy links. A file is easier to keep or import elsewhere.

**Where.** A small pure function in `src/core` that turns `TrackMatch[]` into CSV, plus a download button in the match step (`src/app`).

**Acceptance criteria**
- CSV columns: position, title, artist, matched title, matched artists, service, url.
- Unmatched songs are included with empty match columns.
- Values with commas, quotes or newlines are escaped correctly.
- Unit tests for the function. No new dependency.

## Add OCR fixtures for Reddit threads and YouTube comments

Labels: tests, good first issue

**Why.** The parser is tested on TikTok-style lists, Apple Music, Shazam and story stickers, but not on Reddit or YouTube comment screenshots, which have usernames, vote counts and "Reply" buttons between songs.

**Where.** `src/core/fixtures/` (plain `.txt` OCR output) and `src/core/extract.test.ts`.

**Acceptance criteria**
- At least one Reddit and one YouTube comments fixture, from real screenshots with usernames anonymized.
- Tests assert the exact titles, artists and order.
- If the parser needs a fix, keep it small and keep every existing test passing.

## Handle "Artist · Title" order on Instagram

Labels: enhancement, matching

**Why.** `parseTracks` treats `A · B` as title then artist. Some Instagram music stickers show the artist first, so the search is sent with the fields swapped and the match is weak or missing.

**Where.** `src/core/match.ts` (`matchTrack`), possibly a swapped query when the normal ones find nothing above `HIGH_THRESHOLD`.

**Acceptance criteria**
- A swapped title/artist pair is matched without the user editing it.
- No extra searches when the first query already scores high.
- Tests in `src/core/match.test.ts` with fixture tracks for both orders.

## Add an origin claim to the Apple Music developer token

Labels: security, apple-music, good first issue

**Why.** The developer token is served to the browser and can be reused from any site. Apple supports an `origin` claim that limits where it works.

**Where.** `appleDeveloperToken()` in `src/providers/apple-music.ts`.

**Acceptance criteria**
- The JWT payload includes `origin` with the origin of `APP_URL`.
- Server-side calls (no browser origin) still work. Verify against Apple's docs and note the result in the PR.
- Test in `src/providers/apple-music.test.ts` decoding the payload.

## Import several screenshots at once

Labels: enhancement, help wanted

**Why.** Long lists are often split over a carousel of 3 to 10 images.

**Where.** Upload step in `src/app`, reusing `validateImage` and `readImage` from `src/core/ocr.ts`.

**Acceptance criteria**
- Several images can be picked or dropped together.
- OCR runs one image at a time, with progress per image.
- Songs keep the order of the images, then the order within each image.
- An invalid image is reported without dropping the others.

## Translate the UI copy

Labels: enhancement, i18n

**Why.** Music lists circulate in every language, and the UI is English only.

**Where.** UI strings in `src/app`.

**Acceptance criteria**
- Strings are collected in one place per language, using the browser language with English as fallback.
- At least one more language, by a fluent speaker.
- No i18n framework unless the PR explains why plain objects aren't enough.
- OCR language stays English; that's a separate issue.

## Spike: a Tidal provider

Labels: spike, provider

**Why.** Tidal is a common request. Before writing code we need to know whether its public API allows catalog search, playlist creation and adding tracks, with what auth and limits.

**Where.** Write-up in the PR or issue. If it's viable, a draft `src/providers/tidal.ts` following "Adding a provider" in CONTRIBUTING.md.

**Acceptance criteria**
- A short write-up: auth flow, endpoints for each `Provider` method, ISRC support, quotas, developer-program cost, terms that affect an open-source app.
- Links to the official docs used.
- Recommendation: build it, or not and why.

## Accept shared screenshots as a PWA share target

Labels: enhancement, pwa

**Why.** On Android, sharing a screenshot straight into trackshot is faster than saving it and uploading it.

**Where.** A web app manifest with `share_target`, and a service worker that receives the shared file and hands it to the upload step in `src/app`.

**Acceptance criteria**
- trackshot shows up in the Android share sheet once installed.
- The shared image is handled entirely in the browser by the service worker. It must never be sent to the server, same as a normal upload.
- If the OCR data isn't cached yet, it downloads as it does for a normal upload.
- Manual test steps described in the PR.
