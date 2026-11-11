import type { NextRequest } from "next/server";
import { z } from "zod";
import { ProviderError } from "@/core/types";
import { errorResponse, handle } from "@/providers/registry";

const querySchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().max(200).optional(),
  mode: z.enum(["exact", "loose"]).default("exact"),
});

const LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000;
// In-memory and per instance: best effort on serverless, where each instance keeps its own counts.
const anonymousSearches = new Map<string, { count: number; resetAt: number }>();

export async function GET(request: NextRequest, ctx: RouteContext<"/api/music/[provider]/search">) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return errorResponse("invalid-request", "title is required; mode must be exact or loose");
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";

  return handle(
    ctx.params,
    async (connector) => {
      const user = await connector.user();
      if (user.ok) return user;
      const anonymous = await connector.anonymous();
      if (!anonymous.ok) return user;

      const now = Date.now();
      for (const [key, entry] of anonymousSearches) if (entry.resetAt <= now) anonymousSearches.delete(key);
      const entry = anonymousSearches.get(ip);
      if (!entry) anonymousSearches.set(ip, { count: 1, resetAt: now + WINDOW_MS });
      else if (entry.count >= LIMIT) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        throw new ProviderError(
          "rate-limited",
          "Too many searches without an account, connect one or try later",
          retryAfter,
        );
      } else entry.count++;
      return anonymous;
    },
    async (provider) => Response.json({ tracks: await provider.search(parsed.data) }),
  );
}
