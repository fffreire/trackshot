import { connection } from "next/server";
import { appleDeveloperToken, appleMusicConnector } from "@/providers/apple-music";

export async function GET() {
  await connection();
  if (!appleMusicConnector.configured()) {
    return Response.json(
      { error: { kind: "not-configured", message: "Apple Music is not configured" } },
      { status: 501 },
    );
  }
  return Response.json({ developerToken: await appleDeveloperToken() }, { headers: { "Cache-Control": "no-store" } });
}
