import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { readBoundedJson } from "@/lib/enterprise-http";
import { canAdmitCustomerSource } from "@/lib/customer-data-admission";
import { createFoundationIntakePreflightApproval } from "@/lib/compute-reservation";
import { INTAKE_TRIAGE_ROLLOUT_ENABLED, intakeTriageDisabledResponse } from "@/lib/intake-triage-rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIGURATION_REVISION = "tavonel-intake-triage-config-v2";

export async function POST(request: Request) {
  if (!INTAKE_TRIAGE_ROLLOUT_ENABLED) return intakeTriageDisabledResponse();
  if (!activationPolicy.customerIntake.enabled) {
    return NextResponse.json({ code: "INTAKE_DISABLED", reason: activationPolicy.customerIntake.reason }, { status: 503, headers: NO_STORE });
  }
  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  if (!await canAdmitCustomerSource(auth.principal.workspaceKey, "direct_upload")) {
    return NextResponse.json({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" }, { status: 403, headers: NO_STORE });
  }
  const parsed = await readBoundedJson(request, 32 * 1024);
  if (!parsed.ok) return NextResponse.json({ code: "TRIAGE_PREFLIGHT_BODY_INVALID" }, { status: parsed.status, headers: NO_STORE });
  const body = parsed.value as { batchId?: unknown; choices?: unknown };
  if (typeof body.batchId !== "string" || !UUID.test(body.batchId) || !Array.isArray(body.choices)
    || body.choices.length < 1 || body.choices.length > 128
    || body.choices.some((row) => !row || typeof row !== "object" || Array.isArray(row)
      || !UUID.test((row as Record<string, unknown>).stageId as string)
      || !["preflight", "exclude"].includes((row as Record<string, unknown>).choice as string))) {
    return NextResponse.json({ code: "TRIAGE_PREFLIGHT_BODY_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const choices = body.choices as Array<{ stageId: string; choice: "preflight" | "exclude" }>;
  if (new Set(choices.map((item) => item.stageId)).size !== choices.length) {
    return NextResponse.json({ code: "TRIAGE_PREFLIGHT_BODY_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const created = await createFoundationIntakePreflightApproval({
    workspaceKey: auth.principal.workspaceKey, actorUserId: auth.principal.userId,
    batchId: body.batchId, preflightApprovalId: randomUUID(),
    configurationRevision: CONFIGURATION_REVISION, stageChoices: choices, expiresAt,
  });
  if (!created.ok) return NextResponse.json({ code: created.code }, { status: created.status, headers: NO_STORE });
  return NextResponse.json({
    code: "TRIAGE_PREFLIGHT_APPROVED",
    approval: created.json,
    approvalStage: "preflight",
    budgetScope: "bounded_bytes_and_file_count",
    providerCalls: 0,
    monetaryCostStatus: "not_priced",
    costDisclosure: "Monetary infrastructure cost is not priced here. Approval is limited to the selected file count and declared byte total; no external OCR, LLM, compute reservation, or compile is authorized.",
    safetyDisclosure: "Encryption, corruption, archive expansion, malware, and content-disarm status remain unknown until verified by an authorized stage. This approval does not authorize OCR or parsing.",
  }, { headers: NO_STORE });
}
