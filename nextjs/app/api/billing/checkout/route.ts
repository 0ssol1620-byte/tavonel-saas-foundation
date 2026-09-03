import { NextResponse } from "next/server";
import { createCheckoutBinding } from "@/lib/billing-binding";
import { isBillingOfferCode, readConfiguredBillingOffers, readPaddleBrowserConfig } from "@/lib/billing-catalog";
import { readCommercialState } from "@/lib/commercial-state";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > 2_048) {
    return NextResponse.json({ code: "BILLING_REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  }
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: NO_STORE });

  let body: { offerCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
  }
  if (!isBillingOfferCode(body.offerCode)) {
    return NextResponse.json({ code: "BILLING_OFFER_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const paddle = readPaddleBrowserConfig();
  const offer = readConfiguredBillingOffers().get(body.offerCode);
  const secret = process.env.FOUNDATION_BILLING_HMAC?.trim() ?? "";
  if (!paddle || !offer || secret.length < 32) {
    return NextResponse.json({ code: "BILLING_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }
  // checkoutEnabled, not liveChargesEnabled: sandbox must stay able to open a session so the
  // end-to-end payment path can be qualified before it is ever pointed at a real card.
  if (!readCommercialState().checkoutEnabled) {
    return NextResponse.json({ code: "BILLING_LAUNCH_PENDING" }, { status: 503, headers: NO_STORE });
  }
  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: NO_STORE });
  const { membership } = access;
  const customData = createCheckoutBinding(
    { userId: user.id, workspaceId: membership.workspaceId, offerCode: body.offerCode },
    secret,
  );
  return NextResponse.json({
    code: "CHECKOUT_READY",
    environment: paddle.environment,
    clientToken: paddle.clientToken,
    offer: { code: offer.code, kind: offer.kind, label: offer.label, priceId: offer.priceId, credits: offer.credits },
    customer: user.email ? { email: user.email } : undefined,
    customData,
  }, { headers: NO_STORE });
}
