import { sessionCookie } from "@/spotify/session";

export async function GET() {
  const session = await sessionCookie.get();
  if (!session) return Response.json({ connected: false });
  return Response.json({
    connected: true,
    user: session.user,
    byoClientId: session.clientId !== process.env.SPOTIFY_CLIENT_ID,
  });
}
