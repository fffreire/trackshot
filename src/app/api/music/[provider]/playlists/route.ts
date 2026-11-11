import { z } from "zod";
import { errorResponse, handle } from "@/providers/registry";

export async function GET(_request: Request, ctx: RouteContext<"/api/music/[provider]/playlists">) {
  return handle(
    ctx.params,
    (connector) => connector.user(),
    async (provider) => Response.json({ playlists: await provider.listPlaylists() }),
  );
}

const bodySchema = z.object({ name: z.string().trim().min(1).max(100) });

export async function POST(request: Request, ctx: RouteContext<"/api/music/[provider]/playlists">) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return errorResponse("invalid-request", "name must be 1 to 100 characters");
  return handle(
    ctx.params,
    (connector) => connector.user(),
    async (provider) => Response.json({ playlist: await provider.createPlaylist(body.data.name) }),
  );
}
