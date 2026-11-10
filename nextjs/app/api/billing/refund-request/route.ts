import { NextResponse } from "next/server";
import { getFoundationBillingAccount } from "@/lib/billing-store";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { OPERATIONS_ALERTS_RUNBOOK_URL, stableAlertId } from "@/lib/operations-alert-triggers";
import { deliverOperationsAlert } from "@/lib/operations-p0";
import { getPaddleSubscription } from "@/lib/paddle-api";
import { refundFacts, type RefundFacts } from "@/lib/refund-eligibility";
import { getWorkspaceMembership } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  One-step buy (2026-11-10). A paying customer's refund request, the smallest path that works.

  GET states the subscription's renewal date and where the refund rule stands for the latest
  payment (`lib/refund-eligibility.ts`). POST sends that same reading to the operations alert
  channel, where an operator decides it and refunds in Paddle by hand. Nothing here calls Paddle's
  refund or adjustment API, and the request is never refused for being outside the rule: mandatory
  consumer rights are assessed on their own facts (/refunds).

  The alert carries operator identifiers only (workspace key, subscription id) and no free text
  from the customer. A request that could not be delivered says so (503), never "sent".
*/

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

type Reading =
  | { ok: true; facts: RefundFacts; workspaceKey: string; subscriptionId: string }
  | { ok: false; response: NextResponse };

async function readRefund(request: Request): Promise<Reading> {
  const user = await getRequestUser(request);
  if (!user) return { ok: false, response: reply({ code: "AUTH_REQUIRED" }, 401) };
  const access = foundationPilotAccess(user.id);
  if (!access) return { ok: false, response: reply({ code: "PILOT_ACCESS_REQUIRED" }, 403) };
  const { workspaceId } = access.membership;
  const durable = await getWorkspaceMembership(workspaceId, user.id);
  if (!durable.ok) return { ok: false, response: reply({ code: durable.code }, durable.status) };
  if (durable.membership?.state !== "active") return { ok: false, response: reply({ code: "WORKSPACE_MEMBERSHIP_REQUIRED" }, 403) };
  const billing = await getFoundationBillingAccount(workspaceId, user.id);
  if (!billing.ok) return { ok: false, response: reply({ code: billing.code }, 503) };
  const { account } = billing;
  const subscriptionId = account.paddleSubscriptionId;
  if (!subscriptionId) return { ok: false, response: reply({ code: "REFUND_NO_PAID_PLAN" }, 409) };
  // Unread provider facts leave the dates null. They never become a guess.
  const subscription = await getPaddleSubscription(subscriptionId);
  const facts = refundFacts({
    accessPlan: account.accessPlan,
    creditBalance: account.creditBalance,
    paidAt: subscription.ok ? subscription.subscription.currentPeriodStartsAt : null,
    renewsAt: subscription.ok ? subscription.subscription.nextBilledAt : null,
  });
  if (!facts) return { ok: false, response: reply({ code: "REFUND_NO_PAID_PLAN" }, 409) };
  return { ok: true, facts, workspaceKey: workspaceId, subscriptionId };
}

export async function GET(request: Request) {
  const reading = await readRefund(request);
  return reading.ok ? reply({ code: "OK", facts: reading.facts }) : reading.response;
}

export async function POST(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return reply({ code: "CROSS_SITE_REQUEST_REJECTED" }, 403);
  }
  const reading = await readRefund(request);
  if (!reading.ok) return reading.response;
  const { facts, workspaceKey, subscriptionId } = reading;
  const rule = facts.eligible === null ? "unread" : facts.eligible ? "met" : "not met";
  const summary = `Refund request ${workspaceKey} ${subscriptionId}: ${facts.plan}, paid ${facts.paidAt?.slice(0, 10) ?? "unread"}, `
    + `${facts.consumedPages}/${facts.allowancePages} pages, rule ${rule}. Decide and refund in Paddle by hand.`;
  const delivery = await deliverOperationsAlert({
    alertId: stableAlertId(`refund_request:${subscriptionId}:${facts.paidAt ?? "unread"}`),
    kind: "incident",
    severity: "warning",
    service: "billing",
    summary: summary.slice(0, 240),
    observedAt: new Date().toISOString(),
    runbookUrl: OPERATIONS_ALERTS_RUNBOOK_URL,
  }).catch(() => ({ ok: false as const, code: "ALERT_PAYLOAD_INVALID" as const }));
  if (!delivery.ok) return reply({ code: "REFUND_REQUEST_UNDELIVERED" }, 503);
  return reply({ code: "REFUND_REQUEST_SENT", facts }, 202);
}
