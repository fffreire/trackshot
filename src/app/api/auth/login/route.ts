import { NextResponse, type NextRequest } from "next/server";
import { appUrl, startLogin } from "@/spotify/auth";
import { oauthCookie, sessionCookie } from "@/spotify/session";

export async function GET(request: NextRequest) {
  if (process.env.SPOTIFY_MOCK === "1") {
    await sessionCookie.set({
      clientId: process.env.SPOTIFY_CLIENT_ID ?? "e2e-client",
      accessToken: "e2e-access-token",
      refreshToken: "e2e-refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      user: { id: "e2e-user", displayName: "E2E User" },
    });
    return NextResponse.redirect(appUrl());
  }

  const login = await startLogin(request.nextUrl.searchParams.get("clientId"));
  if (!login.ok) return NextResponse.redirect(appUrl(`/?auth_error=${login.error}`));
  await oauthCookie.set(login.oauth);
  return NextResponse.redirect(login.url);
}
