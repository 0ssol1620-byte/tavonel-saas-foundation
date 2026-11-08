import { NextResponse } from "next/server";
import { checkConnectorSourceAccess } from "@/lib/connector-source-access";
import { admitsDerivedCustomerData, DERIVED_DATA_REFUSED } from "@/lib/derived-data-admission";
import { requireFoundationSession } from "@/lib/developer-auth";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { decideCandidate, listCandidates, ontologyInductionEnabled } from "@/lib/ontology-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  C1: a person's verdict on one proposed candidate. Owner or admin.

  {collectionId, verdict: certify | reject | edit, reason, label?, description?}

  The candidate must be in the latest derivation of that collection in the caller's workspace (a
  candidate of another workspace is "not found", never "forbidden"), and the caller must be able to
  read every document that derivation read, now. Every verdict carries a reason of 8+ characters.
  certify and reject are final; edit changes label and description and keeps it proposed.

  Nothing here certifies on anyone's behalf, and nothing downstream reads a certified candidate in
  this wave. Flag unset: 404 before reading a session, nothing written.
*/

const NO_STORE = { "Cache-Control": "no-store" } as const;
const refuse = (code: string, status: number) => NextResponse.json({ code }, { status, headers: NO_STORE });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERDICTS = new Set(["certify", "reject", "edit"]);
const MAX_BODY_BYTES = 4_096;
const DECIDING_ROLES = new Set(["owner", "admin"]);

export async function POST(request: Request, context: { params: Promise<{ candidateId: string }> }) {
  if (!ontologyInductionEnabled()) return refuse("ONTOLOGY_INDUCTION_DISABLED", 404);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return refuse("ONTOLOGY_REQUEST_INVALID", 415);
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return refuse(auth.code, auth.status);
  if (!DECIDING_ROLES.has(auth.principal.workspaceRole)) return refuse("ONTOLOGY_ROLE_REQUIRED", 403);
  const { candidateId } = await context.params;
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return refuse("ONTOLOGY_REQUEST_INVALID", 413);
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = null; }
  const collectionId = typeof body?.collectionId === "string" ? body.collectionId : "";
  const verdict = typeof body?.verdict === "string" ? body.verdict : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!UUID.test(candidateId) || !COLLECTION_ID_PATTERN.test(collectionId) || !VERDICTS.has(verdict)) {
    return refuse("ONTOLOGY_REQUEST_INVALID", 400);
  }
  // Checked here for a clear answer, and again by the database, which is the rule.
  if (reason.length < 8 || reason.length > 1_000) return refuse("ONTOLOGY_DECISION_REASON_REQUIRED", 400);
  if (verdict === "edit" && (label.length < 1 || label.length > 120 || description.length > 600)) {
    return refuse("ONTOLOGY_DECISION_INVALID", 400);
  }

  const listed = await listCandidates(auth.principal.workspaceKey, collectionId);
  if (!listed.ok) return refuse(listed.code, listed.status);
  const run = listed.value.run;
  if (!run || !listed.value.candidates.some((candidate) => candidate.candidateId === candidateId.toLowerCase())) {
    return refuse("ONTOLOGY_CANDIDATE_NOT_FOUND", 404);
  }
  const access = await checkConnectorSourceAccess(auth.principal.workspaceKey, run.documentIds);
  if (!access.ok) return refuse(access.code, access.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503);
  if (!await admitsDerivedCustomerData(auth.principal.workspaceKey, run.documentIds)) return refuse(DERIVED_DATA_REFUSED, 403);

  const decided = await decideCandidate({
    workspaceKey: auth.principal.workspaceKey,
    candidateId: candidateId.toLowerCase(),
    verdict: verdict as "certify" | "reject" | "edit",
    actorUserId: auth.principal.userId,
    reason,
    edit: verdict === "edit" ? { label, description } : null,
  });
  if (!decided.ok) return refuse(decided.code, decided.status);
  try {
    console.info(JSON.stringify({ event: "ontology_candidate_decided", verdict, state: decided.value.state }));
  } catch { /* telemetry never fails a decision */ }
  return NextResponse.json({ code: "RECORDED", candidateId: decided.value.candidateId, verdict, state: decided.value.state },
    { status: 201, headers: NO_STORE });
}
