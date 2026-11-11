import { z } from "zod";
import { errorResponse, handle } from "@/providers/registry";

const bodySchema = z.object({
  trackIds: z.array(z.string().min(1).max(100)).min(1).max(10_000),
  requestId: z.string().min(8).max(100),
});

const TTL_MS = 10 * 60 * 1000;
// In-memory and per instance: best effort on serverless, where a repeat can land on another instance.
const seenRequests = new Map<string, number>();

export async function POST(request: Request, ctx: RouteContext<"/api/music/[provider]/playlists/[id]/tracks">) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return errorResponse("invalid-request", "trackIds (non-empty) and requestId are required");
  const { id } = await ctx.params;

  return handle(
    ctx.params,
    (connector) => connector.user(),
    async (provider, providerId) => {
      const now = Date.now();
      for (const [key, seenAt] of seenRequests) if (now - seenAt > TTL_MS) seenRequests.delete(key);
      const key = `${providerId}:${body.data.requestId}`;
      if (seenRequests.has(key)) return errorResponse("duplicate-request", "This import was already submitted");
      seenRequests.set(key, now);
      return Response.json({ outcomes: await provider.addTracks(id, body.data.trackIds) });
    },
  );
}
