import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/api/auth/youtube/callback/route";
import { GET as login } from "@/app/api/auth/youtube/login/route";
import { POST as logout } from "@/app/api/auth/youtube/logout/route";
import { pkceChallenge } from "@/spotify/auth";
import { completeLogin, getAccessToken, youtubeOAuthCookie, youtubeSessionCookie, type YouTubeSession } from "./auth";

const jar = new Map<string, string>();
const cookieOptions = new Map<string, unknown>();
vi.mock("next/server", async (original) => ({ ...(await original<object>()), connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: unknown) => {
      jar.set(name, value);
      cookieOptions.set(name, options);
    },
    delete: (name: string) => jar.delete(name),
  }),
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
const sentForm = (call: number) => Object.fromEntries(new URLSearchParams(String(fetchMock.mock.calls[call][1]?.body)));
const get = (path: string) => new NextRequest(`http://127.0.0.1:3000${path}`);
const oauth = { state: "state-123", verifier: "verifier-xyz" };
const session: YouTubeSession = {
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresAt: Date.now() + 30_000,
  user: { id: "UC1", displayName: "My Channel" },
};
const tokens = () => json({ access_token: "at", expires_in: 3599, refresh_token: "rt", scope: "s", token_type: "Bearer" });

beforeEach(() => {
  jar.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("login route", () => {
  it("redirects to Google with PKCE, offline access and forced consent, and sets a short-lived cookie", async () => {
    const res = await login();
    const url = new URL(res.headers.get("location") ?? "");
    const stored = await youtubeOAuthCookie.get();
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client.apps.googleusercontent.com",
      response_type: "code",
      redirect_uri: "http://127.0.0.1:3000/api/auth/youtube/callback",
      scope: "https://www.googleapis.com/auth/youtube",
      access_type: "offline",
      prompt: "consent",
      state: stored?.state,
      code_challenge_method: "S256",
      code_challenge: await pkceChallenge(stored?.verifier ?? ""),
    });
    expect(cookieOptions.get("s2s_youtube_oauth")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 600,
    });
  });

  it("redirects with youtube-not-configured without Google credentials", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const res = await login();
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3000/?auth_error=youtube-not-configured");
    expect(jar.has("s2s_youtube_oauth")).toBe(false);
  });
});

describe("completeLogin", () => {
  it("rejects a state mismatch without calling Google", async () => {
    expect(await completeLogin(new URLSearchParams("code=c&state=wrong"), oauth)).toEqual({
      ok: false,
      error: "state-mismatch",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the code with the client secret and PKCE verifier, and reads the channel", async () => {
    fetchMock.mockResolvedValueOnce(tokens()).mockResolvedValueOnce(json({ items: [{ id: "UC1", snippet: { title: "My Channel" } }] }));
    const result = await completeLogin(new URLSearchParams("code=the-code&state=state-123"), oauth);
    expect(result).toMatchObject({
      ok: true,
      session: { accessToken: "at", refreshToken: "rt", user: { id: "UC1", displayName: "My Channel" } },
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://oauth2.googleapis.com/token");
    expect(sentForm(0)).toEqual({
      client_id: "client.apps.googleusercontent.com",
      client_secret: "secret",
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "http://127.0.0.1:3000/api/auth/youtube/callback",
      code_verifier: "verifier-xyz",
    });
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
  });
});

describe("callback route", () => {
  it("sends an account without a channel to /?auth_error=youtube-no-channel", async () => {
    await youtubeOAuthCookie.set(oauth);
    fetchMock.mockResolvedValueOnce(tokens()).mockResolvedValueOnce(json({ kind: "youtube#channelListResponse" }));
    const res = await callback(get("/api/auth/youtube/callback?code=c&state=state-123"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3000/?auth_error=youtube-no-channel");
    expect(jar.has("s2s_youtube_oauth")).toBe(false);
    expect(jar.has("s2s_youtube")).toBe(false);
  });

  it("stores the session and redirects home", async () => {
    await youtubeOAuthCookie.set(oauth);
    fetchMock.mockResolvedValueOnce(tokens()).mockResolvedValueOnce(json({ items: [{ id: "UC1", snippet: { title: "My Channel" } }] }));
    const res = await callback(get("/api/auth/youtube/callback?code=c&state=state-123"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3000/");
    expect(await youtubeSessionCookie.get()).toMatchObject({ refreshToken: "rt", user: { displayName: "My Channel" } });
  });
});

describe("getAccessToken", () => {
  it("refreshes near expiry with the client secret and keeps the refresh token Google does not rotate", async () => {
    await youtubeSessionCookie.set(session);
    fetchMock.mockResolvedValueOnce(json({ access_token: "new-access", expires_in: 3599 }));
    expect(await getAccessToken()).toEqual({ ok: true, token: "new-access", user: session.user });
    expect(sentForm(0)).toEqual({
      client_id: "client.apps.googleusercontent.com",
      client_secret: "secret",
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
    });
    expect(await youtubeSessionCookie.get()).toMatchObject({ accessToken: "new-access", refreshToken: "old-refresh" });
  });

  it("clears the session when the refresh token was revoked or expired (invalid_grant)", async () => {
    await youtubeSessionCookie.set(session);
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    expect(await getAccessToken()).toEqual({ ok: false, reason: "refresh-failed" });
    expect(await youtubeSessionCookie.get()).toBeNull();
  });
});

describe("logout route", () => {
  it("requires a same-origin request", async () => {
    jar.set("s2s_youtube", "x");
    const post = (origin: string) =>
      new Request("http://127.0.0.1:3000/api/auth/youtube/logout", { method: "POST", headers: { origin } });
    expect((await logout(post("https://evil.example"))).status).toBe(403);
    expect(jar.has("s2s_youtube")).toBe(true);
    expect((await logout(post("http://127.0.0.1:3000"))).status).toBe(204);
    expect(jar.has("s2s_youtube")).toBe(false);
  });
});
