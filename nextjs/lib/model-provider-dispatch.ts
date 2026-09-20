import { createHash, randomUUID } from "node:crypto";
import {
  confirmModelProviderCircuitAdmission,
  proposeModelProviderCircuitAdmission,
  proposeModelProviderCircuitOutcome,
  type ModelProviderCircuitOutcome,
} from "./model-provider-circuit";
import {
  commitModelProviderCircuitAdmission,
  commitModelProviderCircuitOutcome,
  readModelProviderCircuitSnapshot,
} from "./model-provider-circuit-store";
import {
  markModelProviderSpendIndeterminate,
  reserveModelProviderSpend,
  settleModelProviderSpend,
} from "./model-provider-spend";

const REASON = /^[A-Z0-9_]{3,80}$/;

type DispatchDependencies = {
  readCircuit: typeof readModelProviderCircuitSnapshot;
  commitAdmission: typeof commitModelProviderCircuitAdmission;
  commitOutcome: typeof commitModelProviderCircuitOutcome;
  reserve: typeof reserveModelProviderSpend;
  settle: typeof settleModelProviderSpend;
  markIndeterminate: typeof markModelProviderSpendIndeterminate;
};

const defaults: DispatchDependencies = {
  readCircuit: readModelProviderCircuitSnapshot,
  commitAdmission: commitModelProviderCircuitAdmission,
  commitOutcome: commitModelProviderCircuitOutcome,
  reserve: reserveModelProviderSpend,
  settle: settleModelProviderSpend,
  markIndeterminate: markModelProviderSpendIndeterminate,
};

export type GovernedModelProviderResult<T> =
  | {
      ok: true;
      value: T;
      reservationId: string;
      admissionId: string;
      actualUnits: number;
    }
  | {
      ok: false;
      code: string;
      providerDispatched: boolean;
      reservationId?: string;
      admissionId?: string;
    };

async function releaseUnusedReservation(
  deps: DispatchDependencies,
  tenantId: string,
  reservationId: string,
  reasonCode: string,
) {
  const released = await deps.settle({ tenantId, reservationId, outcome: "released",
    actualUnits: 0, reasonCode });
  return released.ok;
}

async function commitOutcome(
  deps: DispatchDependencies,
  provider: string,
  receipt: Parameters<typeof proposeModelProviderCircuitOutcome>[1],
  outcome: ModelProviderCircuitOutcome,
) {
  const snapshot = await deps.readCircuit(provider);
  const proposal = proposeModelProviderCircuitOutcome(snapshot, receipt, outcome);
  if (!proposal.ok) return false;
  return (await deps.commitOutcome(proposal)).ok;
}

/**
 * The sole paid-provider execution boundary. It authorizes spend first, atomically commits a
 * provider-wide circuit admission, performs one callback, then commits measured settlement and
 * the circuit outcome. Any post-dispatch ambiguity keeps the full spend hold for reconciliation.
 */
export async function runGovernedModelProviderCall<T>(
  input: {
    tenantId: string;
    requestKey: string;
    requestDigest: string;
    provider: string;
    model: string;
    meter: string;
    reservedUnits: number;
    reservationSeconds?: number;
    admissionId: string;
  },
  call: () => Promise<{
    value: T;
    actualUnits: number;
    reasonCode: string;
    circuitOutcome: ModelProviderCircuitOutcome;
  }>,
  deps: DispatchDependencies = defaults,
): Promise<GovernedModelProviderResult<T>> {
  // A readable enabled circuit is required before taking a budget hold. This avoids filling the
  // ledger with reservations that can never reach a provider when circuit state is unavailable.
  const initialCircuit = await deps.readCircuit(input.provider);
  if (!initialCircuit.ok) {
    return { ok: false, code: "MODEL_PROVIDER_CIRCUIT_STATE_UNAVAILABLE", providerDispatched: false };
  }

  const held = await deps.reserve(input);
  if (!held.ok) return { ...held, providerDispatched: false };
  const reservationId = String(held.receipt.reservationId);
  if (!held.dispatchAllowed) {
    return { ok: false, code: "MODEL_PROVIDER_QUEUED", providerDispatched: false,
      reservationId };
  }

  const proposal = proposeModelProviderCircuitAdmission(initialCircuit, {
    provider: input.provider,
    admissionId: input.admissionId,
    accountingReady: true,
  });
  if (!proposal.ok) {
    const released = await releaseUnusedReservation(deps, input.tenantId, reservationId,
      "CIRCUIT_ADMISSION_DENIED");
    return { ok: false, code: released ? proposal.code : "MODEL_PROVIDER_RELEASE_FAILED",
      providerDispatched: false, reservationId };
  }
  const committed = await deps.commitAdmission(proposal);
  const admission = confirmModelProviderCircuitAdmission(proposal, committed);
  if (!admission.ok) {
    const released = await releaseUnusedReservation(deps, input.tenantId, reservationId,
      "CIRCUIT_COMMIT_UNCONFIRMED");
    return { ok: false, code: released ? admission.code : "MODEL_PROVIDER_RELEASE_FAILED",
      providerDispatched: false, reservationId, admissionId: input.admissionId };
  }

  try {
    const result = await call();
    if (!Number.isSafeInteger(result.actualUnits) || result.actualUnits < 0
      || result.actualUnits > input.reservedUnits || !REASON.test(result.reasonCode)) {
      const pending = await deps.markIndeterminate({ tenantId: input.tenantId, reservationId,
        reasonCode: "PROVIDER_RESULT_INVALID" });
      await commitOutcome(deps, input.provider, admission.receipt, {
        kind: "failure", scope: "provider_operational", code: "PROVIDER_RESULT_INVALID",
      });
      return { ok: false, code: pending.ok ? "MODEL_PROVIDER_RESULT_INDETERMINATE"
        : "MODEL_PROVIDER_RECONCILIATION_MARK_FAILED", providerDispatched: true,
      reservationId, admissionId: input.admissionId };
    }
    const settled = await deps.settle({ tenantId: input.tenantId, reservationId,
      outcome: "settled", actualUnits: result.actualUnits, reasonCode: result.reasonCode });
    if (!settled.ok) {
      // The settlement RPC may have committed before its response was lost. Never release the
      // hold. A best-effort pending mark either preserves the reservation or safely conflicts
      // with the already-terminal settlement.
      await deps.markIndeterminate({ tenantId: input.tenantId, reservationId,
        reasonCode: "SETTLEMENT_UNCONFIRMED" });
      await commitOutcome(deps, input.provider, admission.receipt, result.circuitOutcome);
      return { ok: false, code: "MODEL_PROVIDER_SETTLEMENT_UNCONFIRMED",
        providerDispatched: true, reservationId, admissionId: input.admissionId };
    }
    if (!await commitOutcome(deps, input.provider, admission.receipt, result.circuitOutcome)) {
      return { ok: false, code: "MODEL_PROVIDER_CIRCUIT_OUTCOME_UNCONFIRMED",
        providerDispatched: true, reservationId, admissionId: input.admissionId };
    }
    return { ok: true, value: result.value, reservationId, admissionId: input.admissionId,
      actualUnits: result.actualUnits };
  } catch {
    const pending = await deps.markIndeterminate({ tenantId: input.tenantId, reservationId,
      reasonCode: "PROVIDER_CALL_FAILED" });
    await commitOutcome(deps, input.provider, admission.receipt, {
      kind: "failure", scope: "provider_operational", code: "PROVIDER_CALL_FAILED",
    });
    return { ok: false, code: pending.ok ? "MODEL_PROVIDER_CALL_INDETERMINATE"
      : "MODEL_PROVIDER_RECONCILIATION_MARK_FAILED", providerDispatched: true,
    reservationId, admissionId: input.admissionId };
  }
}

export class ModelProviderDispatchError extends Error {
  constructor(
    readonly code: string,
    readonly providerDispatched: boolean,
    readonly reservationId?: string,
  ) {
    super(code);
    this.name = "ModelProviderDispatchError";
  }
}

function responseOutcome(response: Response): ModelProviderCircuitOutcome {
  if (response.ok) return { kind: "success" };
  if (response.status === 401 || response.status === 403) {
    return { kind: "failure", scope: "provider_account", code: "PROVIDER_ACCOUNT_REJECTED" };
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return { kind: "failure", scope: "provider_operational", code: "PROVIDER_HTTP_UNAVAILABLE" };
  }
  return { kind: "failure", scope: "semantic_document", code: "PROVIDER_REQUEST_REJECTED" };
}

/** Creates a fetch-compatible function whose every network call passes through the durable gate. */
export function createGovernedModelProviderFetcher(input: {
  tenantId: string;
  provider: string;
  model: string;
  meter?: string;
  maximumUnits: number;
  reservationSeconds?: number;
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  return async (resource: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    const requestDigest = `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
    const id = randomUUID();
    const requestKey = `retrieval-${id}`;
    const admissionId = `retrieval-${id}`;
    const startedAt = Date.now();
    const result = await runGovernedModelProviderCall({
      tenantId: input.tenantId,
      requestKey,
      requestDigest,
      provider: input.provider,
      model: input.model,
      meter: input.meter ?? "gpu_second",
      reservedUnits: input.maximumUnits,
      reservationSeconds: input.reservationSeconds,
      admissionId,
    }, async () => {
      const response = await fetcher(resource, init);
      return {
        value: response,
        actualUnits: Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)),
        reasonCode: "PROVIDER_HTTP_COMPLETED",
        circuitOutcome: responseOutcome(response),
      };
    });
    if (!result.ok) {
      throw new ModelProviderDispatchError(result.code, result.providerDispatched, result.reservationId);
    }
    return result.value;
  };
}
