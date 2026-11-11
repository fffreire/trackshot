import { z } from "zod";
import { appUrl, pkceChallenge, randomToken, requestToken, sameString } from "@/spotify/auth";
import { cookie } from "@/spotify/session";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

const oauthSchema = z.object({ state: z.string(), verifier: z.string() });
const sessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  user: z.object({ id: z.string(), displayName: z.string() }),
});
export type YouTubeOAuthState = z.infer<typeof oauthSchema>;
export type YouTubeSession = z.infer<typeof sessionSchema>;

export const youtubeOAuthCookie = cookie("s2s_youtube_oauth", oauthSchema, 10 * 60);
export const youtubeSessionCookie = cookie("s2s_youtube", sessionSchema, 30 * 24 * 60 * 60);

export type YouTubeAuthError =
  | "not-configured"
  | "access-denied"
  | "authorize-failed"
  | "login-expired"
  | "state-mismatch"
  | "token-exchange-failed"
  | "no-channel"
  | "profile-failed";

const channelsSchema = z.object({
  items: z.array(z.object({ id: z.string(), snippet: z.object({ title: z.string() }) })).optional(),
});

const credentials = () => {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
  return id && secret ? { client_id: id, client_secret: secret } : null;
};

const redirectUri = () => appUrl("/api/auth/youtube/callback").toString();

export async function startLogin(): Promise<
  { ok: true; url: string; oauth: YouTubeOAuthState } | { ok: false; error: YouTubeAuthError }
> {
  const client = credentials();
  if (!client) return { ok: false, error: "not-configured" };

  const oauth = { state: randomToken(), verifier: randomToken() };
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: "https://www.googleapis.com/auth/youtube",
    access_type: "offline",
    prompt: "consent",
    state: oauth.state,
    code_challenge_method: "S256",
    code_challenge: await pkceChallenge(oauth.verifier),
  }).toString();
  return { ok: true, url: url.toString(), oauth };
}

export async function completeLogin(
  params: URLSearchParams,
  oauth: YouTubeOAuthState | null,
): Promise<{ ok: true; session: YouTubeSession } | { ok: false; error: YouTubeAuthError }> {
  const error = params.get("error");
  if (error) return { ok: false, error: error === "access_denied" ? "access-denied" : "authorize-failed" };
  if (!oauth) return { ok: false, error: "login-expired" };
  if (!sameString(params.get("state") ?? "", oauth.state)) return { ok: false, error: "state-mismatch" };
  const code = params.get("code");
  if (!code) return { ok: false, error: "authorize-failed" };
  const client = credentials();
  if (!client) return { ok: false, error: "not-configured" };

  const exchanged = await requestToken(TOKEN_URL, {
    ...client,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: oauth.verifier,
  });
  if (!exchanged.ok || !exchanged.tokens.refresh_token) return { ok: false, error: "token-exchange-failed" };
  const { access_token, expires_in, refresh_token } = exchanged.tokens;

  const me = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${access_token}` },
  }).catch(() => null);
  const channels = channelsSchema.safeParse(me?.ok ? await me.json().catch(() => null) : null);
  if (!channels.success) return { ok: false, error: "profile-failed" };
  const channel = channels.data.items?.[0];
  if (!channel) return { ok: false, error: "no-channel" };

  return {
    ok: true,
    session: {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000,
      user: { id: channel.id, displayName: channel.snippet.title },
    },
  };
}

export async function getAccessToken(): Promise<
  | { ok: true; token: string; user: YouTubeSession["user"] }
  | { ok: false; reason: "not-connected" | "expired" | "refresh-failed" }
> {
  const session = await youtubeSessionCookie.get();
  const client = credentials();
  if (!session || !client) return { ok: false, reason: "not-connected" };
  if (session.expiresAt - Date.now() > 60_000) return { ok: true, token: session.accessToken, user: session.user };

  const refreshed = await requestToken(TOKEN_URL, {
    ...client,
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });
  if (!refreshed.ok && refreshed.status !== 400) return { ok: false, reason: "expired" };
  if (!refreshed.ok) {
    await youtubeSessionCookie.delete();
    return { ok: false, reason: "refresh-failed" };
  }

  const { access_token, expires_in, refresh_token } = refreshed.tokens;
  await youtubeSessionCookie.set({
    ...session,
    accessToken: access_token,
    refreshToken: refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + expires_in * 1000,
  });
  return { ok: true, token: access_token, user: session.user };
}
