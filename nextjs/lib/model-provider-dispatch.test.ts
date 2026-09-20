import { describe, expect, it, vi } from "vitest";
import { createClosedModelProviderCircuit } from "./model-provider-circuit";
import { runGovernedModelProviderCall } from "./model-provider-dispatch";

const reservationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const input = {
  tenantId: "pilot-tenant-a",
  requestKey: "retrieval-request-0001",
  requestDigest: `sha256:${"a".repeat(64)}`,
  provider: "runpod",
  model: "BAAI/bge-m3",
  meter: "gpu_second",
  reservedUnits: 35,
  reservationSeconds: 60,
  admissionId: "retrieval-admission-0001",
};

function dependencies() {
  const initial = createClosedModelProviderCircuit("runpod", new Date("2026-09-20T00:00:00Z"));
  const afterAdmission = { ...initial, revision: 1, updatedAt: "2026-09-20T00:00:01.000Z" };
  return {
    readCircuit: vi.fn()
      .mockResolvedValueOnce({ ok: true, state: initial })
      .mockResolvedValue({ ok: true, state: afterAdmission }),
    reserve: vi.fn().mockResolvedValue({ ok: true, dispatchAllowed: true,
      receipt: { reservationId } }),
    settle: vi.fn().mockResolvedValue({ ok: true, receipt: { status: "processed" } }),
    markIndeterminate: vi.fn().mockResolvedValue({ ok: true,
      receipt: { status: "pending_reconciliation" } }),
    commitAdmission: vi.fn().mockImplementation(async (proposal) => ({ ok: true,
      committedRevision: proposal.nextState.revision, eventId: proposal.event.eventId })),
    commitOutcome: vi.fn().mockImplementation(async (proposal) => ({ ok: true,
      committedRevision: proposal.nextState.revision, eventId: proposal.event.eventId })),
  };
}

describe("governed paid-provider dispatch", () => {
  it("does not reserve or call when provider-wide circuit state is unavailable", async () => {
    const deps = dependencies();
    deps.readCircuit.mockReset().mockResolvedValue({ ok: false, code: "state_unavailable" });
    const call = vi.fn();
    await expect(runGovernedModelProviderCall(input, call, deps as never)).resolves.toEqual({
      ok: false, code: "MODEL_PROVIDER_CIRCUIT_STATE_UNAVAILABLE", providerDispatched: false,
    });
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("does not commit a circuit admission or call when spend admission fails", async () => {
    const deps = dependencies();
    deps.reserve.mockResolvedValueOnce({ ok: false, code: "MODEL_PROVIDER_GLOBAL_SPEND_BREAKER_OPEN" });
    const call = vi.fn();
    await expect(runGovernedModelProviderCall(input, call, deps as never)).resolves.toMatchObject({
      ok: false, code: "MODEL_PROVIDER_GLOBAL_SPEND_BREAKER_OPEN", providerDispatched: false,
    });
    expect(deps.commitAdmission).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("releases a proven-unused hold when the circuit opens before dispatch", async () => {
    const deps = dependencies();
    const open = { ...createClosedModelProviderCircuit("runpod", new Date()), phase: "open" as const,
      correlatedFailures: 3, failureWindowStartedAt: new Date().toISOString(),
      openedAt: new Date().toISOString(), cooldownUntil: new Date(Date.now() + 60_000).toISOString() };
    deps.readCircuit.mockReset().mockResolvedValue({ ok: true, state: open });
    const call = vi.fn();
    const result = await runGovernedModelProviderCall(input, call, deps as never);
    expect(result).toMatchObject({ ok: false, code: "MODEL_PROVIDER_CIRCUIT_OPEN",
      providerDispatched: false, reservationId });
    expect(deps.settle).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "released", actualUnits: 0, reasonCode: "CIRCUIT_ADMISSION_DENIED",
    }));
    expect(call).not.toHaveBeenCalled();
  });

  it("commits circuit admission, measured spend, and circuit outcome around one call", async () => {
    const deps = dependencies();
    const response = new Response("ok");
    const result = await runGovernedModelProviderCall(input, async () => ({
      value: response, actualUnits: 4, reasonCode: "PROVIDER_HTTP_COMPLETED",
      circuitOutcome: { kind: "success" as const },
    }), deps as never);
    expect(result).toMatchObject({ ok: true, value: response, reservationId, actualUnits: 4 });
    expect(deps.commitAdmission).toHaveBeenCalledTimes(1);
    expect(deps.settle).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "settled", actualUnits: 4,
    }));
    expect(deps.commitOutcome).toHaveBeenCalledTimes(1);
    expect(deps.markIndeterminate).not.toHaveBeenCalled();
  });

  it("preserves the full hold when the provider outcome is ambiguous", async () => {
    const deps = dependencies();
    const result = await runGovernedModelProviderCall(input, async () => {
      throw new Error("connection reset after dispatch");
    }, deps as never);
    expect(result).toMatchObject({ ok: false, code: "MODEL_PROVIDER_CALL_INDETERMINATE",
      providerDispatched: true, reservationId });
    expect(deps.markIndeterminate).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "PROVIDER_CALL_FAILED",
    }));
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.commitOutcome).toHaveBeenCalledTimes(1);
  });

  it("never releases after an unconfirmed settlement", async () => {
    const deps = dependencies();
    deps.settle.mockResolvedValueOnce({ ok: false, code: "MODEL_PROVIDER_LEDGER_FAILED" });
    const result = await runGovernedModelProviderCall(input, async () => ({
      value: "withheld", actualUnits: 2, reasonCode: "PROVIDER_HTTP_COMPLETED",
      circuitOutcome: { kind: "success" as const },
    }), deps as never);
    expect(result).toMatchObject({ ok: false, code: "MODEL_PROVIDER_SETTLEMENT_UNCONFIRMED",
      providerDispatched: true });
    expect(deps.markIndeterminate).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "SETTLEMENT_UNCONFIRMED",
    }));
    expect(deps.settle).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "released" }));
  });
});
