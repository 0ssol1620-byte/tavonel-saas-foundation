import { deriveBaselineSchema, verifiedEvidence, type Derivation, type EvidenceUnit } from "./ontology-derivation";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import type { WorldEvidence } from "./world-read-model";

/*
  C1 server side: the flag, the store, and the line between the internal and the public shape.

  TAVONEL_ONTOLOGY_INDUCTION_ENABLED, "true" or unset (PROGRAM-2026-11-04 appendix A). Unset: the
  workspace shows no Schema entry, every /api/ontology route answers 404 ONTOLOGY_INDUCTION_DISABLED
  before reading a session, and no RPC is called -- nothing is derived, listed or decided.

  The store is migration 20261107110000's three RPCs; this module never touches the tables.

  Two DTOs, two types. `InternalCandidate` is what the database returns and carries the support
  count and the run's receipt pins (model id, revision, prompt digest, price snapshot). The public
  `OntologyCandidate` is built field by field from it and has none of them -- not filtered out of
  the same object, never present -- so no score, threshold, prompt or price reaches a browser.

  Nothing reads a certified candidate in this wave. Typed extraction (C2, W3) is the first use.
*/

type Env = Readonly<Record<string, string | undefined>>;

export function ontologyInductionEnabled(env: Env = process.env): boolean {
  return env.TAVONEL_ONTOLOGY_INDUCTION_ENABLED === "true";
}

export type OntologyEvidence = Readonly<{
  evidenceId: string;
  documentId: string;
  page: number;
  bbox: readonly [number, number, number, number];
  quote: string;
}>;

/** Public DTO: what the Schema screen shows. No support count, no receipt pins. */
export type OntologyCandidate = Readonly<{
  candidateId: string;
  kind: "class" | "property";
  key: string;
  label: string;
  description: string;
  /** The deriver's own label, shown beside an edited one so the edit is visible. */
  proposedLabel: string;
  domainKey: string | null;
  rangeKey: string | null;
  evidence: readonly OntologyEvidence[];
  state: "proposed" | "certified" | "rejected";
  decidedAt: string | null;
  history: ReadonlyArray<Readonly<{ verdict: "certify" | "reject" | "edit"; decidedAt: string }>>;
}>;

export type OntologyRun = Readonly<{
  runId: string;
  collectionId: string;
  manifestDigest: string;
  deriver: "baseline" | "model";
  createdAt: string;
}>;

export type OntologyCandidatesResponse = Readonly<{ run: OntologyRun | null; candidates: readonly OntologyCandidate[] }>;

/** Internal DTO, as list_ontology_schema_candidates returns it. Server only. */
export type InternalCandidate = {
  candidateId: string; kind: "class" | "property"; key: string; label: string; description: string;
  editedLabel: string | null; editedDescription: string | null; domainKey: string | null; rangeKey: string | null;
  evidence: OntologyEvidence[]; support: number; state: "proposed" | "certified" | "rejected";
  decidedBy: string | null; decidedAt: string | null;
  decisions: Array<{ verdict: "certify" | "reject" | "edit"; decidedBy: string; decidedAt: string }>;
};
export type InternalRun = {
  runId: string; collectionId: string; manifestDigest: string; deriver: "baseline" | "model"; deriverVersion: string;
  documentIds: string[]; modelId: string; modelRevision: string; promptSha256: string | null; schemaSha256: string;
  inputsSha256: string; priceSnapshot: Record<string, unknown>; receiptSha256: string; createdAt: string;
};
export type InternalCandidates = { run: InternalRun | null; candidates: InternalCandidate[] };

export function toPublicCandidates(internal: InternalCandidates): OntologyCandidatesResponse {
  if (!internal.run) return { run: null, candidates: [] };
  const { runId, collectionId, manifestDigest, deriver, createdAt } = internal.run;
  return {
    run: { runId, collectionId, manifestDigest, deriver, createdAt },
    candidates: internal.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      key: candidate.key,
      label: candidate.editedLabel ?? candidate.label,
      description: candidate.editedDescription ?? candidate.description,
      proposedLabel: candidate.label,
      domainKey: candidate.domainKey,
      rangeKey: candidate.rangeKey,
      evidence: candidate.evidence.map(({ evidenceId, documentId, page, bbox, quote }) => ({ evidenceId, documentId, page, bbox, quote })),
      state: candidate.state,
      decidedAt: candidate.decidedAt,
      history: candidate.decisions.map(({ verdict, decidedAt }) => ({ verdict, decidedAt })),
    })),
  };
}

/* --------------------------------------------------------------------------------- derivation */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The World's evidence as derivation units. A unit whose document is not a product document id
 * (a deterministic sample, a legacy package) cannot be erased on source deletion, so the whole
 * derivation is refused rather than stored with evidence nothing can purge.
 */
export function unitsFromWorldEvidence(evidence: readonly WorldEvidence[]):
  { ok: true; units: EvidenceUnit[] } | { ok: false; code: "ONTOLOGY_SOURCE_UNBOUND" | "ONTOLOGY_NO_EVIDENCE" } {
  if (evidence.length === 0) return { ok: false, code: "ONTOLOGY_NO_EVIDENCE" };
  if (evidence.some((item) => !UUID.test(item.sourceId))) return { ok: false, code: "ONTOLOGY_SOURCE_UNBOUND" };
  return {
    ok: true,
    units: evidence.map((item) => ({ evidenceId: item.id, documentId: item.sourceId.toLowerCase(), page: item.page, bbox: item.bbox, text: item.excerpt })),
  };
}

/**
 * Run the baseline and re-check its evidence before anything is written. The baseline cannot
 * produce an unverifiable quote by construction; if it ever does, this refuses rather than stores.
 */
export function deriveForWorld(units: readonly EvidenceUnit[]): { ok: true; derivation: Derivation } | { ok: false; code: "ONTOLOGY_EVIDENCE_INVALID" | "ONTOLOGY_NO_CANDIDATES" } {
  const derivation = deriveBaselineSchema(units);
  const index = new Map(units.map((unit) => [unit.evidenceId, unit]));
  if (derivation.candidates.some((candidate) => verifiedEvidence(candidate.evidence, index).length !== candidate.evidence.length)) {
    return { ok: false, code: "ONTOLOGY_EVIDENCE_INVALID" };
  }
  if (derivation.candidates.length === 0) return { ok: false, code: "ONTOLOGY_NO_CANDIDATES" };
  return { ok: true, derivation };
}

/* ------------------------------------------------------------------------------------- store */

const STORE_ERRORS: Record<string, { code: string; status: number }> = {
  ontology_candidate_not_found: { code: "ONTOLOGY_CANDIDATE_NOT_FOUND", status: 404 },
  ontology_candidate_already_decided: { code: "ONTOLOGY_CANDIDATE_ALREADY_DECIDED", status: 409 },
  ontology_decision_reason_required: { code: "ONTOLOGY_DECISION_REASON_REQUIRED", status: 400 },
  ontology_decision_invalid: { code: "ONTOLOGY_DECISION_INVALID", status: 400 },
  ontology_source_deleted: { code: "ONTOLOGY_SOURCE_DELETED", status: 409 },
  ontology_candidate_evidence_required: { code: "ONTOLOGY_EVIDENCE_INVALID", status: 422 },
  ontology_candidate_evidence_invalid: { code: "ONTOLOGY_EVIDENCE_INVALID", status: 422 },
  ontology_candidate_limit_exceeded: { code: "ONTOLOGY_EVIDENCE_INVALID", status: 422 },
};

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: string; status: number };

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<StoreResult<T>> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "ONTOLOGY_STORE_NOT_CONFIGURED", status: 503 };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  } catch {
    return { ok: false, code: "ONTOLOGY_STORE_FAILED", status: 503 };
  }
  const payload = await response.json().catch(() => null) as { message?: unknown } | null;
  if (!response.ok) {
    const known = typeof payload?.message === "string" ? STORE_ERRORS[payload.message] : undefined;
    return known ? { ok: false, ...known } : { ok: false, code: "ONTOLOGY_STORE_FAILED", status: 503 };
  }
  if (!payload || typeof payload !== "object") return { ok: false, code: "ONTOLOGY_STORE_FAILED", status: 503 };
  return { ok: true, value: payload as T };
}

/**
 * `documentIds` is every document the deriver READ, not only those its evidence quotes: a run
 * whose input included a deleted document goes with it, because its candidates and counts were
 * shaped by that document even where no quote of it is kept.
 */
export async function recordDerivation(input: {
  workspaceKey: string; collectionId: string; manifestDigest: string; actorUserId: string; derivation: Derivation;
  documentIds: readonly string[];
}) {
  const { receipt, receiptSha256, candidates } = input.derivation;
  return rpc<{ runId: string; created: boolean; candidates: number }>("record_ontology_derivation_run", {
    p_workspace_key: input.workspaceKey,
    p_run: {
      collectionId: input.collectionId,
      manifestDigest: input.manifestDigest,
      deriver: receipt.deriver,
      deriverVersion: receipt.deriverVersion,
      documentIds: [...new Set(input.documentIds)],
      inputsSha256: receipt.inputsSha256,
      schemaSha256: receipt.schemaSha256,
      modelId: receipt.modelId,
      modelRevision: receipt.modelRevision,
      promptSha256: receipt.promptSha256,
      priceSnapshot: receipt.priceSnapshot,
      receipt,
      receiptSha256,
      createdBy: input.actorUserId,
    },
    p_candidates: candidates,
  });
}

export async function listCandidates(workspaceKey: string, collectionId: string) {
  return rpc<InternalCandidates>("list_ontology_schema_candidates", { p_workspace_key: workspaceKey, p_collection_id: collectionId });
}

export async function decideCandidate(input: {
  workspaceKey: string; candidateId: string; verdict: "certify" | "reject" | "edit"; actorUserId: string; reason: string;
  edit: { label: string; description: string } | null;
}) {
  return rpc<{ decisionId: string; candidateId: string; verdict: string; state: OntologyCandidate["state"] }>(
    "decide_ontology_schema_candidate", {
      p_workspace_key: input.workspaceKey,
      p_candidate_id: input.candidateId,
      p_verdict: input.verdict,
      p_actor: input.actorUserId,
      p_reason: input.reason,
      p_edit: input.edit,
    });
}
