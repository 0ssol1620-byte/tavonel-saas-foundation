import { NextResponse } from "next/server";
import { getFoundationBillingAccount } from "@/lib/billing-store";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers });
  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers });
  const { membership } = access;
  const result = await getFoundationBillingAccount(membership.workspaceId, user.id);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers });
  return NextResponse.json({ code: "OK", account: result.account }, { headers });
}
