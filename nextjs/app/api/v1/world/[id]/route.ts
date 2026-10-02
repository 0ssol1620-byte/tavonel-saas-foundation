import { NextResponse } from "next/server";
import {
  CONSUMER_CONTEXT_REFUSALS,
  bindConsumerContext,
  releaseConsumerContext,
  resolveBoundSnapshot,
  worldModelSnapshot,
} from "@/lib/consumer-context-api";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { loadWorldReadModel } from "@/lib/world-read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeFoundationRequest(request, "worlds:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  // A consumer context is bound to the principal just verified, before anything is read.
  const binding = bindConsumerContext(request.headers, auth.principal, { scope: "worlds:read", collectionId: id });
  if (!binding.ok) return NextResponse.json({ code: binding.code }, { status: binding.status, headers: NO_STORE });
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
  if (!binding.bound) {
    const loaded = await loadWorldReadModel(auth.principal.workspaceKey, id, requested ?? undefined);
    if (!loaded.ok) return NextResponse.json({ code: loaded.code }, { status: loaded.status, headers: NO_STORE });
    return NextResponse.json({ code: "OK", model: loaded.model }, { headers: NO_STORE });
  }

  // Bound: the World read is the resolved digest, never the preferred candidate. A named version
  // is that digest or a mismatch -- not a second way to read another World under this context.
  const snapshot = await resolveBoundSnapshot(binding, auth.principal.workspaceKey);
  if (!snapshot.ok) return NextResponse.json({ code: snapshot.code }, { status: snapshot.status, headers: NO_STORE });
  const digest = snapshot.resolved.snapshot.manifestDigest;
  if (requested !== null && requested !== digest) {
    return NextResponse.json(
      { code: "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH" },
      { status: CONSUMER_CONTEXT_REFUSALS.CONSUMER_CONTEXT_SNAPSHOT_MISMATCH, headers: NO_STORE },
    );
  }
  const loaded = await loadWorldReadModel(auth.principal.workspaceKey, id, digest);
  if (!loaded.ok) return NextResponse.json({ code: loaded.code }, { status: loaded.status, headers: NO_STORE });
  const released = await releaseConsumerContext({
    request, principal: auth.principal, scope: "worlds:read", bound: binding, snapshot,
    served: worldModelSnapshot(loaded.model),
  });
  if (!released.ok) return NextResponse.json({ code: released.code }, { status: released.status, headers: NO_STORE });
  return NextResponse.json({ code: "OK", model: loaded.model }, { headers: { ...released.headers } });
}
