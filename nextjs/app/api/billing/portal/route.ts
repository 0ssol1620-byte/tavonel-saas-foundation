import { NextResponse } from "next/server";
import { getFoundationBillingAccount } from "@/lib/billing-store";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { createPaddlePortalSession } from "@/lib/paddle-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers });
  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers });
  const { membership } = access;
  const stored = await getFoundationBillingAccount(membership.workspaceId, user.id);
  if (!stored.ok) return NextResponse.json({ code: stored.code }, { status: 503, headers });
  if (!stored.account.paddleCustomerId) {
    return NextResponse.json({ code: "PADDLE_CUSTOMER_NOT_FOUND" }, { status: 409, headers });
  }
  const portal = await createPaddlePortalSession({
    customerId: stored.account.paddleCustomerId,
    subscriptionId: stored.account.paddleSubscriptionId,
  });
  if (!portal.ok) return NextResponse.json({ code: portal.code }, { status: 503, headers });
  return NextResponse.json({ code: "PORTAL_READY", url: portal.url }, { headers });
}
