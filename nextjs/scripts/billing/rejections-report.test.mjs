import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_LIMIT,
  REJECTION_REPORT_SCHEMA,
  buildRejectionReport,
  parseLimit,
  readUnresolvedRejections,
} from "./rejections-report.mjs";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const EVENT = `evt_${"a".repeat(26)}`;

function row(overrides = {}) {
  return {
    eventId: EVENT,
    eventType: "transaction.completed",
    occurredAt: "2026-09-27T01:00:00+00:00",
    recordedAt: "2026-09-27T02:00:00+00:00",
    action: "purchase",
    reason: "checkout_intent_expired",
    workspaceKey: "pilot-acme01",
    offerCode: "studio_access",
    priceId: `pri_${"b".repeat(26)}`,
    transactionId: `txn_${"c".repeat(26)}`,
    subscriptionId: `sub_${"d".repeat(26)}`,
    ...overrides,
  };
}

describe("billing rejection report", () => {
  it("projects only the enumerated fields and names the runbook step", () => {
    const report = buildRejectionReport({
      unresolvedTotal: 1,
      oldestRecordedAt: "2026-09-27T02:00:00+00:00",
      rows: [row({ userId: "99999999-9999-4999-8999-999999999999", customerId: "ctm_x", email: "a@b.c" })],
    }, NOW);

    expect(report).toEqual({
      schemaVersion: REJECTION_REPORT_SCHEMA,
      generatedAt: NOW.toISOString(),
      unresolvedTotal: 1,
      oldestRecordedAt: "2026-09-27T02:00:00.000Z",
      truncated: false,
      rows: [{
        eventId: EVENT,
        eventType: "transaction.completed",
        action: "purchase",
        reason: "checkout_intent_expired",
        nextStep: "repair_or_refund",
        occurredAt: "2026-09-27T01:00:00.000Z",
        recordedAt: "2026-09-27T02:00:00.000Z",
        ageHours: 10,
        workspaceKey: "pilot-acme01",
        offerCode: "studio_access",
        priceId: `pri_${"b".repeat(26)}`,
        transactionId: `txn_${"c".repeat(26)}`,
        subscriptionId: `sub_${"d".repeat(26)}`,
      }],
    });
  });

  it("nulls malformed values instead of printing them, and drops rows with no Paddle event id", () => {
    const report = buildRejectionReport({
      unresolvedTotal: 3,
      rows: [
        row({ eventId: "evt_bad" }),
        row({
          reason: "x".repeat(200),
          workspaceKey: "someone@example.com",
          transactionId: "txn_<script>",
          recordedAt: "not a date",
        }),
      ],
    }, NOW);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      reason: null,
      nextStep: "investigate",
      workspaceKey: null,
      transactionId: null,
      recordedAt: null,
      ageHours: null,
    });
    expect(report.truncated).toBe(true);
  });

  it("never suggests a refund for an unknown reason or an inherited property name", () => {
    for (const reason of ["checkout_binding_reuse_conflict", "constructor", "to_string"]) {
      expect(buildRejectionReport({ rows: [row({ reason })] }, NOW).rows[0].nextStep).toBe("investigate");
    }
    expect(buildRejectionReport({ rows: [row({ reason: "checkout_account_billing_exempt" })] }, NOW)
      .rows[0].nextStep).toBe("refund");
  });

  it("caps rows and reports an unknown total as truncated", () => {
    const report = buildRejectionReport({ rows: Array.from({ length: 80 }, () => row()) }, NOW);
    expect(report.rows).toHaveLength(MAX_LIMIT);
    expect(report.unresolvedTotal).toBeNull();
    expect(report.truncated).toBe(true);
    expect(buildRejectionReport(null, NOW).rows).toEqual([]);
  });

  it("bounds --limit", () => {
    expect(parseLimit([])).toBe(25);
    expect(parseLimit(["--limit", "50"])).toBe(50);
    for (const bad of ["0", "51", "2.5", "abc"]) expect(() => parseLimit(["--limit", bad])).toThrow();
    expect(() => parseLimit(["--limit"])).toThrow();
  });

  it("calls only the read RPC and does not echo an error body", async () => {
    const request = vi.fn(async () => new Response("secret row detail", { status: 403 }));
    await expect(readUnresolvedRejections({}, 10, request)).rejects.toThrow(
      /^list_foundation_billing_event_rejections -> HTTP 403$/,
    );
    expect(request).toHaveBeenCalledWith({}, "/rest/v1/rpc/list_foundation_billing_event_rejections",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ p_limit: 10 }) }));
  });
});

describe("billing rejection review migration", () => {
  const sql = readFileSync(resolve(
    process.cwd(),
    "../supabase/migrations/20260927130000_billing_rejection_review.sql",
  ), "utf8");

  it("is a bounded, read-only, service-role-only definer function", () => {
    expect(sql).toMatch(/stable\nsecurity definer\nset search_path = public, pg_temp/);
    expect(sql).toMatch(/revoke all on function public\.list_foundation_billing_event_rejections\(integer\)\s+from public, anon, authenticated;/);
    expect(sql).toContain("grant execute on function public.list_foundation_billing_event_rejections(integer) to service_role;");
    expect(sql).toContain("limit least(greatest(coalesce(p_limit, 25), 1), 50)");
    expect(sql.match(/where resolved_at is null/g)).toHaveLength(3);
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    expect(sql).not.toMatch(/grant [a-z, ]+ on public\.foundation_billing_event_rejections/i);
  });

  it("does not return identity, customer, nonce or payload columns", () => {
    const body = sql.slice(sql.indexOf("as $$"), sql.lastIndexOf("$$"));
    for (const column of ["r.user_id", "r.customer_id", "r.binding_nonce", "r.payload_sha256"]) {
      expect(body).not.toContain(column);
    }
  });
});
