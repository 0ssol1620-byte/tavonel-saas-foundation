import { NextResponse } from "next/server";
import { applyCandidatePatch } from "@/lib/collection-patch";
import { loadPreferredCollectionCandidate } from "@/lib/collection-storage";
import { requireFoundationSession } from "@/lib/developer-auth";
import { collectionCandidateKey, COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { putWorkspaceCollectionCandidate } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { listFoundationReviewDecisions, recordFoundationReviewDecision } from "@/lib/review-store";
import { REVIEW_DECISION_READ_LIMIT } from "@/lib/review-queue";
import { loadWorldReadModel } from "@/lib/world-read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  Every answer this route gives is uncacheable, refusals included.

  It was the one tenant-scoped route whose 401 carried no Cache-Control at all, while the rest
  send no-store -- and an authorization refusal an intermediary may keep is a refusal that can be
  served to a different caller later. It is also a stored fact about who asked for what.

  `refuse` exists so the header cannot be forgotten on one branch: there are eighteen early
  returns here and adding the header to each is a rule that holds until the next one is written.
*/
const NO_STORE = { "Cache-Control": "no-store" } as const;
const refuse = (code: string, status: number) => NextResponse.json({ code }, { status, headers: NO_STORE });

const ACTIONS = new Set(["accept", "edit", "reject"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
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
    return refuse("REVIEW_REQUEST_INVALID", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_REVIEW_BODY_BYTES)) {
    return refuse("REVIEW_REQUEST_TOO_LARGE", 413);
  }
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return refuse(auth.code, auth.status);
  const parsed = await readBoundedJson(request);
  if (parsed.tooLarge) return refuse("REVIEW_REQUEST_TOO_LARGE", 413);
  const body = parsed.value;
  const collectionId = typeof body?.collectionId === "string" ? body.collectionId : "";
  const manifestDigest = typeof body?.manifestDigest === "string" ? body.manifestDigest : "";
  const evidenceId = typeof body?.evidenceId === "string" ? body.evidenceId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!COLLECTION_ID_PATTERN.test(collectionId) || !SHA256.test(manifestDigest) || !EVIDENCE_ID.test(evidenceId)
    || !ACTIONS.has(action) || reason.length < 8 || reason.length > 1_000) {
    return refuse("REVIEW_REQUEST_INVALID", 400);
  }
  const loaded = await loadWorldReadModel(auth.principal.workspaceKey, collectionId);
  if (!loaded.ok) return refuse(loaded.code, loaded.status);
  if (loaded.model.world.manifestDigest !== manifestDigest) {
    return refuse("REVIEW_WORLD_CHANGED", 409);
  }
  const evidence = loaded.model.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return refuse("REVIEW_EVIDENCE_NOT_FOUND", 404);

  /*
    An edit that carries a correction applies it, and produces a new candidate.

    Until now every action wrote a decision row and left the World exactly as it was, which
    made "Edit" a record that someone disagreed rather than a correction. Masterplan 10 asks
    for the correction: mutate the candidate, validate it, emit a new candidate artifact, bind
    a receipt. Nothing is overwritten -- the patched artifact lands under its own key, derived
    from the reviewed one and pointing back at it.

    An edit without a patch body is still accepted, and still just a decision. A reviewer who
    can say what is wrong but not what it should say has said something worth recording.
  */
  let patch: { objectId: string; before: string; after: string; resultingManifestDigest: string } | undefined;
  if (action === "edit" && body?.patch && typeof body.patch === "object") {
    const requested = body.patch as Record<string, unknown>;
    const objectId = typeof requested.objectId === "string" ? requested.objectId : "";
    const before = typeof requested.before === "string" ? requested.before : "";
    const after = typeof requested.after === "string" ? requested.after : "";
    if (!OBJECT_ID.test(objectId) || before.length === 0 || after.trim().length === 0) {
      return refuse("REVIEW_PATCH_INVALID", 400);
    }
    const signer = readR2SignerEnv();
    if (!signer) return refuse("SIGNER_NOT_CONFIGURED", 503);
    const stored = await loadPreferredCollectionCandidate(signer, auth.principal.workspaceKey, collectionId, manifestDigest);
    if (!stored.ok) {
      return refuse(stored.code, stored.code === "NOT_FOUND" ? 404 : 503);
    }
    const applied = applyCandidatePatch(stored.value.artifact, { objectId, before, after }, {
      evidenceId,
      actorUserId: auth.principal.userId,
      patchedAt: new Date().toISOString(),
    });
    if (!applied.ok) {
      // A mismatch is a conflict, not a malformed request: the reviewer saw a label that is no
      // longer there, which means someone else corrected it first.
      const status = applied.code === "PATCH_BEFORE_MISMATCH" ? 409 : 422;
      return refuse(applied.code, status);
    }
    const key = collectionCandidateKey(
      auth.principal.workspaceKey,
      collectionId,
      applied.artifact.manifestDigest.replace("sha256:", ""),
    );
    if (!key) return refuse("COLLECTION_KEY_INVALID", 500);
    const written = await putWorkspaceCollectionCandidate(signer, auth.principal.workspaceKey, key, applied.artifact);
    if (!written.ok) return refuse(written.code, 503);
    patch = {
      objectId,
      before,
      after: applied.artifact.reviewPatch.after,
      resultingManifestDigest: applied.artifact.manifestDigest,
    };
  }

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
    patch,
  });
  if (!recorded.ok) return refuse(recorded.code, 503);
  return NextResponse.json({ code: "RECORDED", ...recorded.receipt }, { status: 201, headers: NO_STORE });
}

/*
  What has been decided about this World.

  Read alongside a version comparison. A diff says what changed between two candidates; this
  says who looked, what they said, and -- for a correction -- exactly what they changed and
  which version came out of it. Neither is the whole picture on its own.
*/
export async function GET(request: Request) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return refuse(auth.code, auth.status);
  const collectionId = new URL(request.url).searchParams.get("collectionId") ?? "";
  if (!COLLECTION_ID_PATTERN.test(collectionId)) {
    return refuse("REVIEW_REQUEST_INVALID", 400);
  }
  const listed = await listFoundationReviewDecisions(auth.principal.workspaceKey, collectionId, REVIEW_DECISION_READ_LIMIT);
  if (!listed.ok) return refuse(listed.code, 503);
  /*
    `truncated` is not decoration. The read is `created_at.desc` and bounded, so a World with
    more decisions than the window returns rows that do not include the first decision on an
    older document -- and a caller computing time-to-first-review from them would print a later
    decision as the first one. Saying the window was full is what lets it say so instead.
  */
  return NextResponse.json({
    code: "OK",
    decisions: listed.decisions,
    truncated: listed.decisions.length >= REVIEW_DECISION_READ_LIMIT,
  }, { headers: NO_STORE });
}
