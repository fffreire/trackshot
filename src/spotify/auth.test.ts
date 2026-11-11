import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeLogin, getAccessToken, pkceChallenge, startLogin } from "./auth";
import { decrypt, encrypt, sessionCookie, type OAuthState, type Session } from "./session";
import { z } from "zod";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));

const SECRET = "a".repeat(32);
const BYO = "0123456789abcdef0123456789ABCDEF";
const oauth: OAuthState = { state: "state-123", verifier: "verifier-xyz", clientId: BYO };
const session: Session = {
  clientId: BYO,
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresAt: Date.now() + 30_000,
  user: { id: "u1", displayName: "User One" },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
const sentForm = (call: number) => new URLSearchParams(String(fetchMock.mock.calls[call][1]?.body));

beforeEach(() => {
  jar.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("SPOTIFY_CLIENT_ID", "f".repeat(32));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PKCE", () => {
  it("matches the RFC 7636 Appendix B vector", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("session encryption", () => {
  const schema = z.object({ a: z.number() });

  it("round-trips", async () => {
    expect(await decrypt(await encrypt({ a: 1 }, "c"), "c", schema)).toEqual({ a: 1 });
  });

  it("rejects a tampered cookie", async () => {
    const token = await encrypt({ a: 1 }, "c");
    const flipped = Buffer.from(token, "base64url");
    flipped[flipped.length - 1] ^= 1;
    expect(await decrypt(flipped.toString("base64url"), "c", schema)).toBeNull();
    expect(await decrypt("garbage", "c", schema)).toBeNull();
  });

  it("rejects a cookie sealed under another name", async () => {
    expect(await decrypt(await encrypt({ a: 1 }, "c"), "other", schema)).toBeNull();
  });

  it("rejects a cookie encrypted with a different secret", async () => {
    const token = await encrypt({ a: 1 }, "c");
    vi.stubEnv("SESSION_SECRET", "b".repeat(32));
    expect(await decrypt(token, "c", schema)).toBeNull();
  });

  it("fails loudly when SESSION_SECRET is missing or short", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    await expect(encrypt({ a: 1 }, "c")).rejects.toThrow("SESSION_SECRET");
  });
});

describe("startLogin", () => {
  it("rejects a BYO clientId with an invalid format", async () => {
    expect(await startLogin("not-a-client-id")).toEqual({ ok: false, error: "invalid-client-id" });
    expect(await startLogin(`${BYO}0`)).toEqual({ ok: false, error: "invalid-client-id" });
  });

  it("uses a valid BYO clientId in the authorize URL", async () => {
    const login = await startLogin(BYO);
    if (!login.ok) throw new Error(login.error);
    const params = new URL(login.url).searchParams;
    expect(params.get("client_id")).toBe(BYO);
    expect(login.oauth.clientId).toBe(BYO);
    expect(params.get("redirect_uri")).toBe("http://127.0.0.1:3000/api/auth/callback");
    expect(params.get("code_challenge")).toBe(await pkceChallenge(login.oauth.verifier));
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBe(login.oauth.state);
    expect(params.get("scope")).toBe(
      "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private",
    );
  });

  it("falls back to the env clientId, and errors when there is none", async () => {
    const login = await startLogin(null);
    expect(login.ok && login.oauth.clientId).toBe("f".repeat(32));
    vi.stubEnv("SPOTIFY_CLIENT_ID", "");
    expect(await startLogin(null)).toEqual({ ok: false, error: "no-client-id" });
  });
});

describe("completeLogin", () => {
  const callback = (query: string) => new URLSearchParams(query);

  it("rejects a state mismatch without calling Spotify", async () => {
    expect(await completeLogin(callback("code=c&state=wrong"), oauth)).toEqual({ ok: false, error: "state-mismatch" });
    expect(await completeLogin(callback("code=c"), oauth)).toEqual({ ok: false, error: "state-mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles access_denied", async () => {
    expect(await completeLogin(callback("error=access_denied&state=state-123"), oauth)).toEqual({
      ok: false,
      error: "access-denied",
    });
  });

  it("reports an expired login when the oauth cookie is gone", async () => {
    expect(await completeLogin(callback("code=c&state=state-123"), null)).toEqual({ ok: false, error: "login-expired" });
  });

  it("exchanges the code and builds the session", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "at", expires_in: 3600, refresh_token: "rt" }))
      .mockResolvedValueOnce(json({ id: "u1", display_name: "User One" }));
    const result = await completeLogin(callback("code=the-code&state=state-123"), oauth);
    expect(result).toMatchObject({
      ok: true,
      session: { clientId: BYO, accessToken: "at", refreshToken: "rt", user: { id: "u1", displayName: "User One" } },
    });
    expect(Object.fromEntries(sentForm(0))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "http://127.0.0.1:3000/api/auth/callback",
      client_id: BYO,
      code_verifier: "verifier-xyz",
    });
  });

  it("maps a 403 from /v1/me to not-allowlisted", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: "at", expires_in: 3600, refresh_token: "rt" }))
      .mockResolvedValueOnce(json({ error: { status: 403 } }, 403));
    expect(await completeLogin(callback("code=c&state=state-123"), oauth)).toEqual({
      ok: false,
      error: "not-allowlisted",
    });
  });

  it("maps a failed code exchange", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    expect(await completeLogin(callback("code=c&state=state-123"), oauth)).toEqual({
      ok: false,
      error: "token-exchange-failed",
    });
  });
});

describe("getAccessToken", () => {
  it("returns not-connected without a session", async () => {
    expect(await getAccessToken()).toEqual({ ok: false, reason: "not-connected" });
  });

  it("returns the stored token when it is not near expiry", async () => {
    await sessionCookie.set({ ...session, expiresAt: Date.now() + 10 * 60_000 });
    expect(await getAccessToken()).toEqual({ ok: true, token: "old-access", clientId: BYO, user: session.user });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes near expiry with the session clientId and stores a rotated refresh token", async () => {
    await sessionCookie.set(session);
    fetchMock.mockResolvedValueOnce(json({ access_token: "new-access", expires_in: 3600, refresh_token: "new-refresh" }));

    expect(await getAccessToken()).toEqual({ ok: true, token: "new-access", clientId: BYO, user: session.user });
    expect(Object.fromEntries(sentForm(0))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
      client_id: BYO,
    });
    expect(await sessionCookie.get()).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
  });

  it("keeps the refresh token when Spotify does not rotate it", async () => {
    await sessionCookie.set(session);
    fetchMock.mockResolvedValueOnce(json({ access_token: "new-access", expires_in: 3600 }));
    await getAccessToken();
    expect(await sessionCookie.get()).toMatchObject({ accessToken: "new-access", refreshToken: "old-refresh" });
  });

  it("returns refresh-failed and clears the session on 400 invalid_grant", async () => {
    await sessionCookie.set(session);
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    expect(await getAccessToken()).toEqual({ ok: false, reason: "refresh-failed" });
    expect(await sessionCookie.get()).toBeNull();
  });

  it("returns expired and keeps the session when the refresh fails transiently", async () => {
    await sessionCookie.set(session);
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    expect(await getAccessToken()).toEqual({ ok: false, reason: "expired" });
    expect(await sessionCookie.get()).toEqual(session);
  });
});
