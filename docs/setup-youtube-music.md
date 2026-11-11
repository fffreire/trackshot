# YouTube Music setup

There is no official YouTube Music API. trackshot uses the YouTube Data API v3: it searches music videos and adds them to your YouTube playlists, which also show up in YouTube Music.

**Read the quota first.** A Google project gets 10,000 units a day (reset at midnight Pacific), search has its own cap of 100 calls a day, and adding one song costs 50 units. That's roughly 50 to 100 songs matched and 195 songs added a day, or about 5 to 10 screenshots a day, for the whole instance. Use this for personal or self-hosted instances.

## Set up a Google Cloud project

1. Create a project at https://console.cloud.google.com.
2. In **APIs & Services**, then **Library**, enable **YouTube Data API v3**.
3. Configure the **OAuth consent screen**: user type **External**, add the scope `https://www.googleapis.com/auth/youtube`, and leave the app in **Testing**.
4. Add **test users** (up to 100). Each account needs a YouTube channel, or the login fails with a "no channel" error.
5. In **Credentials**, create an **OAuth client ID** of type **Web application** with these redirect URIs:

   | Where | Redirect URI |
   | --- | --- |
   | Local | `http://127.0.0.1:3000/api/auth/youtube/callback` |
   | Deployed | `https://<your domain>/api/auth/youtube/callback` |

6. Optional, for search without login: create an **API key** and restrict it to the YouTube Data API v3.

## Configure trackshot

| Variable | Needed for |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Connecting YouTube Music |
| `GOOGLE_CLIENT_SECRET` | Connecting YouTube Music |
| `YOUTUBE_API_KEY` | Optional. Search without login. |

## Things to know

- In Testing mode, refresh tokens expire after 7 days, so users reconnect weekly. Going public needs Google's OAuth verification and a quota increase audit.
- Matching is weaker than on Spotify or Apple: no ISRC, no album, and the date is the upload date. trackshot prefers official "- Topic" channels and strips tags like "(Official Video)".
- New playlists are created private. Songs are added one at a time and the import stops at the first failure.
- When the quota runs out you get a "daily YouTube API quota" error until midnight Pacific.
