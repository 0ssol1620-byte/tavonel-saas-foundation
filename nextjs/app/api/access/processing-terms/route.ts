import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/enterprise-http";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import {
  loadPublishedProcessingTerms,
  parseProcessingTermsAcceptanceRequest,
  PROCESSING_TERMS_SCOPES,
  recordProcessingTermsAcceptance,
} from "@/lib/processing-terms-acceptance";
import { getWorkspaceMembership } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET() {
  const published = await loadPublishedProcessingTerms();
  if (!published.ok) return reply({ code: published.code }, published.status);
  return reply({ ...published.manifest, scopes: PROCESSING_TERMS_SCOPES });
}

// Records agreement only. It does not open customer-data processing, start a trial or charge.
export async function POST(request: Request) {
  // Bearer-only like every authenticated route here (lib/security/route-classification.json);
  // additionally refuse a browser-labelled cross-site post and non-JSON bodies.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return reply({ code: "CROSS_SITE_REQUEST_REJECTED" }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reply({ code: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }
  const user = await getRequestUser(request);
  if (!user) return reply({ code: "AUTH_REQUIRED" }, 401);
  const pilot = foundationPilotAccess(user.id);
  if (!pilot) return reply({ code: "PILOT_ACCESS_REQUIRED" }, 403);

  const body = await readBoundedJson(request, 2_048);
  if (!body.ok) return reply({ code: body.code }, body.status);

  const published = await loadPublishedProcessingTerms();
  if (!published.ok) return reply({ code: published.code }, published.status);
  const offer = parseProcessingTermsAcceptanceRequest(body.value, published.manifest);
  if (!offer.ok) return reply({ code: offer.code }, offer.status);

  // Durable membership, not paid entitlement: agreeing comes before any trial or plan.
  const found = await getWorkspaceMembership(pilot.membership.workspaceId, user.id);
  if (!found.ok) return reply({ code: found.code }, found.status);
  if (found.membership?.state !== "active" || found.membership.role !== "owner") {
    return reply({ code: "WORKSPACE_OWNER_REQUIRED" }, 403);
  }

  const recorded = await recordProcessingTermsAcceptance({
    workspaceKey: pilot.membership.workspaceId,
    userId: user.id,
    scope: offer.scope,
    manifest: published.manifest,
    requestId: randomUUID(),
  });
  if (!recorded.ok) return reply({ code: recorded.code }, recorded.status);
  const { receipt } = recorded;
  return reply({
    code: "PROCESSING_TERMS_ACCEPTED",
    receipt: {
      acceptanceId: receipt.acceptanceId,
      scope: receipt.scope,
      termsVersion: receipt.termsVersion,
      terms: receipt.terms,
      processing: receipt.processing,
      acceptedAt: receipt.acceptedAt,
      idempotentReplay: receipt.idempotentReplay,
    },
  }, receipt.idempotentReplay ? 200 : 201);
}
