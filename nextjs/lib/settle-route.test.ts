/**
 * A refusal has to survive the worker that reported it.
 *
 * The CDR worker's only outbound channel is this endpoint, which is why a permanently refused
 * source used to exist nowhere but a billing release: the reservation was let go, the queue
 * message was acknowledged, and no state, row or audit event was written. The customer watched a
 * stage that would never move and, after a reload, could not find the file at all.
 *
 * What is fixed here is the other half of that: the settlement now carries the terminal reason,
 * and this endpoint turns it into a document state and exactly one `enterprise_audit_events` row
 * (founder B-6). Delivery is at-least-once, so "exactly one" is the assertion that matters, and
 * a write it cannot complete has to fail the request rather than report success -- otherwise the
 * worker acknowledges a refusal nobody recorded, which is the bug all over again.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { settle, verify, adminConfig, adminRequest } = vi.hoisted(() => ({
  settle: vi.fn(),
  verify: vi.fn(),
  adminConfig: vi.fn(),
  adminRequest: vi.fn(),
}));

vi.mock("@/lib/compute-reservation", () => ({ settleFoundationCompute: settle }));
vi.mock("@/lib/compute-settlement-auth", () => ({ verifyComputeSettlementRequest: verify }));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: adminConfig,
  supabaseAdminRequest: adminRequest,
}));

import { POST } from "../app/api/internal/billing/settle/route";

const workspaceKey = "pilot-969dc192daa24119";
const documentId = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const organizationId = "1b2f7a10-1111-4111-8111-111111111111";

type AdminCall = { path: string; method: string; body: unknown };

function calls(): AdminCall[] {
  return adminRequest.mock.calls.map(([, path, init]) => ({
    path: String(path),
    method: String(init?.method ?? "GET"),
    body: init?.body ? JSON.parse(String(init.body)) : null,
  }));
}

function request(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return new Request("https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(raw, "utf8")) },
    body: raw,
  });
}

const refusal = {
  workspaceKey,
  documentId,
  outcome: "released",
  actualCredits: 0,
  reasonCode: "CDR_PERMANENT_REJECT",
  failureClass: "PARSER_OOM",
  terminalReason: "quarantine source exceeds the 5 MiB Foundation CDR cap",
};

/** Every write succeeds unless a test says otherwise. */
function healthyStore() {
  adminRequest.mockReset().mockImplementation(async (_config: unknown, path: string) =>
    path.startsWith("/rest/v1/enterprise_workspaces")
      ? new Response(JSON.stringify([{ organization_id: organizationId }]), { status: 200 })
      : new Response(null, { status: 204 }));
}

beforeEach(() => {
  verify.mockReset().mockReturnValue(true);
  settle.mockReset().mockResolvedValue({ ok: true, result: { status: "processed", reservationId: documentId } });
  adminConfig.mockReset().mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "x".repeat(40) });
  healthyStore();
});

describe("compute settlement endpoint", () => {
  it("records a terminal refusal as a document state and one audit row", async () => {
    const response = await POST(request(refusal));
    expect(response.status).toBe(200);

    const admissions = calls().filter((call) => call.path.includes("refuse_foundation_intake_admission"));
    expect(admissions).toHaveLength(1);
    expect(admissions[0].method).toBe("POST");
    expect(admissions[0].body).toEqual({
      p_workspace_key: workspaceKey,
      p_document_id: documentId,
      p_reason_code: "CDR_PERMANENT_REJECT",
    });

    const audits = calls().filter((call) => call.path.startsWith("/rest/v1/enterprise_audit_events"));
    expect(audits).toHaveLength(1);
    expect(audits[0].body).toMatchObject({
      organization_id: organizationId,
      workspace_key: workspaceKey,
      action: "source.intake_refused",
      target_type: "document",
      target_id: documentId,
      actor_kind: "service",
      outcome: "failed",
      details: {
        reasonCode: "CDR_PERMANENT_REJECT",
        failureClass: "PARSER_OOM",
        terminalReason: refusal.terminalReason,
      },
    });
    // No person did this, and the table's own check refuses a user actor without a user id.
    expect(audits[0].body).not.toHaveProperty("actor_user_id");
  });

  it("lands on the same audit row when the queue redelivers the message", async () => {
    await POST(request(refusal));
    const first = calls().find((call) => call.path.startsWith("/rest/v1/enterprise_audit_events"));
    healthyStore();
    await POST(request(refusal));
    const second = calls().find((call) => call.path.startsWith("/rest/v1/enterprise_audit_events"));

    const firstBody = first?.body as { event_id?: string };
    const secondBody = second?.body as { event_id?: string };
    expect(firstBody.event_id).toBe(secondBody.event_id);
    expect(firstBody.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // The second write is a no-op at the database rather than a second row.
    expect(second?.path).toContain("on_conflict=event_id");
    expect(adminRequest.mock.calls.at(-1)?.[2]?.headers?.Prefer).toContain("resolution=ignore-duplicates");
  });

  it("fails the settlement when the refusal cannot be recorded", async () => {
    adminRequest.mockReset().mockImplementation(async (_config: unknown, path: string) =>
      path.includes("refuse_foundation_intake_admission")
        ? new Response(null, { status: 503 })
        : new Response(JSON.stringify([{ organization_id: organizationId }]), { status: 200 }));
    const response = await POST(request(refusal));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "INTAKE_STATE_WRITE_FAILED" });
  });

  it("fails the settlement when the audit row cannot be written", async () => {
    adminRequest.mockReset().mockImplementation(async (_config: unknown, path: string) =>
      path.startsWith("/rest/v1/enterprise_audit_events")
        ? new Response(null, { status: 500 })
        : path.startsWith("/rest/v1/enterprise_workspaces")
          ? new Response(JSON.stringify([{ organization_id: organizationId }]), { status: 200 })
          : new Response(null, { status: 204 }));
    const response = await POST(request(refusal));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "ENTERPRISE_AUDIT_WRITE_FAILED" });
  });

  it("writes no state and no audit row for an ordinary settlement", async () => {
    const response = await POST(request({
      workspaceKey,
      documentId,
      outcome: "settled",
      actualCredits: 2,
      reasonCode: "OCR_COMPLETED",
      sourceSha256: `sha256:${"a".repeat(64)}`,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "SETTLEMENT_APPLIED",
      sourceSha256: `sha256:${"a".repeat(64)}`,
    });
    expect(calls()).toHaveLength(0);
  });

  it("refuses a digest that is not one, rather than passing it on", async () => {
    const response = await POST(request({
      workspaceKey,
      documentId,
      outcome: "settled",
      actualCredits: 2,
      reasonCode: "OCR_COMPLETED",
      sourceSha256: "sha256:not-a-digest",
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.not.toHaveProperty("sourceSha256");
  });

  it("does not touch the ledger's own failures", async () => {
    settle.mockResolvedValue({ ok: false, code: "COMPUTE_SETTLEMENT_CONFLICT" });
    const response = await POST(request(refusal));
    expect(response.status).toBe(503);
    expect(calls()).toHaveLength(0);
  });
});
