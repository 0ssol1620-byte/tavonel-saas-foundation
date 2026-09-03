import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { loadWorldReadModel } from "@/lib/world-read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeFoundationRequest(request, "worlds:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  /*
    A specific version, when one is named.

    Comparing two versions means reading two, and the diff a reviewer sees before rolling back
    is the reason this parameter exists. Without it the endpoint could only ever answer with
    whichever candidate happens to be preferred.
  */
  const requested = new URL(request.url).searchParams.get("manifest");
  if (requested !== null && !/^sha256:[a-f0-9]{64}$/.test(requested)) {
    return NextResponse.json({ code: "MANIFEST_DIGEST_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const loaded = await loadWorldReadModel(auth.principal.workspaceKey, id, requested ?? undefined);
  if (!loaded.ok) return NextResponse.json({ code: loaded.code }, { status: loaded.status, headers: NO_STORE });
  return NextResponse.json({ code: "OK", model: loaded.model }, { headers: NO_STORE });
}
