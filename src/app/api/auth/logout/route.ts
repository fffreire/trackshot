import { appUrl } from "@/spotify/auth";
import { sessionCookie } from "@/spotify/session";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== appUrl().origin) return new Response(null, { status: 403 });
  await sessionCookie.delete();
  return new Response(null, { status: 204 });
}
