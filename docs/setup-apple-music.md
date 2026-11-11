# Apple Music setup

Apple Music support needs a paid **Apple Developer Program** membership ($99/year). End users need an **Apple Music subscription** to use their library and playlists. Search without login only needs your developer key.

## Create a MusicKit key

1. In https://developer.apple.com/account, go to **Certificates, Identifiers & Profiles**, then **Identifiers**.
2. Add an identifier of type **Media IDs**, enable **MusicKit**, and register it.
3. Go to **Keys** and create a key with **Media Services (MusicKit)** enabled, linked to the Media ID from step 2.
4. Download the `.p8` file. Apple only lets you download it once, so keep it safe.
5. Note the 10-character **Key ID** on the key's page.
6. Find your 10-character **Team ID** under **Membership details**.

## Configure trackshot

| Variable | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Team ID |
| `APPLE_KEY_ID` | Key ID |
| `APPLE_PRIVATE_KEY` | Contents of the `.p8` file. Real newlines or `\n` escapes both work. |

trackshot signs an ES256 developer token from these and re-signs it every 30 days. There's no redirect URI: users connect through Apple's MusicKit JS popup, which opens on a click.

## Things to know

- The developer token is sent to the browser because MusicKit JS needs it, so treat it as public. It has no `origin` claim yet.
- Only playlists Apple marks as editable (`canEdit`) can receive songs. Apple's curated playlists can't.
- Adding to collaborative playlists currently fails with a 500 on Apple's side (FB19992892).
- Songs are appended. Changes can take a moment to show up in the Music app.
- Search without login uses the US storefront. Connected users search their own storefront.
