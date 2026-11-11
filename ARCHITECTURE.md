# Architecture

trackshot is one Next.js app split into three layers. Core knows nothing about HTTP or any music service. Providers know one service each. The web layer wires them to the browser.

```
            browser                          server (route handlers)
 ┌──────────────────────────┐      ┌────────────────────────────────────┐
 │ web UI (src/app)         │ HTTP │ /api/music/[provider]/…            │
 │  core/ocr  (tesseract.js)│─────▶│ /api/auth/…                        │
 │  core/extract            │      │        │                           │
 │  core/match              │      │        ▼                           │
 └──────────────────────────┘      │ providers/registry  (Connector)    │
                                   │   spotify · apple-music · youtube  │
                                   │        │  implements core Provider │
                                   └────────┼───────────────────────────┘
                                            ▼
                                  Spotify / Apple / YouTube APIs

 Phase 2:  MCP server ──▶ core/extract + core/match ──▶ providers (same code)
```

| Layer | Path | What lives there |
| --- | --- | --- |
| core | `src/core` | `types.ts` (the `Provider` contract, `CatalogTrack`, `ImportOutcome`, `ProviderError`), `extract.ts` (`parseTracks`), `ocr.ts` (browser-only), `match.ts` (scoring). No I/O except OCR. |
| providers | `src/providers` | One file per service implementing `Provider`. `registry.ts` holds the `Connector` per service, error-to-HTTP mapping and the `MOCK_PROVIDERS` fakes. |
| auth | `src/spotify`, `src/youtube` | `session.ts`: encrypted cookie helpers used by every provider. `auth.ts`: OAuth with PKCE and token refresh. |
| web | `src/app` | Pages and route handlers. Handlers validate input with Zod, pick a connector, call the provider, return JSON. |

The planned MCP server (Phase 2) is another entry point over the same core and providers. It should not reimplement matching or any service client.

## One screenshot, end to end

1. The browser checks the file (PNG, JPEG or WebP, up to 10 MB) and runs `readImage`, which OCRs it with tesseract.js.
2. `parseTracks(text)` turns the OCR text into ordered `ExtractedTrack`s. The user edits them.
3. `GET /api/music/status` says which services are configured, connected, or available for search without login.
4. For each track and each chosen service, `matchTrack` calls `GET /api/music/[provider]/search` with an `exact` query, then a `loose` one only if nothing scored high. Up to 3 tracks match in parallel.
5. The search route uses the user's session if connected. Otherwise it uses the app's own credentials, rate limited per IP. Otherwise 401.
6. The user picks a playlist (`GET …/playlists`) or creates one (`POST …/playlists`). `GET …/playlists/[id]/track-ids` returns what's already there so the client can skip songs the playlist already has.
7. `POST …/playlists/[id]/tracks` with `{ trackIds, requestId }` adds them and returns one `ImportOutcome` per track, in order.

## Why OCR runs in the browser

Screenshots often contain other people's names, messages and faces. Reading them client-side means the server never receives the image, there's nothing to store or leak, and hosting stays cheap. The cost is a first-run download (about 7 MB) of the tesseract.js engine and English data, served from the app's own `/ocr` folder rather than a CDN, and slower OCR on old phones.

## Why there's no database

Nothing needs to outlive a session. Playlists live in the music service, and tokens live in the user's own cookies, encrypted with AES-GCM using a key derived (HKDF) from `SESSION_SECRET`. Each cookie name is bound as additional data, so one cookie can't be swapped for another. Cookies are httpOnly, `SameSite=Lax`, and `Secure` unless `APP_URL` is a loopback address.

| Cookie | Holds | Lifetime |
| --- | --- | --- |
| `ts_oauth`, `ts_youtube_oauth` | PKCE verifier and state during login | 10 min |
| `ts_session` | Spotify tokens, Client ID, display name | 30 days |
| `ts_youtube` | Google tokens, channel name | 30 days |
| `ts_apple` | Music User Token, storefront | 180 days |

Logout and Apple connect/disconnect are POST/DELETE routes that reject requests whose `Origin` isn't `APP_URL`.

## Matching score

`scoreCandidate` returns a heuristic number from 0 to 1. **It is not a probability.** A 0.9 doesn't mean "90% likely correct"; it means "title and artist are very close and nothing looks off".

```
score = 0.6 × title similarity + 0.4 × best artist similarity − penalties
```

- Similarity is a Dice coefficient on character bigrams after normalizing: accents, case and punctuation are dropped, `&` becomes "and", and anything in brackets, ` - …` suffixes and `feat.` credits are removed. Spaces are ignored, so "Count Me In" ≈ "CountMeIn".
- If no artist was extracted, artist similarity counts as 0.5.
- Penalties: 0.25 for each version mismatch (live, acoustic, remix, karaoke, instrumental, cover, sped up, slowed, demo, re-recorded, language version), either way: you asked for the original and got a live take, or the reverse. 0.03 for a remaster, 0.05 for a compilation album, 0.5 for an unplayable track.

| Constant | Value | Meaning |
| --- | --- | --- |
| `HIGH_THRESHOLD` | 0.85 | Can be auto-selected |
| `FLOOR_THRESHOLD` | 0.5 | Below this, a candidate is dropped |
| `CLEAR_MARGIN` | 0.1 | A rival within this margin makes it ambiguous |

A result is `high` only when the best score is ≥ 0.85 and no other clean candidate is within 0.1, except rivals that are clearly the same recording (shared artist, duration within 3 s). Otherwise it's `ambiguous` with up to 5 candidates, or `unmatched`. Ties go to the earliest release date, which favors the original studio recording. Each candidate carries a `reasons` array (`title exact`, `live version −0.25`, …) so the UI can show why.

YouTube results have no album or ISRC and use upload dates, so they score and rank worse. `findByIsrc` exists on the Spotify and Apple providers for using an ISRC found on one service as a hint on another.

## Import safety

- Nothing is added without an explicit confirm, and the add request is never retried automatically.
- GET requests to Spotify retry on 429 and 5xx, at most twice, only when `Retry-After` is 5 s or less. Apple and YouTube calls are not retried. POSTs are never retried.
- Spotify and Apple add in chunks of 100, YouTube one video at a time. On the first failure the rest are reported as `failed`, so the outcome list always matches the request in order, and nothing runs after a failure. (Apple: if the first chunk fails, the whole request returns an error.)
- A repeated `requestId` within 10 minutes returns 409, so a double click or a resent request can't add the songs twice.
- Providers only append. They never remove or reorder tracks.

## Error mapping

Provider clients throw `ProviderError(kind, message, retryAfterSeconds?)`. `registry.ts` turns it into `{ error: { kind, message, retryAfterSeconds? } }`.

| Kind | HTTP | Typical cause |
| --- | --- | --- |
| `invalid-request` | 400 | Bad query or body |
| `auth`, `not-connected` | 401 | No session, or it expired and refresh failed |
| `forbidden` | 403 | Not allowed to edit, or not on the Spotify allowlist |
| `not-found` | 404 | Unknown provider or playlist |
| `duplicate-request` | 409 | Same `requestId` already submitted |
| `rate-limited` | 429 | Service quota, or the anonymous search limit |
| `not-configured` | 501 | The server lacks that service's credentials |
| `network`, `unknown` | 502 | Service unreachable or returned something unexpected |

## Known limits

- **Per-instance state.** The anonymous search limit (30 per IP per 10 min) and the `requestId` guard are in-memory maps. On serverless hosts each instance keeps its own, so both are best effort. The IP comes from `x-forwarded-for`, which is only trustworthy behind a proxy that sets it.
- **The Apple developer token is public.** MusicKit JS needs it in the browser, so `/api/auth/apple-music/token` serves it to anyone. It has no `origin` claim yet, so another site could reuse it against your Apple quota. It's re-signed every 30 days.
- **YouTube quota** is per Google project and shared by every user of an instance: roughly 5 to 10 screenshots a day in total.
- **Spotify Development Mode** caps each app at 5 users. See the README.
- Anonymous search uses the US market on Spotify and the US storefront on Apple Music.
