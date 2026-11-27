import { NextResponse } from "next/server";
import { getFoundationAccountGrant } from "@/lib/account-grants";
import { createCheckoutBinding } from "@/lib/billing-binding";
import { billingSecret } from "@/lib/billing-secrets";
import { BILLING_OFFERS, isBillingOfferCode, readConfiguredBillingOffers, readPaddleBrowserConfig } from "@/lib/billing-catalog";
import { getFoundationBillingAccount, issueFoundationCheckoutIntent } from "@/lib/billing-store";
import { quoteCheckout } from "@/lib/checkout-quote";
import { readCommercialState } from "@/lib/commercial-state";
import { decideCheckoutPolicy, decideOfferCheckoutPolicy, decideSubscriptionChange } from "@/lib/checkout-policy";
import { authorizationStage, readCustomerSourceAuthorization } from "@/lib/customer-data-admission";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { readPublicStatusV2 } from "@/lib/public-status";
import { listWorkspaceInvites, listWorkspaceMembers } from "@/lib/workspace-membership";

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

  // An explicit billing-exempt owner grant is the source of truth for the product owner. Do not
  // create another Paddle checkout merely because an old provider record exists or the UI still
  // has a purchase button somewhere.
  const grant = await getFoundationAccountGrant(user.id);
  if (!grant.ok) return NextResponse.json({ code: grant.code }, { status: 503, headers: NO_STORE });
  if (grant.grant?.billingExempt) {
    return NextResponse.json({ code: "OWNER_ACCESS_ACTIVE" }, { status: 409, headers: NO_STORE });
  }

  let body: { offerCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
  }
  if (!isBillingOfferCode(body.offerCode)) {
    return NextResponse.json({ code: "BILLING_OFFER_INVALID" }, { status: 400, headers: NO_STORE });
  }
  // The offer policy runs first: a plan that is not sold online answers 403 whether or not its price env
  // is set, so an unset v2 price is the same refusal as an undelivered one, never 503 BILLING_NOT_CONFIGURED.
  const offerPolicy = decideOfferCheckoutPolicy({ code: body.offerCode, saleChannel: BILLING_OFFERS[body.offerCode].saleChannel });
  if (!offerPolicy.allowed) {
    return NextResponse.json({ code: offerPolicy.code }, { status: 403, headers: NO_STORE });
  }
  const paddle = readPaddleBrowserConfig();
  const offer = readConfiguredBillingOffers().get(body.offerCode);
  // The one reader: a value with surrounding whitespace is refused, never trimmed (lib/billing-secrets.ts).
  const secret = billingSecret("FOUNDATION_BILLING_HMAC");
  if (!paddle || !offer || !secret) {
    return NextResponse.json({ code: "BILLING_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }
  const commercial = readCommercialState();
  const checkoutPolicy = decideCheckoutPolicy(
    commercial,
    readPublicStatusV2().availableActions.purchasePlan.enabled,
  );
  if (!checkoutPolicy.allowed) {
    return NextResponse.json({ code: checkoutPolicy.code }, { status: 503, headers: NO_STORE });
  }
  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: NO_STORE });
  const { membership } = access;
  // One subscription per workspace: a live one refuses a second checkout (see `decideSubscriptionChange`).
  const billing = await getFoundationBillingAccount(membership.workspaceId, user.id);
  if (!billing.ok) return NextResponse.json({ code: billing.code }, { status: 503, headers: NO_STORE });
  const change = decideSubscriptionChange(billing.account, body.offerCode);
  if (!change.allowed) return NextResponse.json({ code: change.code }, { status: 409, headers: NO_STORE });
  // Personal and Developer are one-person plans. A workspace that already has another active member, or an
  // invitation still open, is refused before an intent: the seat function caps new invitations, never the
  // people already in. An operator grant answered OWNER_ACCESS_ACTIVE above, so it never reaches this count.
  // A count that cannot be read refuses too; it is never read as "one member".
  if (body.offerCode === "personal" || body.offerCode === "developer") {
    const [members, invites] = await Promise.all([
      listWorkspaceMembers(membership.workspaceId),
      listWorkspaceInvites(membership.workspaceId),
    ]);
    if (!members.ok) return NextResponse.json({ code: members.code }, { status: members.status, headers: NO_STORE });
    if (!invites.ok) return NextResponse.json({ code: invites.code }, { status: invites.status, headers: NO_STORE });
    const now = Date.now();
    const active = members.members.filter((row) => row?.state === "active").length;
    const open = invites.invites.filter((row) => row?.state === "pending" && Date.parse(String(row.expires_at)) > now).length;
    if (active > 1 || open > 0) {
      return NextResponse.json({ code: "WORKSPACE_HAS_MEMBERS" }, { status: 409, headers: NO_STORE });
    }
  }
  // A deployment-wide launch switch is not permission for this customer's sources. In live mode
  // refuse payment before creating a durable checkout intent unless the same workspace receipt
  // that intake and compilation require is current and valid. Sandbox qualification remains
  // available without a customer-data receipt because it cannot charge a real card.
  // A qualification grant admits the operator's own processing check, never a purchase.
  if (commercial.provider === "production") {
    const gate = await readCustomerSourceAuthorization(membership.workspaceId, "direct_upload");
    if (!gate.ok) {
      return NextResponse.json({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" }, { status: 403, headers: NO_STORE });
    }
    if (authorizationStage(gate.decision) !== "production") {
      return NextResponse.json({ code: "PROCESSING_QUALIFICATION_NOT_BILLABLE" }, { status: 403, headers: NO_STORE });
    }
  }
  // The quote is computed before anything is signed or recorded: a quote that cannot be made leaves no
  // intent behind, because `use-checkout` opens no overlay without one and the intent would be orphaned.
  const quote = await quoteCheckout(offer);
  const customData = createCheckoutBinding(
    { userId: user.id, workspaceId: membership.workspaceId, offerCode: body.offerCode },
    secret,
  );
  // No binding leaves this route without a durable record of what it authorized; the webhook
  // settles against that record, not against whatever the gate says when payment lands.
  const intent = await issueFoundationCheckoutIntent(customData, offer);
  if (!intent.ok) {
    return NextResponse.json(
      { code: intent.code },
      { status: intent.code === "OWNER_ACCESS_ACTIVE" ? 409 : 503, headers: NO_STORE },
    );
  }
  return NextResponse.json({
    code: "CHECKOUT_READY",
    environment: paddle.environment,
    clientToken: paddle.clientToken,
    offer: { code: offer.code, kind: offer.kind, label: offer.label, priceId: offer.priceId, credits: offer.credits },
    quote,
    customer: user.email ? { email: user.email } : undefined,
    customData,
  }, { headers: NO_STORE });
}
