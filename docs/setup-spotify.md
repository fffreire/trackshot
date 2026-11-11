# Spotify setup

Use this to run your own instance, or to bring your own app to someone else's instance.

## What you need

- A Spotify account with **Premium**. Since February 2026 the owner of a Development Mode app must have Premium.
- About five minutes.

## Create the app

1. Go to https://developer.spotify.com/dashboard and choose **Create app**.
2. Name it. Spotify's guidelines don't allow "Spotify" in an app name; something like "My trackshot" is fine.
3. Add the redirect URI(s), exactly:

   | Where | Redirect URI |
   | --- | --- |
   | Local | `http://127.0.0.1:3000/api/auth/callback` |
   | Deployed | `https://<your domain>/api/auth/callback` |

   Spotify rejects `localhost`, so always use `127.0.0.1` locally.
4. Under the APIs, select **Web API**. Save.
5. Open **User Management** and add the name and Spotify email of each person who will log in, yourself included. The limit is **5 users**. Anyone not on the list can finish the login but gets a 403, which trackshot reports as `not-allowlisted`.
6. In **Settings**, copy the **Client ID**. Copy the **Client secret** only if you're the host and want no-login search.

## Configure trackshot

| Variable | Needed for |
| --- | --- |
| `SPOTIFY_CLIENT_ID` | Logging in with the instance's app. Leave empty to make every user bring their own. |
| `SPOTIFY_CLIENT_SECRET` | No-login search only (Client Credentials). Never needed for logging in, which uses PKCE. |
| `APP_URL` | Must match the redirect URI's origin, e.g. `http://127.0.0.1:3000`. |

## Bring your own app

Do steps 1 to 6 with the redirect URI of the instance you use, add yourself under User Management, and paste your Client ID (32 characters, `0-9a-f`) into trackshot. Don't paste the secret; it's not needed. Your session then runs on your own app and its 5-user limit.

## Limits worth knowing

- Extended quota (more than 5 users) is only for registered businesses with a launched service, 250k+ monthly active users and presence in key markets. Hobby instances stay in Development Mode.
- A developer account can have up to 25 Client IDs, but they share one quota. A 429 with reason `QUOTA_EXCEEDED` means that shared quota is spent.
- trackshot can read the items of playlists you own or collaborate on, and add to them. Followed playlists show up but aren't editable.
- Search returns at most 10 results per query.
