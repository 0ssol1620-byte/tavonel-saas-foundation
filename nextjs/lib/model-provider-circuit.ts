const PROVIDER = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const ADMISSION_ID = /^[A-Za-z0-9._~-]{8,128}$/;

export const MODEL_PROVIDER_CIRCUIT_SCHEMA = "tavonel.model_provider_circuit.v1" as const;

export type ModelProviderCircuitPhase = "closed" | "open" | "half_open";

export type ModelProviderCircuitState = {
  schemaVersion: typeof MODEL_PROVIDER_CIRCUIT_SCHEMA;
  provider: string;
  phase: ModelProviderCircuitPhase;
  revision: number;
  correlatedFailures: number;
  failureWindowStartedAt: string | null;
  openedAt: string | null;
  cooldownUntil: string | null;
  probeAdmissionId: string | null;
  probeExpiresAt: string | null;
  updatedAt: string;
};

export type ModelProviderCircuitSnapshot =
  | { ok: true; state: ModelProviderCircuitState }
  | { ok: false; code: "state_unavailable" | "state_missing" };

export type ModelProviderCircuitConfig = {
  correlatedFailureThreshold?: number;
  failureWindowMs?: number;
  cooldownMs?: number;
  probeLeaseMs?: number;
  admissionTtlMs?: number;
};

type ResolvedConfig = Required<ModelProviderCircuitConfig>;

export type ModelProviderCircuitOutcome =
  | { kind: "success" }
  | { kind: "failure"; scope: "provider_account"; code: string }
  | { kind: "failure"; scope: "provider_operational"; code: string }
  | { kind: "failure"; scope: "semantic_document"; code: string };

export type ModelProviderCircuitEvent = Readonly<{
  schemaVersion: typeof MODEL_PROVIDER_CIRCUIT_SCHEMA;
  eventId: string;
  provider: string;
  admissionId: string;
  kind: "admission" | "outcome";
  fromPhase: ModelProviderCircuitPhase;
  toPhase: ModelProviderCircuitPhase;
  reason: string;
  occurredAt: string;
}>;

export type ModelProviderAdmissionReceipt = Readonly<{
  schemaVersion: typeof MODEL_PROVIDER_CIRCUIT_SCHEMA;
  admissionId: string;
  provider: string;
  mode: "normal" | "probe";
  admittedAt: string;
  expiresAt: string;
  committedRevision: number;
  eventId: string;
}>;

type AdmissionDenied = {
  ok: false;
  dispatchAllowed: false;
  code:
    | "MODEL_PROVIDER_CIRCUIT_INPUT_INVALID"
    | "MODEL_PROVIDER_CIRCUIT_STATE_UNAVAILABLE"
    | "MODEL_PROVIDER_ACCOUNTING_UNAVAILABLE"
    | "MODEL_PROVIDER_CIRCUIT_STATE_INVALID"
    | "MODEL_PROVIDER_CIRCUIT_OPEN"
    | "MODEL_PROVIDER_CIRCUIT_PROBE_BUSY";
  retryAt?: string;
};

export type ModelProviderAdmissionProposal = {
  ok: true;
  dispatchAllowed: false;
  code: "MODEL_PROVIDER_CIRCUIT_COMMIT_REQUIRED";
  expectedRevision: number;
  nextState: ModelProviderCircuitState;
  event: ModelProviderCircuitEvent;
  receipt: ModelProviderAdmissionReceipt;
};

export type ModelProviderOutcomeProposal = {
  ok: true;
  expectedRevision: number;
  nextState: ModelProviderCircuitState;
  event: ModelProviderCircuitEvent;
};

const DEFAULTS: ResolvedConfig = {
  correlatedFailureThreshold: 3,
  failureWindowMs: 60_000,
  cooldownMs: 30_000,
  probeLeaseMs: 15_000,
  admissionTtlMs: 5 * 60_000,
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new RangeError(`value must be an integer from ${minimum} through ${maximum}`);
  }
  return resolved;
}

function resolveConfig(config: ModelProviderCircuitConfig): ResolvedConfig {
  return {
    correlatedFailureThreshold: boundedInteger(config.correlatedFailureThreshold,
      DEFAULTS.correlatedFailureThreshold, 1, 20),
    failureWindowMs: boundedInteger(config.failureWindowMs, DEFAULTS.failureWindowMs, 1_000, 10 * 60_000),
    cooldownMs: boundedInteger(config.cooldownMs, DEFAULTS.cooldownMs, 1_000, 15 * 60_000),
    probeLeaseMs: boundedInteger(config.probeLeaseMs, DEFAULTS.probeLeaseMs, 1_000, 60_000),
    admissionTtlMs: boundedInteger(config.admissionTtlMs, DEFAULTS.admissionTtlMs, 1_000, 15 * 60_000),
  };
}

function validInstant(value: string | null) {
  return value === null || Number.isFinite(Date.parse(value));
}

function validState(state: ModelProviderCircuitState, provider: string) {
  if (state.schemaVersion !== MODEL_PROVIDER_CIRCUIT_SCHEMA || state.provider !== provider
    || !PROVIDER.test(state.provider) || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isSafeInteger(state.correlatedFailures) || state.correlatedFailures < 0
    || !validInstant(state.failureWindowStartedAt) || !validInstant(state.openedAt)
    || !validInstant(state.cooldownUntil) || !validInstant(state.probeExpiresAt)
    || !Number.isFinite(Date.parse(state.updatedAt))) return false;
  if (state.phase === "closed") {
    return state.openedAt === null && state.cooldownUntil === null
      && state.probeAdmissionId === null && state.probeExpiresAt === null;
  }
  if (state.phase === "open") {
    return state.openedAt !== null && state.cooldownUntil !== null
      && state.probeAdmissionId === null && state.probeExpiresAt === null;
  }
  return state.phase === "half_open" && state.openedAt !== null && state.cooldownUntil !== null
    && typeof state.probeAdmissionId === "string" && ADMISSION_ID.test(state.probeAdmissionId)
    && state.probeExpiresAt !== null;
}

function validNow(now: Date) {
  const value = now.getTime();
  return Number.isFinite(value) ? value : null;
}

function nextRevision(state: ModelProviderCircuitState, now: string): ModelProviderCircuitState {
  return { ...state, revision: state.revision + 1, updatedAt: now };
}

function event(value: Omit<ModelProviderCircuitEvent, "schemaVersion">): ModelProviderCircuitEvent {
  return Object.freeze({ schemaVersion: MODEL_PROVIDER_CIRCUIT_SCHEMA, ...value });
}

export function createClosedModelProviderCircuit(provider: string, now = new Date()): ModelProviderCircuitState {
  const nowMs = validNow(now);
  if (!PROVIDER.test(provider) || nowMs === null) throw new RangeError("provider and now must be valid");
  return {
    schemaVersion: MODEL_PROVIDER_CIRCUIT_SCHEMA,
    provider,
    phase: "closed",
    revision: 0,
    correlatedFailures: 0,
    failureWindowStartedAt: null,
    openedAt: null,
    cooldownUntil: null,
    probeAdmissionId: null,
    probeExpiresAt: null,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Produces an admission transition but never authorizes dispatch by itself. The caller must commit
 * nextState and event atomically with compare-and-set on expectedRevision, then pass that durable
 * receipt to confirmModelProviderCircuitAdmission. Missing or unreadable state fails closed.
 */
export function proposeModelProviderCircuitAdmission(
  snapshot: ModelProviderCircuitSnapshot,
  input: { provider: string; admissionId: string; accountingReady?: boolean; now?: Date },
  config: ModelProviderCircuitConfig = {},
): ModelProviderAdmissionProposal | AdmissionDenied {
  const settings = resolveConfig(config);
  const nowMs = validNow(input.now ?? new Date());
  if (!PROVIDER.test(input.provider) || !ADMISSION_ID.test(input.admissionId) || nowMs === null) {
    return { ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_CIRCUIT_INPUT_INVALID" };
  }
  if (!snapshot.ok) {
    return { ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_CIRCUIT_STATE_UNAVAILABLE" };
  }
  // Accounting readiness is affirmative: omission, ledger read failure, or an invalid spend
  // receipt must never be interpreted as permission to reach a paid provider.
  if (input.accountingReady !== true) {
    return { ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_ACCOUNTING_UNAVAILABLE" };
  }
  if (!validState(snapshot.state, input.provider)) {
    return { ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_CIRCUIT_STATE_INVALID" };
  }
  const state = snapshot.state;
  const now = new Date(nowMs).toISOString();
  let mode: "normal" | "probe" = "normal";
  let reason = "closed_admission";
  let nextState: ModelProviderCircuitState;

  if (state.phase === "open") {
    const cooldownUntil = Date.parse(state.cooldownUntil as string);
    if (nowMs < cooldownUntil) {
      return { ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_CIRCUIT_OPEN",
        retryAt: state.cooldownUntil as string };
    }
    mode = "probe";
    reason = "cooldown_elapsed_probe";
    nextState = nextRevision({ ...state, phase: "half_open", probeAdmissionId: input.admissionId,
      probeExpiresAt: new Date(nowMs + settings.probeLeaseMs).toISOString() }, now);
  } else if (state.phase === "half_open") {
    const probeExpiresAt = Date.parse(state.probeExpiresAt as string);
    if (nowMs < probeExpiresAt) {
      return { ok: false, dispatchAllowed: false, code: "MODEL_PROVIDER_CIRCUIT_PROBE_BUSY",
        retryAt: state.probeExpiresAt as string };
    }
    mode = "probe";
    reason = "expired_probe_replaced";
    nextState = nextRevision({ ...state, probeAdmissionId: input.admissionId,
      probeExpiresAt: new Date(nowMs + settings.probeLeaseMs).toISOString() }, now);
  } else {
    nextState = nextRevision(state, now);
  }

  const eventId = `admission:${input.admissionId}`;
  const receipt = Object.freeze({
    schemaVersion: MODEL_PROVIDER_CIRCUIT_SCHEMA,
    admissionId: input.admissionId,
    provider: input.provider,
    mode,
    admittedAt: now,
    expiresAt: new Date(nowMs + (mode === "probe" ? settings.probeLeaseMs : settings.admissionTtlMs)).toISOString(),
    committedRevision: nextState.revision,
    eventId,
  });
  return {
    ok: true,
    dispatchAllowed: false,
    code: "MODEL_PROVIDER_CIRCUIT_COMMIT_REQUIRED",
    expectedRevision: state.revision,
    nextState,
    event: event({ eventId, provider: input.provider, admissionId: input.admissionId,
      kind: "admission", fromPhase: state.phase, toPhase: nextState.phase, reason, occurredAt: now }),
    receipt,
  };
}

/** Authorizes one dispatch only after the exact proposed revision and immutable event commit. */
export function confirmModelProviderCircuitAdmission(
  proposal: ModelProviderAdmissionProposal,
  commit: { ok: boolean; committedRevision?: number; eventId?: string },
) {
  if (!commit.ok || commit.committedRevision !== proposal.receipt.committedRevision
    || commit.eventId !== proposal.receipt.eventId) {
    return { ok: false as const, dispatchAllowed: false as const,
      code: "MODEL_PROVIDER_CIRCUIT_COMMIT_UNCONFIRMED" as const };
  }
  return { ok: true as const, dispatchAllowed: true as const, receipt: proposal.receipt };
}

function openState(state: ModelProviderCircuitState, nowMs: number, cooldownMs: number) {
  const now = new Date(nowMs).toISOString();
  return nextRevision({ ...state, phase: "open", openedAt: now,
    cooldownUntil: new Date(nowMs + cooldownMs).toISOString(), probeAdmissionId: null,
    probeExpiresAt: null }, now);
}

function closeState(state: ModelProviderCircuitState, now: string) {
  return nextRevision({ ...state, phase: "closed", correlatedFailures: 0,
    failureWindowStartedAt: null, openedAt: null, cooldownUntil: null,
    probeAdmissionId: null, probeExpiresAt: null }, now);
}

/**
 * Reduces one admitted result into a compare-and-set proposal. Semantic/document failures are
 * recorded without increasing provider health failures. A half-open semantic result is
 * inconclusive and returns to bounded cooldown rather than falsely closing the provider circuit.
 */
export function proposeModelProviderCircuitOutcome(
  snapshot: ModelProviderCircuitSnapshot,
  receipt: ModelProviderAdmissionReceipt,
  outcome: ModelProviderCircuitOutcome,
  options: { now?: Date; config?: ModelProviderCircuitConfig } = {},
): ModelProviderOutcomeProposal | { ok: false; code: string } {
  const settings = resolveConfig(options.config ?? {});
  const nowMs = validNow(options.now ?? new Date());
  if (nowMs === null || !PROVIDER.test(receipt.provider) || !ADMISSION_ID.test(receipt.admissionId)
    || receipt.schemaVersion !== MODEL_PROVIDER_CIRCUIT_SCHEMA
    || (receipt.mode !== "normal" && receipt.mode !== "probe")
    || !Number.isFinite(Date.parse(receipt.admittedAt)) || !Number.isFinite(Date.parse(receipt.expiresAt))
    || Date.parse(receipt.expiresAt) <= Date.parse(receipt.admittedAt)
    || !Number.isSafeInteger(receipt.committedRevision) || receipt.committedRevision < 1
    || receipt.eventId !== `admission:${receipt.admissionId}`
    || !/^[-A-Z0-9_]{3,80}$/i.test(outcome.kind === "failure" ? outcome.code : "SUCCESS")) {
    return { ok: false, code: "MODEL_PROVIDER_CIRCUIT_OUTCOME_INVALID" };
  }
  if (!snapshot.ok) return { ok: false, code: "MODEL_PROVIDER_CIRCUIT_STATE_UNAVAILABLE" };
  if (!validState(snapshot.state, receipt.provider)) {
    return { ok: false, code: "MODEL_PROVIDER_CIRCUIT_STATE_INVALID" };
  }
  if (nowMs > Date.parse(receipt.expiresAt)) {
    return { ok: false, code: "MODEL_PROVIDER_CIRCUIT_ADMISSION_EXPIRED" };
  }
  const state = snapshot.state;
  if (receipt.mode === "probe"
    && (state.phase !== "half_open" || state.probeAdmissionId !== receipt.admissionId)) {
    return { ok: false, code: "MODEL_PROVIDER_CIRCUIT_STALE_PROBE" };
  }
  const now = new Date(nowMs).toISOString();
  let reason = outcome.kind === "success" ? "provider_success" : outcome.scope;
  let nextState: ModelProviderCircuitState;

  if (receipt.mode === "probe") {
    if (outcome.kind === "success") nextState = closeState(state, now);
    else {
      nextState = openState(state, nowMs, settings.cooldownMs);
      reason = outcome.scope === "semantic_document" ? "probe_inconclusive" : outcome.scope;
    }
  } else if (state.phase !== "closed") {
    // A result from work admitted before the breaker opened cannot close or extend it.
    nextState = nextRevision(state, now);
    reason = "late_normal_outcome";
  } else if (outcome.kind === "success") {
    nextState = closeState(state, now);
  } else if (outcome.scope === "semantic_document") {
    nextState = nextRevision(state, now);
  } else if (outcome.scope === "provider_account") {
    nextState = openState({ ...state, correlatedFailures: settings.correlatedFailureThreshold,
      failureWindowStartedAt: state.failureWindowStartedAt ?? now }, nowMs, settings.cooldownMs);
  } else {
    const previousStart = state.failureWindowStartedAt === null ? NaN : Date.parse(state.failureWindowStartedAt);
    const insideWindow = Number.isFinite(previousStart) && nowMs - previousStart <= settings.failureWindowMs;
    const correlatedFailures = insideWindow ? state.correlatedFailures + 1 : 1;
    const failureWindowStartedAt = insideWindow ? state.failureWindowStartedAt : now;
    const counted = { ...state, correlatedFailures, failureWindowStartedAt };
    nextState = correlatedFailures >= settings.correlatedFailureThreshold
      ? openState(counted, nowMs, settings.cooldownMs)
      : nextRevision(counted, now);
  }

  return {
    ok: true,
    expectedRevision: state.revision,
    nextState,
    event: event({ eventId: `outcome:${receipt.admissionId}`, provider: receipt.provider,
      admissionId: receipt.admissionId, kind: "outcome", fromPhase: state.phase,
      toPhase: nextState.phase, reason, occurredAt: now }),
  };
}
