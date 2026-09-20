import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import {
  MODEL_PROVIDER_CIRCUIT_SCHEMA,
  type ModelProviderAdmissionProposal,
  type ModelProviderCircuitSnapshot,
  type ModelProviderCircuitState,
  type ModelProviderOutcomeProposal,
} from "./model-provider-circuit";

const PROVIDER = /^[a-z0-9][a-z0-9._-]{1,63}$/;

type StoreEnv = Readonly<Record<string, string | undefined>>;
type CommitResult =
  | { ok: true; committedRevision: number; eventId: string }
  | { ok: false; code: "MODEL_PROVIDER_CIRCUIT_STORE_NOT_CONFIGURED" | "MODEL_PROVIDER_CIRCUIT_STORE_FAILED" };

function validInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validState(value: unknown, provider: string): value is ModelProviderCircuitState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<ModelProviderCircuitState>;
  if (state.schemaVersion !== MODEL_PROVIDER_CIRCUIT_SCHEMA || state.provider !== provider
    || !["closed", "open", "half_open"].includes(state.phase ?? "")
    || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0
    || !Number.isSafeInteger(state.correlatedFailures) || Number(state.correlatedFailures) < 0
    || !validInstant(state.updatedAt)) return false;
  const optionalTimes = [state.failureWindowStartedAt, state.openedAt, state.cooldownUntil, state.probeExpiresAt];
  if (optionalTimes.some((item) => item !== null && !validInstant(item))) return false;
  if (state.phase === "closed") return state.openedAt === null && state.cooldownUntil === null
    && state.probeAdmissionId === null && state.probeExpiresAt === null;
  if (state.phase === "open") return state.openedAt !== null && state.cooldownUntil !== null
    && state.probeAdmissionId === null && state.probeExpiresAt === null;
  return state.openedAt !== null && state.cooldownUntil !== null
    && typeof state.probeAdmissionId === "string" && state.probeAdmissionId.length >= 8
    && state.probeExpiresAt !== null;
}

async function adminResponse(path: string, body: Record<string, unknown>, env: StoreEnv) {
  const config = readSupabaseAdminConfig(env);
  if (!config) return null;
  try {
    return await supabaseAdminRequest(config, path, { method: "POST", body: JSON.stringify(body) });
  } catch {
    return undefined;
  }
}

/** Read an enabled provider circuit. Missing, disabled, malformed, or unreachable state is unavailable. */
export async function readModelProviderCircuitSnapshot(
  provider: string,
  env: StoreEnv = process.env,
): Promise<ModelProviderCircuitSnapshot> {
  if (!PROVIDER.test(provider)) return { ok: false, code: "state_unavailable" };
  const response = await adminResponse("/rest/v1/rpc/read_model_provider_circuit_v1", {
    p_provider: provider,
  }, env);
  if (!response?.ok) {
    await response?.body?.cancel().catch(() => undefined);
    return { ok: false, code: response === null ? "state_missing" : "state_unavailable" };
  }
  const body = await response.json().catch(() => null) as { state?: unknown } | null;
  return validState(body?.state, provider)
    ? { ok: true, state: body.state }
    : { ok: false, code: "state_unavailable" };
}

function validCommit(value: unknown, proposal: ModelProviderAdmissionProposal | ModelProviderOutcomeProposal) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as { status?: unknown; committedRevision?: unknown; eventId?: unknown };
  if ((receipt.status !== "committed" && receipt.status !== "replayed")
    || receipt.committedRevision !== proposal.nextState.revision
    || receipt.eventId !== proposal.event.eventId) return null;
  return { ok: true as const, committedRevision: receipt.committedRevision as number,
    eventId: receipt.eventId as string };
}

async function commit(
  path: string,
  proposal: ModelProviderAdmissionProposal | ModelProviderOutcomeProposal,
  receipt: ModelProviderAdmissionProposal["receipt"] | null,
  env: StoreEnv,
): Promise<CommitResult> {
  const response = await adminResponse(path, {
    p_provider: proposal.nextState.provider,
    p_expected_revision: proposal.expectedRevision,
    p_next_state: proposal.nextState,
    p_event: proposal.event,
    ...(receipt ? { p_receipt: receipt } : {}),
  }, env);
  if (!response) return { ok: false, code: response === null
    ? "MODEL_PROVIDER_CIRCUIT_STORE_NOT_CONFIGURED" : "MODEL_PROVIDER_CIRCUIT_STORE_FAILED" };
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "MODEL_PROVIDER_CIRCUIT_STORE_FAILED" };
  }
  return validCommit(await response.json().catch(() => null), proposal)
    ?? { ok: false, code: "MODEL_PROVIDER_CIRCUIT_STORE_FAILED" };
}

/** Atomically compare-and-set circuit state and append its immutable admission event and receipt. */
export function commitModelProviderCircuitAdmission(
  proposal: ModelProviderAdmissionProposal,
  env: StoreEnv = process.env,
) {
  return commit("/rest/v1/rpc/commit_model_provider_circuit_admission_v1", proposal, proposal.receipt, env);
}

/** Atomically compare-and-set circuit state and append its immutable outcome event. */
export function commitModelProviderCircuitOutcome(
  proposal: ModelProviderOutcomeProposal,
  env: StoreEnv = process.env,
) {
  return commit("/rest/v1/rpc/commit_model_provider_circuit_outcome_v1", proposal, null, env);
}

/** Explicit operator bootstrap. New providers remain disabled until separately enabled. */
export async function initializeModelProviderCircuit(provider: string, env: StoreEnv = process.env) {
  if (!PROVIDER.test(provider)) return { ok: false as const, code: "MODEL_PROVIDER_CIRCUIT_INPUT_INVALID" as const };
  const response = await adminResponse("/rest/v1/rpc/initialize_model_provider_circuit_v1", {
    p_provider: provider,
  }, env);
  if (!response?.ok) {
    await response?.body?.cancel().catch(() => undefined);
    return { ok: false as const, code: "MODEL_PROVIDER_CIRCUIT_STORE_FAILED" as const };
  }
  const body = await response.json().catch(() => null) as { status?: unknown; provider?: unknown; enabled?: unknown } | null;
  return body && (body.status === "initialized" || body.status === "existing")
    && body.provider === provider && typeof body.enabled === "boolean"
    ? { ok: true as const, status: body.status, provider, enabled: body.enabled }
    : { ok: false as const, code: "MODEL_PROVIDER_CIRCUIT_STORE_FAILED" as const };
}

/** Explicit operator switch; the database refuses enabling an uninitialized provider. */
export async function setModelProviderCircuitEnabled(
  provider: string,
  enabled: boolean,
  env: StoreEnv = process.env,
) {
  if (!PROVIDER.test(provider) || typeof enabled !== "boolean") {
    return { ok: false as const, code: "MODEL_PROVIDER_CIRCUIT_INPUT_INVALID" as const };
  }
  const response = await adminResponse("/rest/v1/rpc/set_model_provider_circuit_enabled_v1", {
    p_provider: provider, p_enabled: enabled,
  }, env);
  if (!response?.ok) {
    await response?.body?.cancel().catch(() => undefined);
    return { ok: false as const, code: "MODEL_PROVIDER_CIRCUIT_STORE_FAILED" as const };
  }
  const body = await response.json().catch(() => null) as { status?: unknown; provider?: unknown; enabled?: unknown } | null;
  return body?.status === "configured" && body.provider === provider && body.enabled === enabled
    ? { ok: true as const, provider, enabled }
    : { ok: false as const, code: "MODEL_PROVIDER_CIRCUIT_STORE_FAILED" as const };
}
