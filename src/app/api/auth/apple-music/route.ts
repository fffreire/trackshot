import { z } from "zod";
import { ProviderError } from "@/core/types";
import { appleCookie, appleMusicConnector, appleStorefront } from "@/providers/apple-music";
import { appUrl } from "@/spotify/auth";

const error = (kind: string, message: string, status: number) =>
  Response.json({ error: { kind, message } }, { status });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== appUrl().origin) return new Response(null, { status: 403 });
  if (!appleMusicConnector.configured()) return error("not-configured", "Apple Music is not configured", 501);
  const body = z.object({ userToken: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return error("invalid-request", "userToken is required", 400);
  try {
    const storefront = await appleStorefront(body.data.userToken);
    await appleCookie.set({ userToken: body.data.userToken, storefront });
    return new Response(null, { status: 204 });
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    return error(e.kind, e.message, e.kind === "auth" ? 401 : 502);
  }
}

export async function DELETE(request: Request) {
  if (request.headers.get("origin") !== appUrl().origin) return new Response(null, { status: 403 });
  await appleCookie.delete();
  return new Response(null, { status: 204 });
}
