import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { recordFoundationReviewDecision } from "@/lib/review-store";
import { loadWorldReadModel } from "@/lib/world-read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set(["accept", "edit", "reject"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAX_REVIEW_BODY_BYTES = 4_096;

async function readBoundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return { value: null, tooLarge: false };
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_REVIEW_BODY_BYTES) {
      await reader.cancel();
      return { value: null, tooLarge: true };
    }
    raw += decoder.decode(chunk.value, { stream: true });
  }
  raw += decoder.decode();
  try {
    return { value: JSON.parse(raw) as Record<string, unknown>, tooLarge: false };
  } catch {
    return { value: null, tooLarge: false };
  }
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ code: "REVIEW_REQUEST_INVALID" }, { status: 415 });
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_REVIEW_BODY_BYTES)) {
    return NextResponse.json({ code: "REVIEW_REQUEST_TOO_LARGE" }, { status: 413 });
  }
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status });
  const parsed = await readBoundedJson(request);
  if (parsed.tooLarge) return NextResponse.json({ code: "REVIEW_REQUEST_TOO_LARGE" }, { status: 413 });
  const body = parsed.value;
  const collectionId = typeof body?.collectionId === "string" ? body.collectionId : "";
  const manifestDigest = typeof body?.manifestDigest === "string" ? body.manifestDigest : "";
  const evidenceId = typeof body?.evidenceId === "string" ? body.evidenceId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!COLLECTION_ID_PATTERN.test(collectionId) || !SHA256.test(manifestDigest) || !EVIDENCE_ID.test(evidenceId)
    || !ACTIONS.has(action) || reason.length < 8 || reason.length > 1_000) {
    return NextResponse.json({ code: "REVIEW_REQUEST_INVALID" }, { status: 400 });
  }
  const loaded = await loadWorldReadModel(auth.principal.workspaceKey, collectionId);
  if (!loaded.ok) return NextResponse.json({ code: loaded.code }, { status: loaded.status });
  if (loaded.model.world.manifestDigest !== manifestDigest) {
    return NextResponse.json({ code: "REVIEW_WORLD_CHANGED" }, { status: 409 });
  }
  const evidence = loaded.model.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return NextResponse.json({ code: "REVIEW_EVIDENCE_NOT_FOUND" }, { status: 404 });
  const recorded = await recordFoundationReviewDecision({
    workspaceKey: auth.principal.workspaceKey,
    collectionId,
    manifestDigest,
    evidenceId,
    sourceId: evidence.sourceId,
    sourceVersionId: evidence.sourceVersionId,
    pageNumber: evidence.page,
    bbox1000: evidence.bbox,
    action: action as "accept" | "edit" | "reject",
    reason,
    actorUserId: auth.principal.userId,
  });
  if (!recorded.ok) return NextResponse.json({ code: recorded.code }, { status: 503 });
  return NextResponse.json({ code: "RECORDED", ...recorded.receipt }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
