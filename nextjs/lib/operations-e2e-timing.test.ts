import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), audit: vi.fn() }));
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://store.test", serviceRoleKey: "k".repeat(40) }),
  supabaseAdminRequest: (_config: unknown, path: string) => mocks.request(path),
}));
vi.mock("./enterprise-store", () => ({ appendServiceAuditEvent: mocks.audit }));

import { buildEndToEndTiming, recordFirstMcpAnswerTiming, resetEndToEndTimingMemo } from "./operations-e2e-timing";

const WS = "pilot-e2e01";
const WORLD = `collection-${"c".repeat(32)}`;
const DOCS = ["0e200000-0000-4000-8000-00000000000a", "0e200000-0000-4000-8000-00000000000b"];
const ANSWERED = Date.parse("2026-11-04T10:00:00Z");
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function store(overrides: Partial<Record<"world" | "job" | "events" | "admissions", unknown>> = {}) {
  mocks.request.mockImplementation(async (path: string) => {
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
  mocks.audit.mockResolvedValue({ ok: true });
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
  it("records one internal operations event from the records that own each instant", async () => {
    store();
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED)).toBe("recorded");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    const event = mocks.audit.mock.calls[0]![0];
    expect(event).toMatchObject({ workspaceKey: WS, action: "operations.e2e_timing", targetType: "world", targetId: WORLD, outcome: "succeeded" });
    expect(event.details).toEqual({
      schemaVersion: "tavonel.e2e_timing.v1", collectionId: WORLD, documents: 2,
      uploadConfirmedAt: "2026-11-04T09:31:00.000Z", readyAt: "2026-11-04T09:40:00.000Z",
      activatedAt: "2026-11-04T09:50:00.000Z", firstMcpAnswerAt: "2026-11-04T10:00:00.000Z",
      seconds: { uploadToReady: 540, readyToActivate: 600, activateToFirstAnswer: 600, total: 1740 },
    });
    // The event reads the first ready/review_required event, not whichever came last.
    expect(mocks.request.mock.calls.map(([path]) => String(path)).find((path) => path.includes("compile_job_events")))
      .toContain("state=in.%28review_required%2Cready%29");
  });

  it("records once per World per process, and the audit id makes it once across processes", async () => {
    store();
    await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED);
    expect(await recordFirstMcpAnswerTiming(WS, WORLD, ANSWERED + 1_000)).toBe("already_recorded");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
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
    expect(mocks.audit.mock.calls[0]![0].details).toMatchObject({ uploadConfirmedAt: null, seconds: { uploadToReady: null, total: null } });
  });

  it("retries after a failed audit write, and refuses malformed identifiers without a read", async () => {
    store();
    mocks.audit.mockResolvedValueOnce({ ok: false, code: "ENTERPRISE_STORE_UNAVAILABLE" });
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
