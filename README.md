# trackshot

Screenshot any song or list. Get it in your playlist.

trackshot reads a screenshot of songs, finds each one on Spotify, Apple Music or YouTube Music, and adds the ones you approve to a playlist. It's a small Next.js app with no database, and the screenshot never leaves your browser.

<!-- Screenshot or GIF of the full flow goes here. -->

1. **Drop a screenshot.** Text is read in your browser.
2. **Check the list.** Songs stay in screenshot order. Fix any title or artist the OCR got wrong.
3. **Review the matches.** Each song shows its best match and the alternatives. Unsure matches are flagged, not guessed.
4. **Pick a playlist and confirm.** Nothing is added until you say so. You get a summary of what was added and what failed.

## What screenshots work

| Screenshot | Example |
| --- | --- |
| Lists in posts | TikTok or Instagram carousels, Reddit threads, numbered lists in captions |
| Another app's now-playing screen | Apple Music, a playlist screen with track lengths |
| Shazam results | Title and artist on separate lines |
| Story stickers | `♫ Girlfriend · Avril Lavigne` |

The parser handles `Title - Artist`, `Title by Artist`, `Title, Artist`, title and artist on alternate lines, and list numbers OCR misreads (`l.` for `1.`). It drops likes, timestamps, handles, hashtags and player buttons. You can always edit the list before matching.

## Destinations

| | Spotify | Apple Music | YouTube Music |
| --- | --- | --- | --- |
| Find songs and copy links | Yes | Yes | Yes |
| Add to an existing playlist | Playlists you own or collaborate on | Library playlists marked editable | Your YouTube playlists |
| Create a playlist | Yes (private) | Yes | Yes (private) |
| Users need | A Spotify account allowlisted on the app (see below) | An Apple Music subscription | A Google account with a YouTube channel |
| The host needs | A Spotify developer app, owner on Premium | Apple Developer Program ($99/yr) | A Google Cloud project |
| Matching quality | Good (ISRC, album, duration) | Good (ISRC, album, duration) | Weaker: no ISRC or album, video titles vary |

## Read this first: platform limits

These limits come from the music services, not from trackshot, and they decide how you can run it.

**Spotify.** New apps run in Development Mode: the app owner needs Spotify Premium, and at most **5 users** can log in, each added by email in the developer dashboard. Anyone else can complete the Spotify login but then gets a 403. Extended quota is only granted to registered businesses with a launched service and **250k+ monthly active users**. So a public hosted instance cannot connect everyone, and this project can't fix that. That's why the two other modes exist:

- **No-login mode** uses the host's app credentials to search, so anyone can match songs and copy links, with a per-IP limit (30 searches per 10 minutes).
- **Bring your own app** lets you create your own free Spotify app and paste its Client ID. You are then the owner of your own 5-user app. No secret is needed (PKCE).

**YouTube.** The YouTube Data API gives each Google project 10,000 units a day, and search has its own cap of 100 calls a day. Adding a song costs 50 units. In practice one project handles about 5 to 10 screenshots a day **in total, for all users**. YouTube Music is best for self-hosted personal use. While the Google app stays in Testing mode, only up to 100 listed test users can connect, and they have to reconnect every 7 days.

**Apple Music.** The host needs the Apple Developer Program ($99/year) to sign MusicKit tokens. Users need an Apple Music subscription to use playlists.

## Three ways to use it

**1. No login: copy links.** Needs nothing from you if the host configured search credentials.

1. Open the app and drop a screenshot.
2. Review the list and the matches.
3. Use **Copy links** and paste them where you want. Tip: Spotify desktop usually accepts pasted `open.spotify.com` track links straight into a playlist (not guaranteed).

**2. Connect with the hosted app.** Only works if the host added your email to their Spotify app (5 users max) or your Google account as a test user.

1. Connect Spotify, Apple Music or YouTube Music.
2. Drop a screenshot, review, pick or create a playlist, confirm.

**3. Bring your own Spotify app.** For everyone else. Takes about five minutes and needs Spotify Premium.

1. Follow [docs/setup-spotify.md](docs/setup-spotify.md) to create an app and add the redirect URI of the instance you use (for a hosted instance, `https://<its domain>/api/auth/callback`).
2. Add your own Spotify email under User Management.
3. Copy the app's Client ID (32 characters, never the secret) and paste it when trackshot asks for it.
4. Log in. Your session uses your app from then on.

## Quick start

Needs Node.js 22.

```sh
git clone https://github.com/fffreire/snap2spotify.git trackshot
cd trackshot
npm ci
cp .env.example .env.local
```

Set `SESSION_SECRET` in `.env.local` (`openssl rand -base64 32`), then:

```sh
npm run dev -- -H 127.0.0.1
```

Open http://127.0.0.1:3000 (not `localhost`: Spotify rejects it as a redirect URI, and the cookies are tied to `APP_URL`).

**Try it without any accounts.** Set `MOCK_PROVIDERS=1` in `.env.local`. All three services are replaced by in-memory fakes with a fixed catalog and sample playlists, and logging in creates a fake session. Nothing touches a real service.

To connect real services, follow the setup guide for each one: [Spotify](docs/setup-spotify.md), [Apple Music](docs/setup-apple-music.md), [YouTube Music](docs/setup-youtube-music.md). To put it online, see [docs/deploy.md](docs/deploy.md).

## Privacy

- The screenshot is read with [tesseract.js](https://github.com/naptha/tesseract.js) in your browser and never uploaded. On first use tesseract.js downloads its engine and English language data from a public CDN.
- Only song titles and artists go to the server, which passes them to the music service you search.
- Tokens are kept only in encrypted, httpOnly cookies (AES-GCM). There is no database, no analytics and no server-side log of your songs.
- Apple Music connects through Apple's MusicKit script, loaded from Apple's CDN.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (add `-- -H 127.0.0.1`) |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `next typegen` and `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest), all network calls mocked |
| `npm run e2e` | Playwright end-to-end tests against `MOCK_PROVIDERS=1` |

## Roadmap

- **MCP server**: let AI agents run "add the songs in this image to my playlist" with the user's authorization, reusing the same core and providers ([ARCHITECTURE.md](ARCHITECTURE.md)).
- Export matches as text or CSV.
- Batch import of several screenshots.
- Share sheet / PWA share target.

Smaller, well-scoped tasks are in [docs/good-first-issues.md](docs/good-first-issues.md). See [CONTRIBUTING.md](CONTRIBUTING.md) to help.

## License

[MIT](LICENSE).

Spotify, Apple Music and YouTube are trademarks of their respective owners. trackshot is an independent open-source project and is not affiliated with, endorsed or sponsored by Spotify, Apple or Google.
