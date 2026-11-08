import { NextResponse } from "next/server";
import { checkConnectorSourceAccess } from "@/lib/connector-source-access";
import { admitsDerivedCustomerData, DERIVED_DATA_REFUSED } from "@/lib/derived-data-admission";
import { requireFoundationSession } from "@/lib/developer-auth";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import {
  deriveForWorld,
  listCandidates,
  ontologyInductionEnabled,
  recordDerivation,
  toPublicCandidates,
  unitsFromWorldEvidence,
} from "@/lib/ontology-schema";
import { loadWorldReadModel } from "@/lib/world-read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  C1: the proposed schema of one World.

  GET  ?collectionId=  the latest derivation of that collection in the caller's workspace, as the
                       public DTO (no support counts, no receipt pins). Read only when the caller
                       may read every document the run read, now -- a connector ACL revoke takes
                       effect on the next read, not after a re-derivation.
  POST {collectionId, manifestDigest}  derive with the deterministic baseline from that World
                       revision's evidence and store the candidates, all `proposed`. Owner or admin.
                       Redelivery returns the stored run (201 created:false is a 200).

  With TAVONEL_ONTOLOGY_INDUCTION_ENABLED unset both answer 404 before reading a session and write
  nothing.
*/

const NO_STORE = { "Cache-Control": "no-store" } as const;
const refuse = (code: string, status: number) => NextResponse.json({ code }, { status, headers: NO_STORE });
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAX_BODY_BYTES = 1_024;
const DECIDING_ROLES = new Set(["owner", "admin"]);

export async function GET(request: Request) {
  if (!ontologyInductionEnabled()) return refuse("ONTOLOGY_INDUCTION_DISABLED", 404);
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return refuse(auth.code, auth.status);
  const collectionId = new URL(request.url).searchParams.get("collectionId") ?? "";
  if (!COLLECTION_ID_PATTERN.test(collectionId)) return refuse("ONTOLOGY_REQUEST_INVALID", 400);
  const listed = await listCandidates(auth.principal.workspaceKey, collectionId);
  if (!listed.ok) return refuse(listed.code, listed.status);
  if (listed.value.run) {
    const documentIds = listed.value.run.documentIds;
    const access = await checkConnectorSourceAccess(auth.principal.workspaceKey, documentIds);
    if (!access.ok) return refuse(access.code, access.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503);
    if (!await admitsDerivedCustomerData(auth.principal.workspaceKey, documentIds)) return refuse(DERIVED_DATA_REFUSED, 403);
  }
  return NextResponse.json({ code: "OK", ...toPublicCandidates(listed.value) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!ontologyInductionEnabled()) return refuse("ONTOLOGY_INDUCTION_DISABLED", 404);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return refuse("ONTOLOGY_REQUEST_INVALID", 415);
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return refuse(auth.code, auth.status);
  if (!DECIDING_ROLES.has(auth.principal.workspaceRole)) return refuse("ONTOLOGY_ROLE_REQUIRED", 403);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return refuse("ONTOLOGY_REQUEST_INVALID", 413);
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = null; }
  const collectionId = typeof body?.collectionId === "string" ? body.collectionId : "";
  const manifestDigest = typeof body?.manifestDigest === "string" ? body.manifestDigest : "";
  if (!COLLECTION_ID_PATTERN.test(collectionId) || !SHA256.test(manifestDigest)) return refuse("ONTOLOGY_REQUEST_INVALID", 400);

  // The World loader is the access gate: connector ACL, derived-data admission, the exact revision.
  const loaded = await loadWorldReadModel(auth.principal.workspaceKey, collectionId, manifestDigest);
  if (!loaded.ok) return refuse(loaded.code, loaded.status);
  if (loaded.model.world.manifestDigest !== manifestDigest) return refuse("ONTOLOGY_WORLD_CHANGED", 409);
  const units = unitsFromWorldEvidence(loaded.model.evidence);
  if (!units.ok) return refuse(units.code, 422);
  const derived = deriveForWorld(units.units);
  if (!derived.ok) return refuse(derived.code, 422);
  const recorded = await recordDerivation({
    workspaceKey: auth.principal.workspaceKey,
    collectionId,
    manifestDigest,
    actorUserId: auth.principal.userId,
    derivation: derived.derivation,
    documentIds: units.units.map((unit) => unit.documentId),
  });
  if (!recorded.ok) return refuse(recorded.code, recorded.status);
  // Telemetry (§4.C): candidates per run and evidence dropped by the verbatim check. Counts only.
  try {
    console.info(JSON.stringify({ event: "ontology_derivation_recorded", deriver: derived.derivation.receipt.deriver,
      created: recorded.value.created, classes: derived.derivation.receipt.classes, properties: derived.derivation.receipt.properties,
      droppedEvidence: derived.derivation.receipt.droppedEvidence }));
  } catch { /* telemetry never fails a derivation */ }
  return NextResponse.json({ code: "RECORDED", runId: recorded.value.runId, created: recorded.value.created,
    candidates: recorded.value.candidates }, { status: recorded.value.created ? 201 : 200, headers: NO_STORE });
}
