import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { authorizeFoundationSessionProduct } from "@/lib/self-service-trial";
import { DOCUMENT_ID_PATTERN } from "@/lib/immutable-keys";
import { headFoundationQuarantineObject, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "@/lib/supabase-admin";
import { assessTrialSourceReuse } from "@/lib/trial-source-risk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };
const SOURCE_SHA256 = /^sha256:[a-f0-9]{64}$/;

/*
 * Confirmation, as a check rather than an acknowledgement.
 *
 * It used to accept on the object's *existence*: a HEAD was issued, its status read, and the rest
 * of the response discarded. A truncated, substituted or mistyped transfer that returned 200 was
 * indistinguishable from a good one, and nothing linked the capability that was issued to the
 * object that would later be processed.
 *
 * Three facts are compared now, inside `confirm_foundation_intake_admission` so that the check is
 * atomic with the confirmation and cannot mark an admission confirmed and then refuse it:
 *
 *   - the stored byte count against what the capability reserved and charged for,
 *   - the stored content type against the one the capability was signed for,
 *   - the digest the browser computed over what it sent, recorded once and never overwritten.
 *
 * And one thing no longer happens: the object is not read. The abuse signal for free evaluation
 * needs a stable content digest, and the old way of getting one was for the application server to
 * download the source back through a 5 MiB-capped helper -- which put customer bytes on the
 * application server and refused every trial upload between 5 and 50 MiB with a 503 the workspace
 * reported as "needs review". The browser hashes what it sends, the CDR worker hashes what
 * arrives, and neither of them is this function.
 *
 * The RPC is called here rather than through `lib/intake-admission.ts` because the verification
 * and the confirmation are one statement now; splitting them across a helper would put a network
 * round trip between the check and the write it protects.
 */
const RPC_ERRORS: Array<[string, string, number]> = [
  ["foundation_intake_confirmation_not_found", "QUARANTINE_ADMISSION_NOT_FOUND", 409],
  ["foundation_intake_content_length_mismatch", "CONTENT_LENGTH_MISMATCH", 409],
  ["foundation_intake_observed_mime_mismatch", "OBSERVED_MIME_MISMATCH", 409],
  ["foundation_intake_source_digest_conflict", "SOURCE_DIGEST_CONFLICT", 409],
  ["foundation_intake_source_digest_invalid", "INVALID_SOURCE_DIGEST", 400],
];

async function confirmAdmission(value: {
  workspaceKey: string;
  documentId: string;
  userId: string;
  sourceSha256: string | null;
  observedBytes: number | null;
  observedMime: string | null;
}) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "INTAKE_CONFIRMATION_NOT_CONFIGURED", status: 503 };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/confirm_foundation_intake_admission", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: value.workspaceKey,
        p_document_id: value.documentId,
        p_user_id: value.userId,
        p_source_sha256: value.sourceSha256,
        p_observed_bytes: value.observedBytes,
        p_observed_mime: value.observedMime,
      }),
    });
  } catch {
    return { ok: false as const, code: "INTAKE_CONFIRMATION_FAILED", status: 503 };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : "";
    const mapped = RPC_ERRORS.find(([needle]) => message.includes(needle));
    return mapped
      ? { ok: false as const, code: mapped[1], status: mapped[2] }
      : { ok: false as const, code: "INTAKE_CONFIRMATION_FAILED", status: 503 };
  }
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!result || result.documentId !== value.documentId || result.status !== "confirmed"
    || typeof result.confirmedAt !== "string" || !Number.isFinite(Date.parse(result.confirmedAt))) {
    return { ok: false as const, code: "INTAKE_CONFIRMATION_RECEIPT_INVALID", status: 503 };
  }
  return { ok: true as const, result };
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 1_024) {
    return NextResponse.json({ code: "UPLOAD_CONFIRM_REQUEST_TOO_LARGE" }, { status: 413, headers });
  }
  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers });

  let body: { documentId?: unknown; sourceSha256?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "UPLOAD_CONFIRM_BODY_INVALID" }, { status: 400, headers });
  }
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    return NextResponse.json({ code: "UPLOAD_CONFIRM_BODY_INVALID" }, { status: 400, headers });
  }
  // Absent is allowed and recorded as absent: a page served without a secure context cannot
  // compute a digest, and saying so is honest where inventing one would not be. A malformed one
  // is refused rather than dropped, because that is a client defect worth seeing.
  if (body.sourceSha256 !== undefined
    && (typeof body.sourceSha256 !== "string" || !SOURCE_SHA256.test(body.sourceSha256))) {
    return NextResponse.json({ code: "INVALID_SOURCE_DIGEST" }, { status: 400, headers });
  }
  const sourceSha256 = typeof body.sourceSha256 === "string" ? body.sourceSha256 : null;

  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers });
  const object = await headFoundationQuarantineObject(signer, auth.principal.workspaceKey, documentId);
  if (!object.ok) return NextResponse.json({ code: object.code }, { status: 503, headers });
  if (!object.exists) return NextResponse.json({ code: "QUARANTINE_OBJECT_NOT_FOUND" }, { status: 409, headers });

  /*
   * Exact-content reuse is evaluated only for free evaluation. Paid customers and the operator may
   * legitimately ingest the same source in separate workspaces and are never correlated by this
   * abuse ledger.
   *
   * It still runs before the admission is confirmed, as it always did -- what changed is only
   * where the digest comes from. A trial upload that carries no digest is refused: the gate is a
   * security control, and quietly skipping it for anyone who omits a field would be the cheapest
   * possible way around it.
   */
  const access = await authorizeFoundationSessionProduct(
    auth.principal.workspaceKey,
    auth.principal.userId,
    "observer",
  );
  if (!access.ok) return NextResponse.json({ code: access.code }, { status: access.status, headers });
  if (access.access.source === "trial") {
    if (!sourceSha256) {
      return NextResponse.json({ code: "SOURCE_DIGEST_REQUIRED" }, { status: 400, headers });
    }
    const assessed = await assessTrialSourceReuse({
      workspaceKey: auth.principal.workspaceKey,
      userId: auth.principal.userId,
      documentId,
      sourceSha256,
    });
    if (!assessed.ok) {
      return NextResponse.json(
        { code: assessed.code },
        {
          status: assessed.code === "TRIAL_SOURCE_REVIEW_REQUIRED" ? 429 : 503,
          headers: {
            ...headers,
            ...(assessed.code === "TRIAL_SOURCE_REVIEW_REQUIRED" ? { "Retry-After": "86400" } : {}),
          },
        },
      );
    }
  }

  const confirmed = await confirmAdmission({
    workspaceKey: auth.principal.workspaceKey,
    documentId,
    userId: auth.principal.userId,
    sourceSha256,
    observedBytes: object.sizeBytes,
    observedMime: object.contentType,
  });
  if (!confirmed.ok) return NextResponse.json({ code: confirmed.code }, { status: confirmed.status, headers });

  return NextResponse.json({ code: "UPLOAD_CONFIRMED", result: confirmed.result }, { headers });
}
