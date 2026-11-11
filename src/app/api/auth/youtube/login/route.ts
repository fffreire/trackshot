import { connection, NextResponse } from "next/server";
import { appUrl } from "@/spotify/auth";
import { startLogin, youtubeOAuthCookie } from "@/youtube/auth";

export async function GET() {
  await connection();
  const login = await startLogin();
  if (!login.ok) return NextResponse.redirect(appUrl(`/?auth_error=youtube-${login.error}`));
  await youtubeOAuthCookie.set(login.oauth);
  return NextResponse.redirect(login.url);
}
