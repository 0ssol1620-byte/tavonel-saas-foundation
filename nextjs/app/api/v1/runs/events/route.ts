import { authorizeFoundationRequest } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeFoundationRequest(request, "documents:read", "observer");
  if (!auth.ok) return Response.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  return Response.json(
    { code: "RUN_ID_REQUIRED", detail: "Use /api/v1/runs/{runId}/events to replay persisted run events." },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
