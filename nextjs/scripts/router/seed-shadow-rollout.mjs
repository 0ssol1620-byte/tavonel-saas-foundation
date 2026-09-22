#!/usr/bin/env node
/**
 * Seed a SHADOW rollout of the adaptive model router for one production scope.
 *
 * Dry run by default: it prints exactly the rows and RPC calls `--execute` would make and
 * touches nothing. `--execute` writes through the service-role REST surface using
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the pair `readSupabaseAdminConfig`
 * already reads, so the script and the request path cannot disagree about which project).
 *
 * Every digest that the runtime recomputes is computed here by the runtime's own functions, and
 * the two authoritative control-plane digests (evidenceDigest, policyDigest) are derived in
 * PostgreSQL by `adaptive_router_canonical_digest_v1` -- client code never supplies them.
 *
 * Idempotent: the receipt, policy, operation and event identifiers are derived from the scope, so
 * a second run inserts nothing new and the transition RPC replays its own receipt.
 *
 *   node --experimental-strip-types scripts/router/seed-shadow-rollout.mjs \
 *     --workspace <key> --collection <uuid> --endpoint both
 *   ... --execute
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { candidateIdentityKey } from "../../lib/adaptive-router.ts";
import {
  adaptiveRouterCandidateSetDigest,
  adaptiveRouterIndexStateDigest,
  adaptiveRouterScopeDigest,
  adaptiveRouterThresholdsDigest,
} from "../../lib/adaptive-router-control-plane-store.ts";
import {
  buildAdaptiveRouterCandidateSet,
  selectProductionRetrievalRuntime,
} from "../../lib/retrieval-runtime-config.ts";
import { contentAddressedRetrievalProfileIdentity } from "../../lib/retrieval-profile-identity.ts";
import { RETRIEVAL_MODEL_REGISTRY_ENV } from "../../lib/retrieval-model-registry.ts";
import { readRetrievalRuntimeEnv } from "../../lib/retrieval-runtime-config.ts";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "../../lib/supabase-admin.ts";

export const EVIDENCE_DOMAIN = "tavonel.adaptive_router_evidence.v1";
export const POLICY_DOMAIN = "tavonel.adaptive_router_policy.v1";
/** Shadow executes the control for every request, so the candidate share is exactly zero. */
export const SHADOW_CANDIDATE_BASIS_POINTS = 0;
const DAY_MS = 86_400_000;

const here = path.dirname(fileURLToPath(import.meta.url));

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function digestOf(value) {
  return `sha256:${sha256Hex(JSON.stringify(value))}`;
}

/** Same shape the control plane derives its assignment ids with: a v4-formatted content address. */
function derivedUuid(parts) {
  const hex = sha256Hex(JSON.stringify(parts));
  return [
    hex.slice(0, 8), hex.slice(8, 12), `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`, hex.slice(20, 32),
  ].join("-");
}

/**
 * The source digest of this script. It identifies what produced the shadow-entry receipt; it is
 * not a measurement and is never presented as one.
 */
export function producerDigest() {
  return `sha256:${createHash("sha256")
    .update(readFileSync(path.resolve(here, "seed-shadow-rollout.mjs")))
    .digest("hex")}`;
}

/**
 * Build every row and RPC argument for a none -> shadow transition of one scope. Pure: it reads
 * configuration from `env` and never touches the network.
 */
export function buildShadowSeedPlan(input) {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const validFrom = input.validFrom ?? new Date(Math.floor(now.getTime() / 1000) * 1000);
  const validUntil = input.validUntil ?? new Date(validFrom.getTime() + 30 * DAY_MS);
  const version = input.version ?? "shadow-1";
  if (!input.workspaceKey || !input.collectionId) throw new Error("workspace and collection required");
  if (input.endpoint !== "ask" && input.endpoint !== "search") throw new Error("endpoint must be ask or search");
  if (!(validUntil > validFrom)) throw new Error("validUntil must be after validFrom");

  let registry;
  try { registry = JSON.parse(env[RETRIEVAL_MODEL_REGISTRY_ENV] ?? "null"); }
  catch { throw new Error(`${RETRIEVAL_MODEL_REGISTRY_ENV} is not valid JSON`); }
  const fixed = selectProductionRetrievalRuntime(input.workspaceKey, {
    env: readRetrievalRuntimeEnv(env), registry, now,
  });
  const embedderIdentity = fixed.embedder?.identity();
  const endpointId = fixed.embedder?.endpointId?.();
  if (!embedderIdentity || !endpointId) {
    throw new Error(
      "no admitted embedder: the runtime env (TAVONEL_RETRIEVAL_EMBEDDER_URL / "
      + "TAVONEL_RETRIEVAL_RERANKER_URL / TAVONEL_RUNPOD_API_KEY) and an eligible "
      + `${RETRIEVAL_MODEL_REGISTRY_ENV} row are required to name the control candidate`,
    );
  }
  const profileIdentity = contentAddressedRetrievalProfileIdentity(fixed.profile);
  const candidateSet = buildAdaptiveRouterCandidateSet({
    fixed, profileIdentity, embedderIdentity, endpointId, env,
  });
  if (!candidateSet) {
    throw new Error(
      "adaptive control configuration is missing or unreadable: set "
      + "TAVONEL_ADAPTIVE_RETRIEVAL_CONTROL_JSON and TAVONEL_ADAPTIVE_RETRIEVAL_CHALLENGER_JSON",
    );
  }
  const { control, candidates } = candidateSet;
  const controlKey = candidateIdentityKey(control.candidate);
  const orderedCandidateKeys = candidates.map(({ candidate }) => candidateIdentityKey(candidate.identity));
  if (orderedCandidateKeys.filter((key) => key !== controlKey).length === 0) {
    throw new Error(
      "shadow needs at least one declared challenger: with only the control candidate the "
      + "runtime rejects the resolved policy as ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID and "
      + "/search and /ask answer 503 for this scope. Declare "
      + "TAVONEL_ADAPTIVE_RETRIEVAL_CHALLENGER_JSON first.",
    );
  }

  const scope = {
    workspaceKey: input.workspaceKey,
    collectionId: input.collectionId,
    endpoint: input.endpoint,
    retrievalProfileDigest: profileIdentity.digest,
  };
  const scopeDigest = adaptiveRouterScopeDigest(scope);
  const policyId = derivedUuid({ kind: "policy", scopeDigest, version });
  const policyRevision = 1;
  const routerPolicy = {
    schemaVersion: "tavonel.adaptive_router.v1",
    policyId,
    version,
    mode: "shadow",
    orderedCandidateKeys,
    canaryPermille: SHADOW_CANDIDATE_BASIS_POINTS,
  };
  const candidateSetDigest = adaptiveRouterCandidateSetDigest(candidates);
  const indexStateDigest = adaptiveRouterIndexStateDigest(candidates);
  const thresholdsDigest = adaptiveRouterThresholdsDigest(control, routerPolicy);
  const receiptId = derivedUuid({ kind: "evidence", scopeDigest, policyId, policyRevision });
  const operationId = derivedUuid({ kind: "operation", policyId, to: "shadow", policyRevision });
  const eventId = derivedUuid({ kind: "event", policyId, to: "shadow", policyRevision });
  const revisions = { controlRevision: 1, candidateRevision: 2, rollbackRevision: 1 };

  // A shadow-entry receipt records that shadow was entered with no measurement, because no
  // measurement exists yet -- shadow is what produces the first one. Nothing here is a result:
  // there is no corpus, no evaluator and no threshold outcome, and each of those is stated as
  // such rather than filled with a number.
  const evidenceReceipt = {
    schemaVersion: EVIDENCE_DOMAIN,
    receiptId,
    stage: "shadow_entry",
    measurement: "none",
    corpusDigest: digestOf({ corpus: "none", reason: "shadow_entry_precedes_measurement" }),
    evaluatorDigest: digestOf({ evaluator: "none", reason: "shadow_entry_precedes_measurement" }),
    thresholdResults: {},
    scopeDigest,
    controlId: controlKey,
    challengerIds: orderedCandidateKeys.filter((key) => key !== controlKey),
    producer: { script: "nextjs/scripts/router/seed-shadow-rollout.mjs", sourceDigest: producerDigest() },
    measuredAt: validFrom.toISOString(),
  };
  const evidenceRow = (evidenceDigest) => ({
    receipt_id: receiptId,
    evidence_digest: evidenceDigest,
    corpus_digest: evidenceReceipt.corpusDigest,
    evaluator_digest: evidenceReceipt.evaluatorDigest,
    measured_at: validFrom.toISOString(),
    valid_from: validFrom.toISOString(),
    valid_until: validUntil.toISOString(),
    receipt: { ...evidenceReceipt, evidenceDigest },
  });

  const policyBody = (evidenceDigest) => ({
    schemaVersion: POLICY_DOMAIN,
    policyId,
    policyRevision,
    evidenceDigest,
    thresholdsDigest,
    scopeDigest,
    candidateSetDigest,
    indexStateDigest,
    ...revisions,
    candidateBasisPoints: SHADOW_CANDIDATE_BASIS_POINTS,
    thresholds: control.requirements,
    scope,
    candidates: candidates.map(({ candidate }) => ({
      candidateKey: candidateIdentityKey(candidate.identity),
      identity: candidate.identity,
      capabilities: candidate.capabilities,
      region: candidate.region,
      retentionDays: candidate.retentionDays,
      index: candidate.index,
      role: candidateIdentityKey(candidate.identity) === controlKey ? "control" : "challenger",
    })),
    routerPolicy,
  });
  const policyRow = (evidenceDigest, policyDigest) => ({
    policy_id: policyId,
    policy_revision: policyRevision,
    policy_digest: policyDigest,
    evidence_receipt_id: receiptId,
    evidence_digest: evidenceDigest,
    thresholds_digest: thresholdsDigest,
    scope_digest: scopeDigest,
    candidate_set_digest: candidateSetDigest,
    index_state_digest: indexStateDigest,
    ...{
      control_revision: revisions.controlRevision,
      candidate_revision: revisions.candidateRevision,
      rollback_revision: revisions.rollbackRevision,
    },
    candidate_basis_points: SHADOW_CANDIDATE_BASIS_POINTS,
    valid_from: validFrom.toISOString(),
    valid_until: validUntil.toISOString(),
    policy: { ...policyBody(evidenceDigest), policyDigest },
  });

  const transitionArgs = (evidenceDigest, policyDigest) => ({
    p_operation_id: operationId,
    p_event_id: eventId,
    p_policy_id: policyId,
    p_expected_rollout_revision: 0,
    p_expected_state: "none",
    p_next_state: "shadow",
    p_policy_revision: policyRevision,
    p_policy_digest: policyDigest,
    p_evidence_digest: evidenceDigest,
    p_thresholds_digest: thresholdsDigest,
    p_scope_digest: scopeDigest,
    p_candidate_set_digest: candidateSetDigest,
    p_index_state_digest: indexStateDigest,
    p_control_revision: revisions.controlRevision,
    p_candidate_revision: revisions.candidateRevision,
    p_rollback_revision: revisions.rollbackRevision,
    p_valid_from: validFrom.toISOString(),
    p_valid_until: validUntil.toISOString(),
    p_reason: `shadow entry for scope ${scopeDigest.slice(0, 23)} (${input.endpoint})`,
  });

  return {
    scope, scopeDigest, policyId, policyRevision, version, receiptId, operationId, eventId,
    controlKey, orderedCandidateKeys, candidateSetDigest, indexStateDigest, thresholdsDigest,
    ...revisions,
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    evidenceReceipt, routerPolicy,
    evidenceRow, policyBody, policyRow, transitionArgs,
  };
}

/** Deterministic, digest-free view of a plan: what a dry run prints and a test compares. */
export function shadowSeedPlanSummary(plan) {
  return {
    scope: plan.scope,
    scopeDigest: plan.scopeDigest,
    policyId: plan.policyId,
    policyRevision: plan.policyRevision,
    version: plan.version,
    mode: plan.routerPolicy.mode,
    candidateBasisPoints: SHADOW_CANDIDATE_BASIS_POINTS,
    controlKey: plan.controlKey,
    orderedCandidateKeys: plan.orderedCandidateKeys,
    candidateSetDigest: plan.candidateSetDigest,
    indexStateDigest: plan.indexStateDigest,
    thresholdsDigest: plan.thresholdsDigest,
    receiptId: plan.receiptId,
    operationId: plan.operationId,
    eventId: plan.eventId,
    controlRevision: plan.controlRevision,
    candidateRevision: plan.candidateRevision,
    rollbackRevision: plan.rollbackRevision,
    validFrom: plan.validFrom,
    validUntil: plan.validUntil,
    writes: [
      "POST /rest/v1/rpc/adaptive_router_canonical_digest_v1 (derive evidenceDigest)",
      "POST /rest/v1/adaptive_router_evidence_receipts",
      "POST /rest/v1/rpc/adaptive_router_canonical_digest_v1 (derive policyDigest)",
      "POST /rest/v1/adaptive_router_policy_revisions",
      "POST /rest/v1/rpc/transition_adaptive_router_rollout_v1 (none -> shadow)",
    ],
  };
}

async function callRest(config, pathname, body, headers = {}) {
  const response = await supabaseAdminRequest(config, pathname, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    // A duplicate is this script's own earlier run: the identifiers are content-derived.
    if (response.status === 409) return { duplicate: true, body: text };
    throw new Error(`${pathname} -> HTTP ${response.status} ${text}`);
  }
  return { duplicate: false, body: text ? JSON.parse(text) : null };
}

async function canonicalDigest(config, document, omitted, domain) {
  const result = await callRest(config, "/rest/v1/rpc/adaptive_router_canonical_digest_v1", {
    p_document: document, p_omitted_keys: omitted, p_domain: domain,
  });
  const digest = result.body;
  if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`adaptive_router_canonical_digest_v1 returned ${JSON.stringify(digest)}`);
  }
  return digest;
}

export async function executeShadowSeedPlan(plan, config) {
  const evidenceDigest = await canonicalDigest(
    config, plan.evidenceReceipt, ["evidenceDigest"], EVIDENCE_DOMAIN,
  );
  const evidence = await callRest(
    config, "/rest/v1/adaptive_router_evidence_receipts", plan.evidenceRow(evidenceDigest),
    { prefer: "resolution=ignore-duplicates" },
  );
  const policyDigest = await canonicalDigest(
    config, plan.policyBody(evidenceDigest), ["policyDigest"], POLICY_DOMAIN,
  );
  const policy = await callRest(
    config, "/rest/v1/adaptive_router_policy_revisions",
    plan.policyRow(evidenceDigest, policyDigest), { prefer: "resolution=ignore-duplicates" },
  );
  const transition = await callRest(
    config, "/rest/v1/rpc/transition_adaptive_router_rollout_v1",
    plan.transitionArgs(evidenceDigest, policyDigest),
  );
  return {
    evidenceDigest, policyDigest,
    evidenceInserted: !evidence.duplicate,
    policyInserted: !policy.duplicate,
    transition: transition.body,
  };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index < 0 || index === args.length - 1 ? null : args[index + 1];
}

async function main(argv) {
  const args = argv.slice(2);
  const workspaceKey = valueAfter(args, "--workspace");
  const collectionId = valueAfter(args, "--collection");
  const endpointArg = valueAfter(args, "--endpoint") ?? "both";
  const execute = args.includes("--execute");
  const endpoints = endpointArg === "both" ? ["ask", "search"] : [endpointArg];
  if (!workspaceKey || !collectionId) {
    throw new Error("usage: seed-shadow-rollout.mjs --workspace <key> --collection <id> "
      + "[--endpoint ask|search|both] [--valid-until <iso>] [--version <id>] [--execute]");
  }
  const validUntilArg = valueAfter(args, "--valid-until");
  const version = valueAfter(args, "--version") ?? undefined;
  const config = execute ? readSupabaseAdminConfig(process.env) : null;
  if (execute && !config) {
    throw new Error("--execute needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  const output = [];
  for (const endpoint of endpoints) {
    const plan = buildShadowSeedPlan({
      workspaceKey, collectionId, endpoint, version,
      validUntil: validUntilArg ? new Date(validUntilArg) : undefined,
    });
    const summary = shadowSeedPlanSummary(plan);
    output.push(execute
      ? { ...summary, executed: await executeShadowSeedPlan(plan, config) }
      : { ...summary, executed: null });
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "tavonel.router_shadow_seed.v1",
    mode: execute ? "execute" : "dry-run",
    scopes: output,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
