import { createHash, randomUUID } from "node:crypto";
import type { RetrievalDiagnostics } from "./retrieval-pipeline";
import type { ProductionRetrievalRuntime } from "./retrieval-runtime-config";
import type { ModelProviderAttemptLifecycle, ModelProviderAttemptTerminal } from "./model-provider-dispatch";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export const MODEL_ATTEMPT_RECEIPT_SCHEMA = "tavonel.model_attempt_receipt.v1" as const;
export const MODEL_ATTEMPT_DECISION_SCHEMA = "tavonel.model_attempt_decision.v2" as const;
export const MODEL_ATTEMPT_OUTCOME_SCHEMA = "tavonel.model_attempt_outcome.v2" as const;
export const RETRIEVAL_ROUTE_POLICY_VERSION = "retrieval-route-policy/v1" as const;

export type PublicRetrievalRoute = {
  routeClass: "full_model" | "partial_model" | "deterministic";
  degradationClasses: Array<
    "dense_unavailable" | "reranker_unavailable" | "structure_unavailable"
  >;
};

type RuntimeDecision = ProductionRetrievalRuntime["decision"];
type AttemptedRole = "embedder" | "reranker";
type ModelAttemptFailureClass = InternalModelAttemptReceipt["failureClass"];
const PRE_MODEL_FAILURES = new Set([
  "RETRIEVAL_QUESTION_INVALID", "RETRIEVAL_RUN_NOT_FOUND", "RETRIEVAL_PROFILE_NOT_FOUND",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sha256Digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function degradationClasses(values: readonly string[]): PublicRetrievalRoute["degradationClasses"] {
  const classes = new Set<PublicRetrievalRoute["degradationClasses"][number]>();
  for (const value of values) {
    if (value.startsWith("dense retrieval skipped:")) classes.add("dense_unavailable");
    else if (value.startsWith("reranker not applied:")) classes.add("reranker_unavailable");
    else if (value.startsWith("structure retrieval skipped:")) classes.add("structure_unavailable");
  }
  return [...classes];
}

/** A deliberately small public projection. Registry records and provider error strings stay internal. */
export function buildPublicRetrievalRoute(
  attemptedRoles: readonly AttemptedRole[],
  degradations: readonly string[],
): PublicRetrievalRoute {
  const classes = degradationClasses(degradations);
  return {
    routeClass: attemptedRoles.length === 0
      ? "deterministic"
      : classes.some((value) => value === "dense_unavailable" || value === "reranker_unavailable")
        ? "partial_model"
        : "full_model",
    degradationClasses: classes,
  };
}

export function attemptedRetrievalModelRoles(
  runtime: Pick<ProductionRetrievalRuntime, "embedder" | "reranker">,
  diagnostics: Pick<RetrievalDiagnostics, "rerankerApplied" | "degradations">,
): AttemptedRole[] {
  const roles: AttemptedRole[] = [];
  // A successful pipeline result can only be produced after embedQuery completed or returned
  // its bounded provider failure. Early index/store failures never call this helper.
  if (runtime.embedder) roles.push("embedder");
  if (runtime.reranker && (diagnostics.rerankerApplied
    || diagnostics.degradations.some((value) => value.startsWith("reranker not applied:")))) {
    roles.push("reranker");
  }
  return roles;
}

/** Failure codes emitted before the compile run is resolved cannot have reached a model. */
export function attemptedRetrievalModelRolesOnFailure(
  runtime: Pick<ProductionRetrievalRuntime, "embedder">,
  failureCode: string,
): AttemptedRole[] {
  return runtime.embedder && !PRE_MODEL_FAILURES.has(failureCode) ? ["embedder"] : [];
}

type InternalModelAttemptReceipt = {
  schemaVersion: typeof MODEL_ATTEMPT_RECEIPT_SCHEMA;
  attemptId: string;
  attemptedAt: string;
  endpoint: "ask" | "search";
  tenantDigest: string;
  collectionDigest: string;
  worldManifestDigest: string;
  inputDigest: string;
  policyVersion: typeof RETRIEVAL_ROUTE_POLICY_VERSION;
  routeDecisionDigest: string;
  modelRoute: RuntimeDecision;
  attemptedRoles: AttemptedRole[];
  outcome: "succeeded" | "degraded" | "failed";
  failureClass: "none" | "provider_unavailable" | "invalid_model_output" | "downstream_failure";
  costReferenceDigests: string[];
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type ModelAttemptDecisionLineage = {
  policyId: string;
  policyVersion: string;
  policyRevision: number;
  rolloutRevision: number;
  assignmentId: string;
  policyDigest: string;
  evidenceDigest: string;
  scopeDigest: string;
  assignmentDigest: string;
  thresholdsDigest: string;
  indexStateDigest: string;
  controlId: string;
  chosenId: string;
  profileId: string;
  profileDigest: string;
  runId: string;
  shadowId: string | null;
  reservationId: string;
  admissionId: string;
  retryOfAttemptId: string | null;
  retryOrdinal: number;
};

type AuditedAdapterResult = {
  status: "ok" | "error";
  reason?: string;
  receipt: { outputDigest: string | null; timedOut: boolean; durationMs: number };
};

export type RetrievalModelAttemptContext = {
  endpoint: "ask" | "search";
  role: AttemptedRole;
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  query: string;
  modelRoute: RuntimeDecision;
  lineage: Omit<ModelAttemptDecisionLineage, "reservationId" | "admissionId">;
};

export type ModelAttemptTerminalOutcome = {
  outcome: "succeeded" | "degraded" | "failed";
  failureClass: ModelAttemptFailureClass;
  latencyMs: number;
  usage: {
    meter: string;
    inputUnits: number;
    outputUnits: number;
    totalUnits: number;
    billedUnits: number;
  };
  priceReferenceDigest: string;
  costUsdMicros: number;
  outputDigest: string;
  trustReferenceDigest: string;
};

type ModelAttemptDecisionReceipt = ModelAttemptDecisionLineage & {
  schemaVersion: typeof MODEL_ATTEMPT_DECISION_SCHEMA;
  attemptId: string;
  admittedAt: string;
  endpoint: "ask" | "search";
  attemptedRole: AttemptedRole;
  provider: string;
  model: string;
  meter: string;
  tenantDigest: string;
  collectionDigest: string;
  worldManifestDigest: string;
  inputDigest: string;
  routeDecisionDigest: string;
};

type ModelAttemptOutcomeReceipt = ModelAttemptTerminalOutcome & {
  schemaVersion: typeof MODEL_ATTEMPT_OUTCOME_SCHEMA;
  outcomeId: string;
  attemptId: string;
  completedAt: string;
};

export type ModelAttemptDecisionPersistenceResult =
  | { ok: true; attemptId: string }
  | { ok: false; code: "MODEL_ATTEMPT_DECISION_UNAVAILABLE" };

export type ModelAttemptOutcomePersistenceResult =
  | { ok: true; attemptId: string; outcomeId: string }
  | { ok: false; code: "MODEL_ATTEMPT_OUTCOME_UNAVAILABLE" };

/**
 * Commits the decision and its complete control-plane lineage before provider dispatch. The
 * query and evaluated feature values cross this boundary only as digests.
 */
export async function admitModelAttemptDecision(input: {
  endpoint: "ask" | "search";
  attemptedRole: AttemptedRole;
  provider: string;
  model: string;
  meter: string;
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  query: string;
  modelRoute: RuntimeDecision;
  lineage: ModelAttemptDecisionLineage;
  attemptId?: string;
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<ModelAttemptDecisionPersistenceResult> {
  const config = readSupabaseAdminConfig(input.env ?? process.env);
  if (!config) return { ok: false, code: "MODEL_ATTEMPT_DECISION_UNAVAILABLE" };
  const attemptId = input.attemptId ?? randomUUID();
  const receipt: ModelAttemptDecisionReceipt = {
    schemaVersion: MODEL_ATTEMPT_DECISION_SCHEMA,
    attemptId,
    admittedAt: (input.now ?? new Date()).toISOString(),
    endpoint: input.endpoint,
    attemptedRole: input.attemptedRole,
    provider: input.provider,
    model: input.model,
    meter: input.meter,
    tenantDigest: sha256Digest(input.workspaceKey),
    collectionDigest: sha256Digest(input.collectionId),
    worldManifestDigest: input.worldManifestDigest,
    inputDigest: sha256Digest(input.query.normalize("NFKC").replace(/\s+/g, " ").trim()),
    routeDecisionDigest: sha256Digest(canonical(input.modelRoute)),
    ...input.lineage,
  };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/admit_model_attempt_decision_v2", {
      method: "POST",
      body: JSON.stringify({ p_receipt: receipt }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, code: "MODEL_ATTEMPT_DECISION_UNAVAILABLE" };
    }
    const result = await response.json().catch(() => null) as { attemptId?: unknown } | null;
    return result?.attemptId === attemptId && UUID.test(attemptId)
      ? { ok: true, attemptId }
      : { ok: false, code: "MODEL_ATTEMPT_DECISION_UNAVAILABLE" };
  } catch {
    return { ok: false, code: "MODEL_ATTEMPT_DECISION_UNAVAILABLE" };
  }
}

/** Appends the one terminal outcome for an already-admitted decision. */
export async function recordModelAttemptOutcome(input: {
  attemptId: string;
  terminal: ModelAttemptTerminalOutcome;
  outcomeId?: string;
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<ModelAttemptOutcomePersistenceResult> {
  const config = readSupabaseAdminConfig(input.env ?? process.env);
  if (!config) return { ok: false, code: "MODEL_ATTEMPT_OUTCOME_UNAVAILABLE" };
  const outcomeId = input.outcomeId ?? randomUUID();
  const receipt: ModelAttemptOutcomeReceipt = {
    schemaVersion: MODEL_ATTEMPT_OUTCOME_SCHEMA,
    outcomeId,
    attemptId: input.attemptId,
    completedAt: (input.now ?? new Date()).toISOString(),
    ...input.terminal,
  };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/record_model_attempt_outcome_v2", {
      method: "POST",
      body: JSON.stringify({ p_receipt: receipt }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, code: "MODEL_ATTEMPT_OUTCOME_UNAVAILABLE" };
    }
    const result = await response.json().catch(() => null) as {
      attemptId?: unknown; outcomeId?: unknown;
    } | null;
    return result?.attemptId === input.attemptId && result.outcomeId === outcomeId
      && UUID.test(input.attemptId) && UUID.test(outcomeId)
      ? { ok: true, attemptId: input.attemptId, outcomeId }
      : { ok: false, code: "MODEL_ATTEMPT_OUTCOME_UNAVAILABLE" };
  } catch {
    return { ok: false, code: "MODEL_ATTEMPT_OUTCOME_UNAVAILABLE" };
  }
}

function classifiedTerminal<T extends AuditedAdapterResult>(
  input: ModelProviderAttemptTerminal<T>,
  worldManifestDigest: string,
): ModelAttemptTerminalOutcome {
  const value = input.value;
  const failed = input.dispatchFailureCode !== null || value === null || value.status === "error";
  const reason = input.dispatchFailureCode ?? value?.reason ?? "";
  const invalid = /schema validation|omitted|dimension|profile expects|returned no vector/i.test(reason);
  return {
    outcome: failed ? "failed" : "succeeded",
    failureClass: failed ? (invalid ? "invalid_model_output" : "provider_unavailable") : "none",
    latencyMs: Math.max(input.latencyMs, value?.receipt.durationMs ?? 0),
    usage: {
      meter: input.meter,
      inputUnits: 0,
      outputUnits: 0,
      totalUnits: input.actualUnits,
      billedUnits: input.actualUnits,
    },
    priceReferenceDigest: sha256Digest(
      `${input.provider}:${input.model}:${input.meter}:${input.priceVersion}:${input.unitMicrousd}`,
    ),
    costUsdMicros: input.actualMicrousd,
    outputDigest: value?.receipt.outputDigest
      ?? sha256Digest(`${input.provider}:${input.model}:${input.admissionId}:${reason || "no-output"}`),
    trustReferenceDigest: worldManifestDigest,
  };
}

/** Binds a verified router decision to spend/circuit identifiers created by real dispatch. */
export function createRetrievalModelAttemptLifecycle<T extends AuditedAdapterResult>(
  context: RetrievalModelAttemptContext,
): ModelProviderAttemptLifecycle<T> {
  return {
    async admit(admission) {
      return admitModelAttemptDecision({
        endpoint: context.endpoint,
        attemptedRole: context.role,
        provider: admission.provider,
        model: admission.model,
        meter: admission.meter,
        workspaceKey: context.workspaceKey,
        collectionId: context.collectionId,
        worldManifestDigest: context.worldManifestDigest,
        query: context.query,
        modelRoute: context.modelRoute,
        lineage: {
          ...context.lineage,
          reservationId: admission.reservationId,
          admissionId: admission.admissionId,
        },
      });
    },
    async recordTerminal(terminal) {
      return (await recordModelAttemptOutcome({
        attemptId: terminal.attemptId,
        terminal: classifiedTerminal(terminal, context.worldManifestDigest),
      })).ok;
    },
  };
}

function buildInternalReceipt(input: {
  endpoint: "ask" | "search";
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  query: string;
  modelRoute: RuntimeDecision;
  attemptedRoles: AttemptedRole[];
  degradations: readonly string[];
  costReferences?: readonly string[];
  execution?: { outcome: "failed"; failureClass: "downstream_failure" };
  now?: Date;
}): InternalModelAttemptReceipt {
  const publicRoute = buildPublicRetrievalRoute(input.attemptedRoles, input.degradations);
  const invalidOutput = input.degradations.some((value) =>
    /returned no vector|profile expects|invalid/i.test(value));
  return {
    schemaVersion: MODEL_ATTEMPT_RECEIPT_SCHEMA,
    attemptId: randomUUID(),
    attemptedAt: (input.now ?? new Date()).toISOString(),
    endpoint: input.endpoint,
    tenantDigest: sha256Digest(input.workspaceKey),
    collectionDigest: sha256Digest(input.collectionId),
    worldManifestDigest: input.worldManifestDigest,
    inputDigest: sha256Digest(input.query.normalize("NFKC").replace(/\s+/g, " ").trim()),
    policyVersion: RETRIEVAL_ROUTE_POLICY_VERSION,
    routeDecisionDigest: sha256Digest(canonical(input.modelRoute)),
    // This is the only persistence boundary for the detailed decision. It is never returned by
    // this module and the API routes use buildPublicRetrievalRoute for their response DTO.
    modelRoute: input.modelRoute,
    attemptedRoles: [...input.attemptedRoles],
    outcome: input.execution?.outcome
      ?? (publicRoute.routeClass === "full_model" ? "succeeded" : "degraded"),
    failureClass: input.execution?.failureClass ?? (invalidOutput ? "invalid_model_output"
      : publicRoute.routeClass === "partial_model" ? "provider_unavailable" : "none"),
    costReferenceDigests: (input.costReferences ?? []).map(sha256Digest),
  };
}

export type ModelAttemptPersistenceResult =
  | { required: false; ok: true }
  | { required: true; ok: true; receiptId: string }
  | { required: true; ok: false; code: "MODEL_ATTEMPT_RECEIPT_UNAVAILABLE" };

/**
 * Persist the detailed decision only when a model/provider call really ran. A missing receipt
 * store therefore cannot take lexical-only retrieval offline, while a paid/model-backed result
 * is withheld unless its audit receipt commits.
 */
export async function persistRetrievalModelAttempt(input: {
  endpoint: "ask" | "search";
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  query: string;
  modelRoute: RuntimeDecision;
  attemptedRoles: AttemptedRole[];
  degradations: readonly string[];
  costReferences?: readonly string[];
  execution?: { outcome: "failed"; failureClass: "downstream_failure" };
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<ModelAttemptPersistenceResult> {
  if (input.attemptedRoles.length === 0) return { required: false, ok: true };
  const config = readSupabaseAdminConfig(input.env ?? process.env);
  if (!config) return { required: true, ok: false, code: "MODEL_ATTEMPT_RECEIPT_UNAVAILABLE" };
  const receipt = buildInternalReceipt(input);
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/record_model_attempt_receipt_v1", {
      method: "POST",
      body: JSON.stringify({ p_receipt: receipt }),
    });
  } catch {
    return { required: true, ok: false, code: "MODEL_ATTEMPT_RECEIPT_UNAVAILABLE" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { required: true, ok: false, code: "MODEL_ATTEMPT_RECEIPT_UNAVAILABLE" };
  }
  const result = await response.json().catch(() => null) as { receiptId?: unknown } | null;
  return result && typeof result.receiptId === "string" && UUID.test(result.receiptId)
    ? { required: true, ok: true, receiptId: result.receiptId }
    : { required: true, ok: false, code: "MODEL_ATTEMPT_RECEIPT_UNAVAILABLE" };
}
