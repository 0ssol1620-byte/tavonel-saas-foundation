import { createHmac, timingSafeEqual } from "node:crypto";
import type { SubscriptionState } from "../../shared/tenantDomain";

const allowedSubscriptionStates = new Set<SubscriptionState>([
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
  "inactive",
]);

export type PaddleEvent = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: {
    id: string;
    customer_id: string;
    status: SubscriptionState;
    items?: Array<{ price?: { id?: string; product_id?: string } }>;
    scheduled_change?: { effective_at?: string | null } | null;
    custom_data?: { workspace_id?: string };
  };
};

export type ExistingEntitlement = {
  workspaceId: string;
  lastEventOccurredAt: Date | null;
};

export type BillingProjection =
  | { outcome: "duplicate" | "stale" | "ignored"; reason: string }
  | {
      outcome: "apply";
      workspaceId: string;
      eventId: string;
      occurredAt: Date;
      subscriptionId: string;
      customerId: string;
      status: SubscriptionState;
      priceId: string | null;
      productId: string | null;
      scheduledChangeAt: Date | null;
    };

type ParsedSignature = { timestamp: number; signatures: string[] };

export function parsePaddleSignature(value: string): ParsedSignature | null {
  const parts = value.split(";").map(part => part.trim()).filter(Boolean);
  const timestampText = parts.find(part => part.startsWith("ts="))?.slice(3);
  const signatures = parts.filter(part => part.startsWith("h1=")).map(part => part.slice(3));
  if (!timestampText || !/^\d+$/.test(timestampText) || signatures.length === 0) return null;
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp)) return null;
  if (signatures.some(signature => !/^[a-f0-9]{64}$/i.test(signature))) return null;
  return { timestamp, signatures };
}

export function verifyPaddleWebhookSignature({
  rawBody,
  signatureHeader,
  endpointSecret,
  now = Date.now(),
  toleranceSeconds = 300,
}: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  endpointSecret: string | null | undefined;
  now?: number;
  toleranceSeconds?: number;
}) {
  if (!signatureHeader || !endpointSecret || endpointSecret.length < 16) return false;
  const parsed = parsePaddleSignature(signatureHeader);
  if (!parsed || Math.abs(now - parsed.timestamp * 1000) > toleranceSeconds * 1000) return false;

  const expected = createHmac("sha256", endpointSecret)
    .update(`${parsed.timestamp}:${rawBody}`, "utf8")
    .digest();

  return parsed.signatures.some(signature => {
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

export function parsePaddleEvent(rawBody: string): PaddleEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as Partial<PaddleEvent>;
    if (
      !parsed.event_id ||
      !parsed.event_type ||
      !parsed.occurred_at ||
      !parsed.data?.id ||
      !parsed.data.customer_id ||
      !parsed.data.status ||
      !allowedSubscriptionStates.has(parsed.data.status)
    ) {
      return null;
    }
    if (Number.isNaN(new Date(parsed.occurred_at).getTime())) return null;
    return parsed as PaddleEvent;
  } catch {
    return null;
  }
}

export function projectPaddleEntitlement({
  event,
  processedEventIds,
  existing,
}: {
  event: PaddleEvent;
  processedEventIds: ReadonlySet<string>;
  existing: ExistingEntitlement | null;
}): BillingProjection {
  if (processedEventIds.has(event.event_id)) return { outcome: "duplicate", reason: "event_id already processed" };
  if (event.event_type !== "subscription.created" && event.event_type !== "subscription.updated") {
    return { outcome: "ignored", reason: "event type does not project an entitlement" };
  }

  const occurredAt = new Date(event.occurred_at);
  if (existing?.lastEventOccurredAt && occurredAt.getTime() <= existing.lastEventOccurredAt.getTime()) {
    return { outcome: "stale", reason: "event occurred_at is not newer than the stored projection" };
  }

  const workspaceId = event.data.custom_data?.workspace_id;
  if (!workspaceId || (existing && existing.workspaceId !== workspaceId)) {
    return { outcome: "ignored", reason: "event is not bound to the expected workspace" };
  }

  const price = event.data.items?.[0]?.price;
  const scheduledChange = event.data.scheduled_change?.effective_at;
  return {
    outcome: "apply",
    workspaceId,
    eventId: event.event_id,
    occurredAt,
    subscriptionId: event.data.id,
    customerId: event.data.customer_id,
    status: event.data.status,
    priceId: price?.id ?? null,
    productId: price?.product_id ?? null,
    scheduledChangeAt: scheduledChange ? new Date(scheduledChange) : null,
  };
}
