import { NextResponse } from "next/server";
import { applyFoundationBillingAction } from "@/lib/billing-store";
import { recordServerFunnel } from "@/lib/funnel-events";
import { parsePaddleBillingAction } from "@/lib/paddle-billing-event";
import { verifyPaddleSignature } from "@/lib/paddle-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ code: "BILLING_NOT_CONFIGURED" }, { status: 503, headers });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 512 * 1024) {
    return NextResponse.json({ code: "WEBHOOK_TOO_LARGE" }, { status: 413, headers });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 512 * 1024) {
    return NextResponse.json({ code: "WEBHOOK_TOO_LARGE" }, { status: 413, headers });
  }
  if (!verifyPaddleSignature(rawBody, request.headers.get("paddle-signature"), secret)) {
    return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 401, headers });
  }
  const action = parsePaddleBillingAction(rawBody);
  if (!action) return NextResponse.json({ code: "EVENT_ENVELOPE_INVALID" }, { status: 200, headers });
  if (action.action === "ignored") {
    return NextResponse.json({ code: "EVENT_IGNORED", eventId: action.eventId, reason: action.reason }, { status: 200, headers });
  }
  const applied = await applyFoundationBillingAction(action);
  if (!applied.ok) return NextResponse.json({ code: applied.code }, { status: 503, headers });
  /*
    The paid hop, from the receipt rather than from the browser that came back from checkout.
    `checkout_completed` already counts the return trip; this counts the subscription the
    provider says is active, which is the one that can be reconciled against revenue.

    Only `subscription.activated`. Paddle's renewal arrives as a transaction against an existing
    subscription, and this handler sees one event at a time with no history to compare it to, so
    §15.2's `subscription_retained` is not derivable here -- it is a cohort reading, and
    `lib/activation-cohorts.ts` is where repeat value is computed.

    And only on the application that persisted the event. Paddle redelivers, so the projection
    answers an event it has already stored with `status: "duplicate"`
    (`apply_foundation_billing_event_v3`, migration 0011, reached through v4) -- a redelivery is
    the same subscription arriving twice, not a second one starting.
  */
  if (action.action === "subscription"
    && action.eventType === "subscription.activated"
    && applied.result.status !== "duplicate") {
    recordServerFunnel("subscription_started", { offer: action.offerCode });
  }
  console.info("foundation_billing_event_applied", {
    eventType: action.eventType,
    action: action.action,
    result: typeof applied.result.status === "string" ? applied.result.status : "unknown",
    /*
      20260911130000: the included-page credit this grant expired, 0 on every other event.

      The expiry is a durable ledger row with its own `kind`, so nothing depends on this line --
      but a month's pages disappearing from a balance is the kind of thing support hears about
      before anyone queries the ledger, and the RPC already returns the number. An integer about
      the workspace's own billing: no document name, question, locator or key, and nothing route-,
      score- or cost-matrix-shaped.
    */
    expiredIncludedUnits:
      typeof applied.result.expiredIncludedUnits === "number" ? applied.result.expiredIncludedUnits : 0,
  });
  return NextResponse.json({ code: "EVENT_APPLIED", eventId: action.eventId, result: applied.result }, { status: 200, headers });
}
