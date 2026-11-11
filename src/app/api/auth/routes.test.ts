import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oauthCookie, sessionCookie } from "@/spotify/session";
import { GET as callback } from "./callback/route";
import { GET as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { GET as sessionRoute } from "./session/route";

const jar = new Map<string, string>();
const cookieOptions = new Map<string, unknown>();
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

const BYO = "0123456789abcdef0123456789abcdef";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const get = (path: string) => new NextRequest(`http://127.0.0.1:3000${path}`);

beforeEach(() => {
  jar.clear();
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("SPOTIFY_CLIENT_ID", "");
  vi.stubEnv("SPOTIFY_MOCK", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("auth routes", () => {
  it("login redirects to /?auth_error=no-client-id without any Client ID", async () => {
    const res = await login(get("/api/auth/login"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3000/?auth_error=no-client-id");
    expect(jar.has("s2s_oauth")).toBe(false);
  });

  it("login with a BYO Client ID sets s2s_oauth and redirects to Spotify", async () => {
    const res = await login(get(`/api/auth/login?clientId=${BYO}`));
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("client_id")).toBe(BYO);
    expect(await oauthCookie.get()).toMatchObject({ clientId: BYO });
  });

  it("sets httpOnly lax cookies, secure unless APP_URL is loopback http", async () => {
    await login(get(`/api/auth/login?clientId=${BYO}`));
    expect(cookieOptions.get("s2s_oauth")).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 600 });
    vi.stubEnv("APP_URL", "https://snap2spotify.example");
    await login(get(`/api/auth/login?clientId=${BYO}`));
    expect(cookieOptions.get("s2s_oauth")).toMatchObject({ secure: true });
  });

  it("mock mode sets the E2E session without calling Spotify", async () => {
    vi.stubEnv("SPOTIFY_MOCK", "1");
    const res = await login(get("/api/auth/login"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3000/");
    expect(await sessionCookie.get()).toMatchObject({ user: { id: "e2e-user", displayName: "E2E User" } });
  });

  it("callback sends a non-allowlisted user to /?auth_error=not-allowlisted and clears s2s_oauth", async () => {
    await oauthCookie.set({ state: "st", verifier: "v", clientId: BYO });
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ access_token: "at", expires_in: 3600, refresh_token: "rt" }))
        .mockResolvedValueOnce(json({}, 403)),
    );
    const res = await callback(get("/api/auth/callback?code=c&state=st"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3000/?auth_error=not-allowlisted");
    expect(jar.has("s2s_oauth")).toBe(false);
    expect(jar.has("s2s_session")).toBe(false);
  });

  it("session never returns tokens and reports BYO usage", async () => {
    expect(await (await sessionRoute()).json()).toEqual({ connected: false });
    await sessionCookie.set({
      clientId: BYO,
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
      user: { id: "u1", displayName: "User One" },
    });
    expect(await (await sessionRoute()).json()).toEqual({
      connected: true,
      user: { id: "u1", displayName: "User One" },
      byoClientId: true,
    });
  });

  it("logout requires a same-origin request", async () => {
    jar.set("s2s_session", "x");
    const post = (origin: string) =>
      new Request("http://127.0.0.1:3000/api/auth/logout", { method: "POST", headers: { origin } });
    expect((await logout(post("https://evil.example"))).status).toBe(403);
    expect(jar.has("s2s_session")).toBe(true);
    expect((await logout(post("http://127.0.0.1:3000"))).status).toBe(204);
    expect(jar.has("s2s_session")).toBe(false);
  });
});
