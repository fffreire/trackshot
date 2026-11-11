import { appUrl } from "@/spotify/auth";
import { youtubeSessionCookie } from "@/youtube/auth";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== appUrl().origin) return new Response(null, { status: 403 });
  await youtubeSessionCookie.delete();
  return new Response(null, { status: 204 });
}
