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
      receipt: { reservationId, unitMicrousd: 250, priceVersion: "runpod-2026-09" } }),
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

  it("persists the decision with real admission IDs before provider dispatch, then one terminal outcome", async () => {
    const deps = dependencies();
    const order: string[] = [];
    const lifecycle = {
      admit: vi.fn(async (admission) => {
        order.push("decision");
        expect(admission).toMatchObject({ reservationId, admissionId: input.admissionId,
          unitMicrousd: 250, priceVersion: "runpod-2026-09" });
        return { ok: true as const, attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
      }),
      recordTerminal: vi.fn(async (terminal) => {
        order.push("outcome");
        expect(terminal).toMatchObject({ reservationId, admissionId: input.admissionId,
          attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actualUnits: 4,
          actualMicrousd: 1000, dispatchFailureCode: null });
        return true;
      }),
    };
    const result = await runGovernedModelProviderCall(input, async () => {
      order.push("provider");
      return { value: "accepted", actualUnits: 4, reasonCode: "PROVIDER_RESULT_ACCEPTED",
        circuitOutcome: { kind: "success" as const } };
    }, deps as never, lifecycle);
    expect(result).toMatchObject({ ok: true, value: "accepted" });
    expect(order).toEqual(["decision", "provider", "outcome"]);
    expect(lifecycle.admit).toHaveBeenCalledTimes(1);
    expect(lifecycle.recordTerminal).toHaveBeenCalledTimes(1);
  });

  it("fails closed and releases the unused hold when the decision receipt cannot commit", async () => {
    const deps = dependencies();
    const call = vi.fn();
    const lifecycle = {
      admit: vi.fn().mockResolvedValue({ ok: false as const }),
      recordTerminal: vi.fn(),
    };
    await expect(runGovernedModelProviderCall(input, call, deps as never, lifecycle)).resolves.toMatchObject({
      ok: false, code: "MODEL_ATTEMPT_DECISION_UNAVAILABLE", providerDispatched: false,
      reservationId, admissionId: input.admissionId,
    });
    expect(call).not.toHaveBeenCalled();
    expect(deps.settle).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "released", actualUnits: 0, reasonCode: "MODEL_ATTEMPT_DECISION_UNAVAILABLE",
    }));
    expect(lifecycle.recordTerminal).not.toHaveBeenCalled();
  });

  it("records one failed terminal outcome after an ambiguous provider failure", async () => {
    const deps = dependencies();
    const lifecycle = {
      admit: vi.fn().mockResolvedValue({ ok: true as const,
        attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      recordTerminal: vi.fn().mockResolvedValue(true),
    };
    const result = await runGovernedModelProviderCall(input, async () => {
      throw new Error("timeout after dispatch");
    }, deps as never, lifecycle);
    expect(result).toMatchObject({ ok: false, code: "MODEL_PROVIDER_CALL_INDETERMINATE" });
    expect(lifecycle.recordTerminal).toHaveBeenCalledTimes(1);
    expect(lifecycle.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      value: null, actualUnits: input.reservedUnits,
      dispatchFailureCode: "PROVIDER_CALL_FAILED",
    }));
  });
});
