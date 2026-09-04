import { NextResponse } from "next/server";
import { foundationPilotAccess, getRequestUser, readAccessMode } from "@/lib/foundation-pilot";
import { ensureSelfServiceOrganization } from "@/lib/self-service-provisioning";
import { bootstrapFoundationSelfServiceTrial } from "@/lib/self-service-trial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

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

  const access = await bootstrapFoundationSelfServiceTrial(request, user, pilot.membership.workspaceId);
  const headers: Record<string, string> = { ...NO_STORE };
  if (access.setCookie) headers["Set-Cookie"] = access.setCookie;

  if (!access.ok) {
    if (access.status === 429) headers["Retry-After"] = "86400";
    return NextResponse.json({ code: access.code }, { status: access.status, headers });
  }

  return NextResponse.json({
    code: "ACCESS_READY",
    access: {
      source: access.access.source,
      accessPlan: access.access.accessPlan,
      billingExempt: access.access.billingExempt,
      expiresAt: access.access.expiresAt,
      limits: access.limits ?? null,
    },
  }, { headers });
}
