import { NextResponse } from "next/server";
import { settleFoundationCompute } from "@/lib/compute-reservation";
import { verifyComputeSettlementRequest } from "@/lib/compute-settlement-auth";
import { appendServiceAuditEvent } from "@/lib/enterprise-store";
import { DOCUMENT_ID_PATTERN, WORKSPACE_ID_PATTERN } from "@/lib/immutable-keys";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The one reason code the CDR worker sends when it has refused a source for good. */
const TERMINAL_REJECT = "CDR_PERMANENT_REJECT";
const FAILURE_CLASS = /^[A-Z][A-Z_]{2,63}$/;
const SOURCE_SHA256 = /^sha256:[a-f0-9]{64}$/;
/** Printable ASCII only: the worker writes these sentences, and this is all they contain. */
const UNPRINTABLE = /[^\x20-\x7e]/g;

function boundedReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Whatever the worker observed, shown to a person. Anything unprintable is replaced rather than
  // trusted, and the length is bounded, so a reason cannot grow into a payload.
  const clean = value.replace(UNPRINTABLE, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return clean.length > 0 ? clean : null;
}

/**
 * Moves the admission to its terminal state.
 *
 * `foundation_intake_admissions.state` has had a `rejected` member since migration 0008 and no
 * writer has ever set it, which is why a refused source stayed indistinguishable from one still
 * being prepared. Migration 0051 adds the writer as a security-definer function, the way every
 * other write to that table is already done, so this does not lean on ambient table grants. It is
 * idempotent: a redelivered queue message sets the same state, and a source that has already been
 * read is left alone rather than retroactively refused.
 */
async function markAdmissionRejected(workspaceKey: string, documentId: string, reasonCode: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "COMPUTE_LEDGER_NOT_CONFIGURED" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/refuse_foundation_intake_admission", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: workspaceKey,
        p_document_id: documentId,
        p_reason_code: reasonCode,
      }),
    });
    return response.ok ? { ok: true as const } : { ok: false as const, code: "INTAKE_STATE_WRITE_FAILED" };
  } catch {
    return { ok: false as const, code: "INTAKE_STATE_WRITE_FAILED" };
  }
}

/**
 * Turns a refusal into something that exists.
 *
 * Before this, a permanent CDR rejection released the billing reservation and vanished: no object,
 * no row, no audit event, and a pipeline board that showed PREPARE running forever. The worker now
 * writes `cdr-reject.json` next to the source and sends the terminal reason here, and here is
 * where it becomes a document state the workspace can read and one `enterprise_audit_events` row
 * (founder B-6) an operator can count.
 *
 * Both writes are idempotent, and either one failing fails the whole settlement with 503, so the
 * worker leaves the queue message retryable instead of acknowledging a refusal nobody recorded.
 */
async function recordTerminalRefusal(value: {
  workspaceKey: string;
  documentId: string;
  terminalReason: string | null;
  failureClass: string | null;
}) {
  const state = await markAdmissionRejected(value.workspaceKey, value.documentId, TERMINAL_REJECT);
  if (!state.ok) return state;
  const audit = await appendServiceAuditEvent({
    workspaceKey: value.workspaceKey,
    action: "source.intake_refused",
    targetType: "document",
    targetId: value.documentId,
    outcome: "failed",
    details: {
      reasonCode: TERMINAL_REJECT,
      ...(value.failureClass ? { failureClass: value.failureClass } : {}),
      ...(value.terminalReason ? { terminalReason: value.terminalReason } : {}),
    },
  });
  return audit.ok ? { ok: true as const } : { ok: false as const, code: audit.code };
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 2_048) {
    return NextResponse.json({ code: "SETTLEMENT_REQUEST_TOO_LARGE" }, { status: 413, headers });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 2_048) {
    return NextResponse.json({ code: "SETTLEMENT_REQUEST_TOO_LARGE" }, { status: 413, headers });
  }
  if (!verifyComputeSettlementRequest(rawBody, request.headers, process.env.FOUNDATION_BILLING_SETTLEMENT_HMAC)) {
    return NextResponse.json({ code: "SETTLEMENT_AUTH_INVALID" }, { status: 401, headers });
  }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { body = null; }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ code: "SETTLEMENT_BODY_INVALID" }, { status: 400, headers });
  }
  const input = body as Record<string, unknown>;
  const workspaceKey = typeof input.workspaceKey === "string" ? input.workspaceKey : "";
  const documentId = typeof input.documentId === "string" ? input.documentId : "";
  const reasonCode = typeof input.reasonCode === "string" ? input.reasonCode : "";
  const result = await settleFoundationCompute({
    workspaceKey,
    documentId,
    outcome: input.outcome as "settled" | "operator_review" | "released",
    actualCredits: typeof input.actualCredits === "number" ? input.actualCredits : Number.NaN,
    reasonCode,
  });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers });

  if (reasonCode === TERMINAL_REJECT
    && WORKSPACE_ID_PATTERN.test(workspaceKey)
    && DOCUMENT_ID_PATTERN.test(documentId)) {
    const recorded = await recordTerminalRefusal({
      workspaceKey,
      documentId,
      terminalReason: boundedReason(input.terminalReason),
      failureClass: typeof input.failureClass === "string" && FAILURE_CLASS.test(input.failureClass)
        ? input.failureClass
        : null,
    });
    if (!recorded.ok) return NextResponse.json({ code: recorded.code }, { status: 503, headers });
  }

  // `sourceSha256` is the digest the worker computed over the bytes it read; the application
  // server never reads them, so this is the only place it can come from. It is validated here so
  // the wire shape is settled. Binding it to `documents.source_sha256` and to the trial digest
  // gate is D1-07/D1-04 and lands with the confirm changes, not with this row.
  const sourceSha256 = typeof input.sourceSha256 === "string" && SOURCE_SHA256.test(input.sourceSha256)
    ? input.sourceSha256
    : null;
  return NextResponse.json(
    { code: "SETTLEMENT_APPLIED", result: result.result, ...(sourceSha256 ? { sourceSha256 } : {}) },
    { headers },
  );
}
