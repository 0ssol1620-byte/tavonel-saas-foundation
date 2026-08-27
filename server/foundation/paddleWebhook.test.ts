import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePaddleEvent, projectPaddleEntitlement, verifyPaddleWebhookSignature } from "./paddleWebhook";

const secret = "test-only-webhook-secret-material";
const timestamp = 1_900_000_000;
const rawBody = JSON.stringify({
  event_id: "evt_foundation_001",
  event_type: "subscription.updated",
  occurred_at: "2030-03-17T17:46:40.000Z",
  data: {
    id: "sub_foundation_001",
    customer_id: "ctm_foundation_001",
    status: "active",
    custom_data: { workspace_id: "workspace-a" },
    items: [{ price: { id: "pri_studio", product_id: "pro_studio" } }],
  },
});
const signature = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`, "utf8").digest("hex");

describe("Paddle webhook contract", () => {
  it("requires a valid raw-body HMAC and a bounded timestamp", () => {
    expect(verifyPaddleWebhookSignature({ rawBody, signatureHeader: `ts=${timestamp};h1=${signature}`, endpointSecret: secret, now: timestamp * 1000 })).toBe(true);
    expect(verifyPaddleWebhookSignature({ rawBody: `${rawBody} `, signatureHeader: `ts=${timestamp};h1=${signature}`, endpointSecret: secret, now: timestamp * 1000 })).toBe(false);
    expect(verifyPaddleWebhookSignature({ rawBody, signatureHeader: `ts=${timestamp};h1=${signature}`, endpointSecret: secret, now: timestamp * 1000 + 301_000 })).toBe(false);
  });

  it("deduplicates, orders, and workspace-binds entitlement projections", () => {
    const event = parsePaddleEvent(rawBody);
    if (!event) throw new Error("fixture must parse");
    expect(projectPaddleEntitlement({ event, processedEventIds: new Set([event.event_id]), existing: null }).outcome).toBe("duplicate");
    expect(projectPaddleEntitlement({ event, processedEventIds: new Set(), existing: { workspaceId: "workspace-a", lastEventOccurredAt: new Date(event.occurred_at) } }).outcome).toBe("stale");
    expect(projectPaddleEntitlement({ event, processedEventIds: new Set(), existing: { workspaceId: "workspace-b", lastEventOccurredAt: null } }).outcome).toBe("ignored");
    expect(projectPaddleEntitlement({ event, processedEventIds: new Set(), existing: { workspaceId: "workspace-a", lastEventOccurredAt: null } })).toMatchObject({ outcome: "apply", workspaceId: "workspace-a", status: "active" });
  });
});
