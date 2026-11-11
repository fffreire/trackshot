import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/spotify/auth";
import { completeLogin, youtubeOAuthCookie, youtubeSessionCookie } from "@/youtube/auth";

export async function GET(request: NextRequest) {
  const result = await completeLogin(request.nextUrl.searchParams, await youtubeOAuthCookie.get());
  await youtubeOAuthCookie.delete();
  if (!result.ok) return NextResponse.redirect(appUrl(`/?auth_error=youtube-${result.error}`));
  await youtubeSessionCookie.set(result.session);
  return NextResponse.redirect(appUrl());
}
