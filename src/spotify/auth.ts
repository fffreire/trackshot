import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sessionCookie, type OAuthState, type Session } from "./session";

const SCOPES = "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export type AuthError =
  | "no-client-id"
  | "invalid-client-id"
  | "access-denied"
  | "authorize-failed"
  | "login-expired"
  | "state-mismatch"
  | "token-exchange-failed"
  | "not-allowlisted"
  | "profile-failed";

export type AccessTokenResult =
  | { ok: true; token: string; clientId: string; user: Session["user"] }
  | { ok: false; reason: "not-connected" | "expired" | "refresh-failed" };

const tokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});
const profileSchema = z.object({ id: z.string(), display_name: z.string().nullish() });

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function pkceChallenge(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function appUrl(path = "/") {
  if (!process.env.APP_URL) throw new Error("APP_URL must be set");
  return new URL(path, process.env.APP_URL);
}

const redirectUri = () => appUrl("/api/auth/callback").toString();

export async function startLogin(
  byoClientId: string | null,
): Promise<{ ok: true; url: string; oauth: OAuthState } | { ok: false; error: AuthError }> {
  if (byoClientId !== null && !/^[0-9a-f]{32}$/i.test(byoClientId)) return { ok: false, error: "invalid-client-id" };
  const clientId = byoClientId ?? process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) return { ok: false, error: "no-client-id" };

  const oauth = { state: randomToken(), verifier: randomToken(), clientId };
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state: oauth.state,
    code_challenge_method: "S256",
    code_challenge: await pkceChallenge(oauth.verifier),
  }).toString();
  return { ok: true, url: url.toString(), oauth };
}

async function requestToken(params: Record<string, string>) {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const tokens = tokenSchema.safeParse(res.ok ? await res.json() : null);
    return tokens.success ? { ok: true as const, tokens: tokens.data } : { ok: false as const, status: res.status };
  } catch {
    return { ok: false as const, status: 0 };
  }
}

const sameString = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function completeLogin(
  params: URLSearchParams,
  oauth: OAuthState | null,
): Promise<{ ok: true; session: Session } | { ok: false; error: AuthError }> {
  const error = params.get("error");
  if (error) return { ok: false, error: error === "access_denied" ? "access-denied" : "authorize-failed" };
  if (!oauth) return { ok: false, error: "login-expired" };
  if (!sameString(params.get("state") ?? "", oauth.state)) return { ok: false, error: "state-mismatch" };
  const code = params.get("code");
  if (!code) return { ok: false, error: "authorize-failed" };

  const exchanged = await requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: oauth.clientId,
    code_verifier: oauth.verifier,
  });
  if (!exchanged.ok || !exchanged.tokens.refresh_token) return { ok: false, error: "token-exchange-failed" };
  const { access_token, expires_in, refresh_token } = exchanged.tokens;

  const me = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${access_token}` } }).catch(
    () => null,
  );
  if (me?.status === 403) return { ok: false, error: "not-allowlisted" };
  const profile = profileSchema.safeParse(me?.ok ? await me.json().catch(() => null) : null);
  if (!profile.success) return { ok: false, error: "profile-failed" };

  return {
    ok: true,
    session: {
      clientId: oauth.clientId,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000,
      user: { id: profile.data.id, displayName: profile.data.display_name || profile.data.id },
    },
  };
}

export async function getAccessToken(): Promise<AccessTokenResult> {
  const session = await sessionCookie.get();
  if (!session) return { ok: false, reason: "not-connected" };
  const { clientId, user } = session;
  if (session.expiresAt - Date.now() > 60_000) return { ok: true, token: session.accessToken, clientId, user };

  const refreshed = await requestToken({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: clientId,
  });
  if (!refreshed.ok && refreshed.status !== 400) return { ok: false, reason: "expired" };
  if (!refreshed.ok) {
    await sessionCookie.delete();
    return { ok: false, reason: "refresh-failed" };
  }

  const { access_token, expires_in, refresh_token } = refreshed.tokens;
  await sessionCookie.set({
    ...session,
    accessToken: access_token,
    refreshToken: refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + expires_in * 1000,
  });
  return { ok: true, token: access_token, clientId, user };
}
