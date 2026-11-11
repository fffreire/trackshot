import { NextResponse, type NextRequest } from "next/server";
import { appUrl, completeLogin } from "@/spotify/auth";
import { oauthCookie, sessionCookie } from "@/spotify/session";

export async function GET(request: NextRequest) {
  const result = await completeLogin(request.nextUrl.searchParams, await oauthCookie.get());
  await oauthCookie.delete();
  if (!result.ok) return NextResponse.redirect(appUrl(`/?auth_error=${result.error}`));
  await sessionCookie.set(result.session);
  return NextResponse.redirect(appUrl());
}
