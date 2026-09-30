import { NextResponse } from "next/server";
import { foundationPilotAccess, getRequestUser, readAccessMode } from "@/lib/foundation-pilot";
import { authorizationStage, readCustomerSourceAuthorization } from "@/lib/customer-data-admission";
import { issueProcessingWorkspaceGrant } from "@/lib/processing-workspace-grant";
import { ensureSelfServiceOrganization } from "@/lib/self-service-provisioning";
import { authorizeFoundationSessionProduct, bootstrapFoundationSelfServiceTrial } from "@/lib/self-service-trial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const NO_ENTITLEMENT_TRIAL_CODES = new Set([
  "TRIAL_DISABLED",
  "TRIAL_NOT_AVAILABLE",
  "TRIAL_NOT_ACTIVE",
  "TRIAL_DEVICE_ALREADY_USED",
  "TRIAL_REVIEW_REQUIRED",
]);
// Grant failures that mean "we could not check", not "this workspace is not qualified yet".
const GRANT_UNAVAILABLE_CODES = new Set([
  "WORKSPACE_GRANT_INPUT_INVALID",
  "WORKSPACE_GRANT_STORE_NOT_CONFIGURED",
  "WORKSPACE_GRANT_STORE_FAILED",
  "PROCESSING_TERMS_UNAVAILABLE",
  "SCOPED_RELEASE_INVALID",
]);

function sourcePendingReason(code: string) {
  if (code === "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" || code === "SCOPED_TERMS_ACCEPTANCE_REQUIRED") {
    return "terms_acceptance_required";
  }
  return code === "SCOPED_WORKSPACE_REFUSED" ? "workspace_refused" : "release_pending";
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: NO_STORE });

  const pilot = foundationPilotAccess(user.id);
  if (!pilot) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: NO_STORE });

  // First sign-in must establish the same persisted workspace identity every downstream surface
  // reads. This is intentionally explicit here rather than hidden in an authorization read.
  if (readAccessMode() === "self_service") {
    const provisioned = await ensureSelfServiceOrganization(user.id);
    if (!provisioned.ok) {
      return NextResponse.json({ code: provisioned.code }, { status: 503, headers: NO_STORE });
    }
  }

  // v2 only: renew this workspace's grant from what is already durable -- the owner's explicit
  // acceptance of the served terms and the current release decision for this deployment. Nothing
  // is accepted on the user's behalf; without an acceptance, release or with a refusal the gate
  // read below stays closed and the response says why.
  const scopedGate = process.env.TAVONEL_CUSTOMER_DATA_GATE_VERSION === "v2";
  let grantCode: string | null = null;
  if (scopedGate) {
    // The owner's own authenticated bootstrap is the only caller allowed a qualification grant; the
    // issuer still requires the recorded workspace, the deployed SHA and the owner's acceptance.
    const issued = await issueProcessingWorkspaceGrant({
      workspaceKey: pilot.membership.workspaceId, scope: "direct_upload", allowQualification: true,
    });
    if (!issued.ok) {
      if (readAccessMode() === "self_service" && GRANT_UNAVAILABLE_CODES.has(issued.code)) {
        return NextResponse.json({ code: "SOURCE_ACCESS_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
      }
      grantCode = issued.code;
    }
  }

  // A free evaluation must not begin counting down while this workspace cannot submit
  // a source. Existing owner/paid access remains visible, but a trial is only minted
  // after the same exact-workspace customer-data decision used by upload routes opens.
  const gate = await readCustomerSourceAuthorization(pilot.membership.workspaceId, "direct_upload");
  const customerDataEnabled = gate.ok;
  // Typed so the UI and billing can tell a bounded qualification from a release; never billable.
  const processingStage = gate.ok ? authorizationStage(gate.decision) : null;
  if (readAccessMode() === "self_service" && !gate.ok &&
    (gate.code === "CUSTOMER_DATA_GATE_STORE_NOT_CONFIGURED" ||
      gate.code === "CUSTOMER_DATA_GATE_STORE_FAILED" ||
      gate.code === "CUSTOMER_DATA_GATE_RECEIPT_INVALID" ||
      gate.code === "CUSTOMER_DATA_GATE_INPUT_INVALID" ||
      gate.code === "SCOPED_GATE_INPUT_INVALID" || gate.code === "SOURCE_GATE_VERSION_INVALID" ||
      gate.code === "SCOPED_GATE_STORE_NOT_CONFIGURED" || gate.code === "SCOPED_GATE_STORE_FAILED" ||
      gate.code === "SCOPED_RELEASE_INVALID" || gate.code === "SCOPED_WORKSPACE_INVALID" ||
      gate.code === "SCOPED_TERMS_UNAVAILABLE")) {
    return NextResponse.json({ code: "SOURCE_ACCESS_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
  if (readAccessMode() === "self_service" && !customerDataEnabled) {
    const existing = await authorizeFoundationSessionProduct(pilot.membership.workspaceId, user.id, "observer");
    if (!existing.ok && existing.status >= 500) {
      return NextResponse.json({ code: existing.code }, { status: existing.status, headers: NO_STORE });
    }
    return NextResponse.json({
      code: "ACCESS_READY_SOURCE_PENDING",
      ...(scopedGate && !gate.ok ? { sourcePending: sourcePendingReason(grantCode ?? gate.code) } : {}),
      access: existing.ok && existing.access.source !== "trial"
        ? { ...existing.access, limits: null, customerDataEnabled: false }
        : {
            source: "unentitled", accessPlan: null, billingExempt: false,
            expiresAt: null, limits: null, customerDataEnabled: false,
          },
    }, { headers: NO_STORE });
  }

  const access = await bootstrapFoundationSelfServiceTrial(request, user, pilot.membership.workspaceId);
  const headers: Record<string, string> = { ...NO_STORE };
  if (access.setCookie) headers["Set-Cookie"] = access.setCookie;

  if (!access.ok) {
    // A rejected free-compute grant is not a rejected identity. Keep the authenticated user in
    // their workspace so they can inspect the access state or purchase a plan, without issuing
    // trial limits or opening the separately verified customer-data gate.
    if (readAccessMode() === "self_service" && (access.status === 403 || access.status === 429)
      && NO_ENTITLEMENT_TRIAL_CODES.has(access.code)) {
      return NextResponse.json({
        code: "ACCESS_READY_NO_ENTITLEMENT",
        access: {
          source: "unentitled",
          accessPlan: null,
          billingExempt: false,
          expiresAt: null,
          limits: null,
          customerDataEnabled: false,
        },
      }, { headers });
    }
    if (access.status === 429) headers["Retry-After"] = "86400";
    return NextResponse.json({ code: access.code }, { status: access.status, headers });
  }

  // The UI must learn the same per-workspace decision the upload routes enforce.
  // A store outage is closed, never advertised as upload-ready.
  return NextResponse.json({
    code: "ACCESS_READY",
    access: {
      source: access.access.source,
      accessPlan: access.access.accessPlan,
      billingExempt: access.access.billingExempt,
      expiresAt: access.access.expiresAt,
      limits: access.limits ?? null,
      customerDataEnabled,
      processingStage,
    },
  }, { headers });
}
