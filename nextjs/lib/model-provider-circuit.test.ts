import { describe, expect, it } from "vitest";
import {
  confirmModelProviderCircuitAdmission,
  createClosedModelProviderCircuit,
  proposeModelProviderCircuitAdmission,
  proposeModelProviderCircuitOutcome,
  type ModelProviderAdmissionProposal,
  type ModelProviderAdmissionReceipt,
  type ModelProviderCircuitState,
} from "./model-provider-circuit";

const provider = "runpod";
const t0 = new Date("2026-09-20T00:00:00.000Z");

function stateSnapshot(state: ModelProviderCircuitState) {
  return { ok: true as const, state };
}

function admission(state: ModelProviderCircuitState, id: string, now: Date) {
  const proposal = proposeModelProviderCircuitAdmission(stateSnapshot(state), {
    provider, admissionId: id, accountingReady: true, now,
  });
  expect(proposal.ok).toBe(true);
  return proposal as ModelProviderAdmissionProposal;
}

function committedReceipt(proposal: ModelProviderAdmissionProposal) {
  const confirmed = confirmModelProviderCircuitAdmission(proposal, {
    ok: true, committedRevision: proposal.nextState.revision, eventId: proposal.event.eventId,
  });
  expect(confirmed.ok).toBe(true);
  return confirmed.ok ? confirmed.receipt : (null as never);
}

function outcome(state: ModelProviderCircuitState, receipt: ModelProviderAdmissionReceipt,
  value: Parameters<typeof proposeModelProviderCircuitOutcome>[2], now: Date) {
  const proposal = proposeModelProviderCircuitOutcome(stateSnapshot(state), receipt, value, { now });
  expect(proposal.ok).toBe(true);
  return proposal as Exclude<typeof proposal, { ok: false }>;
}

describe("model-provider circuit admission", () => {
  it("fails closed when state is missing or unavailable", () => {
    for (const code of ["state_missing", "state_unavailable"] as const) {
      expect(proposeModelProviderCircuitAdmission({ ok: false, code }, {
        provider, admissionId: "admission-0001", accountingReady: true, now: t0,
      })).toEqual({
        ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_CIRCUIT_STATE_UNAVAILABLE",
      });
    }
  });

  it("defaults closed-to-dispatch when spend accounting is not affirmatively ready", () => {
    const state = stateSnapshot(createClosedModelProviderCircuit(provider, t0));
    expect(proposeModelProviderCircuitAdmission(state, {
      provider, admissionId: "accounting-missing", now: t0,
    })).toEqual({
      ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_ACCOUNTING_UNAVAILABLE",
    });
    expect(proposeModelProviderCircuitAdmission(state, {
      provider, admissionId: "accounting-failed", accountingReady: false, now: t0,
    })).toEqual({
      ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_ACCOUNTING_UNAVAILABLE",
    });
  });

  it("does not authorize dispatch until the exact state and event commit is confirmed", () => {
    const proposal = admission(createClosedModelProviderCircuit(provider, t0), "admission-0001", t0);
    expect(proposal).toMatchObject({
      dispatchAllowed: false, code: "MODEL_PROVIDER_CIRCUIT_COMMIT_REQUIRED", expectedRevision: 0,
      nextState: { revision: 1, phase: "closed" },
      event: { eventId: "admission:admission-0001", kind: "admission" },
    });
    expect(confirmModelProviderCircuitAdmission(proposal, {
      ok: true, committedRevision: 2, eventId: proposal.event.eventId,
    })).toMatchObject({ ok: false, dispatchAllowed: false });
    expect(confirmModelProviderCircuitAdmission(proposal, {
      ok: true, committedRevision: 1, eventId: "wrong-event",
    })).toMatchObject({ ok: false, dispatchAllowed: false });
    expect(confirmModelProviderCircuitAdmission(proposal, {
      ok: true, committedRevision: 1, eventId: proposal.event.eventId,
    })).toMatchObject({ ok: true, dispatchAllowed: true });
    expect(Object.isFrozen(proposal.event)).toBe(true);
    expect(Object.isFrozen(proposal.receipt)).toBe(true);
  });
});

describe("model-provider circuit transitions", () => {
  it("does not count semantic or document failures against provider health", () => {
    const first = admission(createClosedModelProviderCircuit(provider, t0), "semantic-0001", t0);
    const result = outcome(first.nextState, committedReceipt(first), {
      kind: "failure", scope: "semantic_document", code: "DOCUMENT_CONTEXT_TOO_LARGE",
    }, new Date(t0.getTime() + 100));
    expect(result.nextState).toMatchObject({ phase: "closed", correlatedFailures: 0 });
    expect(result.event.reason).toBe("semantic_document");
  });

  it("opens immediately for a provider-account failure", () => {
    const first = admission(createClosedModelProviderCircuit(provider, t0), "account-0001", t0);
    const result = outcome(first.nextState, committedReceipt(first), {
      kind: "failure", scope: "provider_account", code: "PROVIDER_CREDENTIAL_REJECTED",
    }, new Date(t0.getTime() + 100));
    expect(result.nextState).toMatchObject({ phase: "open", correlatedFailures: 3,
      cooldownUntil: "2026-09-20T00:00:30.100Z" });
  });

  it("opens after bounded correlated operational failures and resets an expired window", () => {
    let state = createClosedModelProviderCircuit(provider, t0);
    for (let index = 1; index <= 3; index += 1) {
      const now = new Date(t0.getTime() + index * 1_000);
      const admitted = admission(state, `operational-000${index}`, now);
      const result = outcome(admitted.nextState, committedReceipt(admitted), {
        kind: "failure", scope: "provider_operational", code: "UPSTREAM_TIMEOUT",
      }, new Date(now.getTime() + 1));
      state = result.nextState;
    }
    expect(state).toMatchObject({ phase: "open", correlatedFailures: 3 });

    const old = { ...createClosedModelProviderCircuit(provider, t0), correlatedFailures: 2,
      failureWindowStartedAt: t0.toISOString() };
    const later = new Date(t0.getTime() + 61_000);
    const admitted = admission(old, "window-reset-0001", later);
    const result = outcome(admitted.nextState, committedReceipt(admitted), {
      kind: "failure", scope: "provider_operational", code: "UPSTREAM_TIMEOUT",
    }, new Date(later.getTime() + 1));
    expect(result.nextState).toMatchObject({ phase: "closed", correlatedFailures: 1 });
  });

  it("admits one bounded half-open probe after cooldown and refuses concurrent probes", () => {
    const open = {
      ...createClosedModelProviderCircuit(provider, t0),
      phase: "open" as const,
      revision: 4,
      correlatedFailures: 3,
      failureWindowStartedAt: t0.toISOString(),
      openedAt: t0.toISOString(),
      cooldownUntil: new Date(t0.getTime() + 30_000).toISOString(),
    };
    expect(proposeModelProviderCircuitAdmission(stateSnapshot(open), {
      provider, admissionId: "probe-too-early", accountingReady: true,
      now: new Date(t0.getTime() + 29_999),
    })).toMatchObject({ ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_CIRCUIT_OPEN" });

    const probe = admission(open, "probe-admission-1", new Date(t0.getTime() + 30_000));
    expect(probe).toMatchObject({ nextState: { phase: "half_open",
      probeAdmissionId: "probe-admission-1", probeExpiresAt: "2026-09-20T00:00:45.000Z" },
      receipt: { mode: "probe" } });
    expect(proposeModelProviderCircuitAdmission(stateSnapshot(probe.nextState), {
      provider, admissionId: "probe-admission-2", accountingReady: true,
      now: new Date(t0.getTime() + 31_000),
    })).toMatchObject({ ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_CIRCUIT_PROBE_BUSY" });
  });

  it("closes only on the active half-open probe's operational success", () => {
    const open = {
      ...createClosedModelProviderCircuit(provider, t0), phase: "open" as const, revision: 3,
      correlatedFailures: 3, failureWindowStartedAt: t0.toISOString(), openedAt: t0.toISOString(),
      cooldownUntil: t0.toISOString(),
    };
    const probe = admission(open, "probe-success-1", t0);
    const receipt = committedReceipt(probe);
    const result = outcome(probe.nextState, receipt, { kind: "success" }, new Date(t0.getTime() + 1));
    expect(result.nextState).toMatchObject({ phase: "closed", correlatedFailures: 0,
      probeAdmissionId: null, cooldownUntil: null });

    expect(proposeModelProviderCircuitOutcome(stateSnapshot(probe.nextState), {
      ...receipt, admissionId: "stale-probe-1", eventId: "admission:stale-probe-1",
    }, { kind: "success" }, { now: new Date(t0.getTime() + 1) }))
      .toEqual({ ok: false, code: "MODEL_PROVIDER_CIRCUIT_STALE_PROBE" });
  });

  it("treats a semantic half-open result as inconclusive and starts another bounded cooldown", () => {
    const open = {
      ...createClosedModelProviderCircuit(provider, t0), phase: "open" as const, revision: 3,
      correlatedFailures: 3, failureWindowStartedAt: t0.toISOString(), openedAt: t0.toISOString(),
      cooldownUntil: t0.toISOString(),
    };
    const probe = admission(open, "probe-semantic-1", t0);
    const result = outcome(probe.nextState, committedReceipt(probe), {
      kind: "failure", scope: "semantic_document", code: "DOCUMENT_UNSUPPORTED",
    }, new Date(t0.getTime() + 500));
    expect(result.nextState).toMatchObject({ phase: "open", probeAdmissionId: null,
      cooldownUntil: "2026-09-20T00:00:30.500Z" });
    expect(result.event.reason).toBe("probe_inconclusive");
  });

  it("rejects stale outcomes after the admission lease expires", () => {
    const first = admission(createClosedModelProviderCircuit(provider, t0), "expired-outcome-1", t0);
    expect(proposeModelProviderCircuitOutcome(stateSnapshot(first.nextState), committedReceipt(first),
      { kind: "success" }, { now: new Date(t0.getTime() + 300_001) }))
      .toEqual({ ok: false, code: "MODEL_PROVIDER_CIRCUIT_ADMISSION_EXPIRED" });
  });
});
