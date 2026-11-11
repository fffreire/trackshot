import { handle } from "@/providers/registry";

export async function GET(_request: Request, ctx: RouteContext<"/api/music/[provider]/playlists/[id]/track-ids">) {
  const { id } = await ctx.params;
  return handle(
    ctx.params,
    (connector) => connector.user(),
    async (provider) => Response.json({ trackIds: await provider.playlistTrackIds(id) }),
  );
}
