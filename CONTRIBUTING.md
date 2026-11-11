# Contributing

Thanks for helping. Small, focused PRs get merged fastest.

## Setup

```sh
npm ci
cp .env.example .env.local
```

Set `SESSION_SECRET` (`openssl rand -base64 32`) and `MOCK_PROVIDERS=1`, then run `npm run dev -- -H 127.0.0.1` and open http://127.0.0.1:3000.

With `MOCK_PROVIDERS=1` every service is an in-memory fake backed by `src/core/fixtures/spotify-search.ts`, with a set of sample playlists (one editable, one followed, more to scroll). Logging in creates a fake session. You don't need any developer account to work on the UI, parsing or matching.

## Checks

```sh
npm run typecheck
npm run lint
npm test          # Vitest, fast, all fetches mocked
npm run e2e       # Playwright, builds the app and runs it with MOCK_PROVIDERS=1
```

CI runs all four on every PR. Run `npx playwright install chromium` once before your first `e2e`.

**Never test against real accounts or real services in CI or in unit tests.** Mock `fetch` (see `src/providers/*.test.ts`). If you try something by hand against a real account, use a throwaway playlist.

## Code principles

- The least code that stays readable. Delete before you add.
- No abstraction for a single use: no one-off helpers, wrapper components or generic layers.
- Functions, not classes. `ProviderError` is the only class.
- Strict TypeScript, no `any`. Prefer discriminated unions (`{ ok: true, … } | { ok: false, reason }`) to boolean flags.
- Validate everything from outside (requests, API responses) with Zod.
- Native `fetch` and Web Crypto. No SDKs for the music services.
- Comments explain why, not what. No TODOs or placeholder code.
- Follow existing patterns before inventing new ones.
- This is Next.js 16. If you touch route handlers, params or cookies, read `node_modules/next/dist/docs/01-app/` first; it differs from older versions.

## Adding a provider

1. Add the id to `ProviderId` in `src/core/types.ts`.
2. Create `src/providers/<name>.ts` with a factory that returns a `Provider` (search, listPlaylists, playlistTrackIds, createPlaylist, addTracks, optionally findByIsrc). Map HTTP errors to `ProviderError` kinds, parse responses with Zod, and in `addTracks` return one outcome per track in order and stop at the first failure.
3. Export a `Connector` from the same file: `configured()`, `user()`, `anonymous()`, `status()`. Store tokens with the `cookie()` helper from `src/spotify/session.ts`, using a `ts_` name. Don't add another crypto module.
4. Add one line to `connectors` in `src/providers/registry.ts` (and to the mock list).
5. Add OAuth routes under `src/app/api/auth/<name>/` if the service needs them.
6. Write `src/providers/<name>.test.ts` with a mocked `fetch`: search mapping, pagination, error kinds, partial import failure.
7. Add `docs/setup-<name>.md` and the env vars to `.env.example`.

The shared `/api/music/[provider]/…` routes pick the new provider up automatically.

## Pull requests

- One change per PR. A refactor and a feature are two PRs.
- When several PRs touch the same shared files (`registry.ts`, `types.ts`, `.env.example`), stack them: branch each from the previous one and set its base to that branch, so they don't all conflict with each other.
- [Conventional commits](https://www.conventionalcommits.org/): `feat(spotify): …`, `fix(match): …`, `docs: …`, `test: …`, `refactor: …`, `chore: …`.
- Say what you tested. For matching or parsing changes, add a fixture or test case that shows the problem.
- Starting points: [docs/good-first-issues.md](docs/good-first-issues.md).
