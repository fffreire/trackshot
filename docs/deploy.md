# Deploying

Before you deploy publicly, read the platform limits in the [README](../README.md#read-this-first-platform-limits). A public instance can offer no-login search to anyone, but only the 5 people on your Spotify allowlist (and your Google test users) can connect accounts. Everyone else needs to bring their own Spotify app.

## Vercel

1. Import the repository in Vercel. The defaults (Next.js, `npm run build`) work.
2. Add the environment variables for **Production**:

   | Variable | Value |
   | --- | --- |
   | `APP_URL` | Your production URL over https, e.g. `https://trackshot.example.com`. No trailing path. |
   | `SESSION_SECRET` | 32+ random characters: `openssl rand -base64 32` |
   | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Optional, see [setup-spotify.md](setup-spotify.md) |
   | `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Optional, see [setup-apple-music.md](setup-apple-music.md) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY` | Optional, see [setup-youtube-music.md](setup-youtube-music.md) |

   Never set `MOCK_PROVIDERS` in production.
3. Add the production redirect URIs to each service you enabled:

   | Service | Redirect URI |
   | --- | --- |
   | Spotify | `https://<your domain>/api/auth/callback` |
   | YouTube (Google OAuth client) | `https://<your domain>/api/auth/youtube/callback` |
   | Apple Music | None (MusicKit popup) |

4. Deploy and open `/api/music/status` to check which services report `configured`.

Notes:

- `APP_URL` builds every redirect URI and is checked against the `Origin` header on logout and Apple connect. If it doesn't match the URL people actually use, logins and logouts fail. Preview deployments have other URLs, so either give them their own `APP_URL` and redirect URIs, or don't use OAuth there.
- Changing `SESSION_SECRET` signs everyone out, since existing cookies can't be decrypted anymore.
- A service with no credentials is simply reported as not configured. You can enable services one at a time.

## Self-hosting

```sh
npm ci
npm run build
APP_URL=https://music.example.com SESSION_SECRET=… npm start -- -H 0.0.0.0 -p 3000
```

Put it behind a reverse proxy that terminates TLS and sets `X-Forwarded-For`. Cookies are marked `Secure` unless `APP_URL` is `http://127.0.0.1`, `http://localhost` or `http://[::1]`, so plain http on any other host won't keep sessions.

## Per-instance caveats

- The no-login search limit (30 searches per IP per 10 minutes) and the duplicate import guard (same `requestId` within 10 minutes) are kept in memory. On Vercel each serverless instance has its own copy, so they're best effort. A single self-hosted process enforces them reliably, until it restarts.
- The client IP comes from `X-Forwarded-For` or `X-Real-IP`. Without a proxy that overwrites these headers, clients can spoof them and get around the search limit.
- The YouTube quota and the Spotify allowlist are per Google project and per Spotify app, shared by every user of the instance.
- The Apple developer token is served to browsers and is effectively public.
