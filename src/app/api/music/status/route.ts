import { connectors } from "@/providers/registry";

export async function GET() {
  const providers = await Promise.all(
    Object.entries(connectors).map(async ([id, connector]) => {
      const [status, anonymous] = await Promise.all([connector.status(), connector.anonymous().catch(() => null)]);
      return { id, configured: connector.configured(), anonymousSearch: anonymous?.ok ?? false, ...status };
    }),
  );
  return Response.json({ providers });
}
