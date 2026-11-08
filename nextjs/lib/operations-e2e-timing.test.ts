import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), audit: vi.fn(), enterprise: vi.fn() }));
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://store.test", serviceRoleKey: "k".repeat(40) }),
  supabaseAdminRequest: (_config: unknown, path: string, init?: RequestInit) => mocks.request(path, init),
}));
vi.mock("./enterprise-auth", () => ({ authorizeEnterpriseRequest: mocks.enterprise }));

import { buildEndToEndTiming, recordFirstMcpAnswerTiming, resetEndToEndTimingMemo } from "./operations-e2e-timing";
import { GET as exportAudit } from "../app/api/enterprise/audit/export/route";

const WS = "pilot-e2e01";
const WORLD = `collection-${"c".repeat(32)}`;
const DOCS = ["0e200000-0000-4000-8000-00000000000a", "0e200000-0000-4000-8000-00000000000b"];
const ANSWERED = Date.parse("2026-11-04T10:00:00Z");
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const receipts = new Map<string, unknown>();
const auditRows: Record<string, unknown>[] = [];

function store(overrides: Partial<Record<"world" | "job" | "events" | "admissions", unknown>> = {}) {
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/rest/v1/rpc/record_foundation_operations_receipt") {
      const result = await mocks.audit(JSON.parse(String(init?.body)));
      if (result !== undefined) return result as Response;
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      const key = `${body.p_kind}:${body.p_workspace_key}:${body.p_target_id}`;
      const first = !receipts.has(key);
      if (first) receipts.set(key, body.p_details);
      return json(first);
    }
    if (path.startsWith("/rest/v1/enterprise_audit_events")) {
      if (init?.method === "POST") auditRows.push(JSON.parse(String(init.body)));
      return json(auditRows);
    }
    if (path.startsWith("/rest/v1/foundation_active_worlds")) return json(overrides.world ?? [{ updated_at: "2026-11-04T09:50:00Z" }]);
    if (path.startsWith("/rest/v1/foundation_compile_jobs")) return json(overrides.job ?? [{ job_id: `cjob-${"e".repeat(32)}`, document_ids: DOCS }]);
    if (path.startsWith("/rest/v1/foundation_compile_job_events")) return json(overrides.events ?? [{ occurred_at: "2026-11-04T09:40:00Z" }]);
    if (path.startsWith("/rest/v1/foundation_intake_admissions")) {
      return json(overrides.admissions ?? [{ confirmed_at: "2026-11-04T09:30:00Z" }, { confirmed_at: "2026-11-04T09:31:00Z" }]);
    }
    return new Response("[]", { status: 404 });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetEndToEndTimingMemo();
  receipts.clear();
  auditRows.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("buildEndToEndTiming", () => {
  it("measures each hop and leaves an unknown or out-of-order hop null", () => {
    const receipt = buildEndToEndTiming({
      collectionId: WORLD, documents: 2, uploadConfirmedAt: "2026-11-04T09:31:00.000Z", readyAt: null,
      activatedAt: "2026-11-04T09:50:00.000Z", firstMcpAnswerAt: "2026-11-04T09:49:00.000Z",
    });
    expect(receipt.seconds).toEqual({ uploadToReady: null, readyToActivate: null, activateToFirstAnswer: null, total: 1080 });
  });
});

describe("recordFirstMcpAnswerTiming", () => {
  it("records one internal operations receipt from the records that own each instant", async () => {
    store();
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED)).toBe("recorded");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    const event = mocks.audit.mock.calls[0]![0];
    expect(event).toMatchObject({ p_kind: "e2e_timing", p_workspace_key: WS, p_target_id: WORLD });
    expect(event.p_details).toEqual({
      schemaVersion: "tavonel.e2e_timing.v1", collectionId: WORLD, documents: 2,
      uploadConfirmedAt: "2026-11-04T09:31:00.000Z", readyAt: "2026-11-04T09:40:00.000Z",
      activatedAt: "2026-11-04T09:50:00.000Z", firstMcpAnswerAt: "2026-11-04T10:00:00.000Z",
      seconds: { uploadToReady: 540, readyToActivate: 600, activateToFirstAnswer: 600, total: 1740 },
    });
    // The event reads the first ready/review_required event, not whichever came last.
    expect(mocks.request.mock.calls.map(([path]) => String(path)).find((path) => path.includes("compile_job_events")))
      .toContain("state=in.%28review_required%2Cready%29");
  });

  it("records once per World per process, and the store keeps the first receipt across processes", async () => {
    store();
    await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED);
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED + 1_000)).toBe("already_recorded");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    resetEndToEndTimingMemo(); // a second instance
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED + 2_000)).toBe("already_recorded");
    expect((receipts.get(`e2e_timing:${WS}:${WORLD}`) as { firstMcpAnswerAt: string }).firstMcpAnswerAt).toBe("2026-11-04T10:00:00.000Z");
  });

  it("never reaches the customer audit log: the audit export of that workspace does not carry it", async () => {
    store();
    auditRows.push({ event_id: "e1", workspace_key: WS, action: "source.uploaded", occurred_at: "2026-11-04T09:30:00Z" });
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED)).toBe("recorded");
    expect(mocks.request.mock.calls.some(([path, init]) => String(path).startsWith("/rest/v1/enterprise_audit_events") && init?.method === "POST")).toBe(false);
    mocks.enterprise.mockResolvedValue({ ok: true, principal: { organizationId: "0e200000-0000-4000-8000-0000000000aa" } });
    const exported = await exportAudit(new Request("https://t.test/api/enterprise/audit/export?from=2026-11-01T00:00:00Z&to=2026-11-05T00:00:00Z"));
    const text = await exported.text();
    expect([exported.status, exported.headers.get("X-TAVONEL-Export-Count")]).toEqual([200, "1"]);
    expect(text).not.toMatch(/e2e_timing|operations./);
  });

  it("does not record a World that is not active, and tries again on the next answer", async () => {
    store({ world: [] });
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED)).toBe("not_recorded");
    store();
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED)).toBe("recorded");
  });

  it("never invents an upload instant: one unconfirmed document leaves it null", async () => {
    store({ admissions: [{ confirmed_at: "2026-11-04T09:30:00Z" }, { confirmed_at: null }] });
    await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED);
    expect(mocks.audit.mock.calls[0]![0].p_details).toMatchObject({ uploadConfirmedAt: null, seconds: { uploadToReady: null, total: null } });
  });

  it("retries after a failed receipt write, and refuses malformed identifiers without a read", async () => {
    store();
    mocks.audit.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED)).toBe("not_recorded");
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED)).toBe("recorded");
    mocks.request.mockClear();
    expect(await recordFirstMcpAnswerTiming("../etc", WORLD)).toBe("not_recorded");
    expect(await recordFirstMcpAnswerTiming(WS, "collection-x")).toBe("not_recorded");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not throw when the store does", async () => {
    mocks.request.mockRejectedValue(new Error("down"));
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED)).toBe("not_recorded");
  });
});
