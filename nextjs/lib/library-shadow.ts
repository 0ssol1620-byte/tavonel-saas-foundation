import { randomUUID } from "node:crypto";
import { checkConnectorSourceAccessForViewer } from "./connector-source-access";
import {
  DOC_TYPE_LABEL_SET_VERSION, DOC_TYPES, RULES_DOC_TYPE_V1, TEXT_FINGERPRINT_VERSION, TOPIC_LABEL_SET_VERSION,
  TOPIC_METHOD, TOPIC_METHOD_VERSION, proposeTopics, sha256, textFingerprint,
  type DocType, type DocTypeProposal, type DocTypeProposer,
} from "./library-methods";
import { deliverOperationsAlert } from "./operations-p0";
import { processingCohortRefusal } from "./processing-workspace-grant";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  B2a/B2b/B2c (PROGRAM-2026-11-04 §4.B): near-duplicate, document-type and topic-tag proposals at
  compile intake, shadow first, plus the Library data model as server-side DTOs. No UI (B4).

  TAVONEL_LIBRARY_ORGANIZE_MODE, default off:
    off     no computation, no store call, nothing about the compile changes.
    shadow  the text fingerprint, the document-type proposal and the topic proposals of every
            document of the compile are recorded (migration 20261107100000); the only output is
            the internal telemetry line `library_organize_recorded` with counts of what this call
            added. The compile response, the Core request and the stored World are unchanged.
    on      as shadow for recording. In addition the Library read (readLibraryDocuments) answers,
            and only for a workspace named in TAVONEL_PROCESSING_WORKSPACE_COHORT: `on` is a
            canary, and an unset cohort does NOT widen it (rollout is a separate reviewed change).

  In no mode does a proposal change what is compiled, stored or charged. A failed recording is
  logged as an error and the compile proceeds exactly as with the flag off -- an annotation, not a
  gate. A different text fingerprint for a recorded version is an integrity fault and pages.

  Methods (library-methods.ts) are deterministic and call no model and no network. The document-type
  proposer is a parameter so an Arena arm can be recorded beside the rules baseline; whatever it
  returns is checked against label set v0 here, and an answer outside it, or a proposer that
  throws, is recorded as an abstention with its reason -- never as "other".
*/

export type LibraryOrganizeMode = "off" | "shadow" | "on";
type Env = Readonly<Record<string, string | undefined>>;
type Region = Readonly<{ regionId: string; text: string; pageIndex0: number; order: number }>;
type Input = Readonly<{ documentId: string; versionKey: string; inputSha256: string; text: string; regions?: readonly Region[] }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUNBOOK = "https://github.com/0ssol1620-byte/tavonel-saas-foundation/blob/main/docs/runbooks/P0_INCIDENT_COST_ALERTS.md";
const DOC_TYPE_SET = new Set<string>(DOC_TYPES);
/*
  Shadow compute budget: total OCR characters of one compile. Measured on the lane PC (2026-11-09,
  synthetic random-vocabulary text, the worst case for the topic step; fingerprint + rules + topics,
  median of 5) at 1.93 M chars: 128 docs 0.64 s, 32 docs 0.51 s, 12 docs 0.38 s, 2 docs 0.28 s.
  Above it the compile is skipped with a logged reason, never organized slowly.
*/
export const LIBRARY_ORGANIZE_MAX_TEXT_CHARS = 2_000_000;

/** An unrecognised value is off and says so: a flag that silently read as `on` would be worse. */
export function libraryOrganizeMode(env: Env = process.env): LibraryOrganizeMode {
  const raw = env.TAVONEL_LIBRARY_ORGANIZE_MODE?.trim() ?? "";
  if (raw === "" || raw === "off") return "off";
  if (raw === "shadow" || raw === "on") return raw;
  log("error", { event: "library_organize_misconfigured", code: "TAVONEL_LIBRARY_ORGANIZE_MODE_INVALID" });
  return "off";
}

function log(level: "info" | "error", line: Record<string, string | number>) {
  try {
    console[level](JSON.stringify(line));
  } catch { /* telemetry never breaks a compile */ }
}

type LabelRow = {
  labelKind: "doc_type" | "topic";
  labelKey: string;
  labelSetVersion: string;
  method: string;
  methodVersion: string;
  inputsSha256: string;
  disposition: "proposed" | "abstained";
  abstainReason: string | null;
  internalScore: number | null;
  evidenceIds: string[];
};

const abstained = (base: Omit<LabelRow, "labelKey" | "disposition" | "abstainReason" | "internalScore" | "evidenceIds">,
  reason: string): LabelRow => ({ ...base, labelKey: "", disposition: "abstained", abstainReason: reason, internalScore: null, evidenceIds: [] });

/** The proposer's answer, or an abstention that says why it is not one. Exported for the failure-path tests. */
export async function docTypeLabel(proposer: DocTypeProposer, input: Input, textSha256: string | null): Promise<LabelRow> {
  const base = { labelKind: "doc_type" as const, labelSetVersion: DOC_TYPE_LABEL_SET_VERSION, method: proposer.method,
    methodVersion: proposer.methodVersion, inputsSha256: sha256(`${proposer.methodVersion}\n${textSha256 ?? "no-text"}`) };
  let proposal: DocTypeProposal;
  try {
    proposal = await proposer.propose(input.text, input.regions ?? []);
  } catch {
    return abstained(base, "proposer_unavailable");
  }
  // The answer is untrusted in shape too: a malformed one abstains for this document, never fails the batch.
  try {
    if ("abstain" in proposal) return abstained(base, /^[a-z_]{1,64}$/.test(proposal.abstain) ? proposal.abstain : "proposer_invalid_reason");
    // A model reading hostile text may answer anything: only label set v0 is a label.
    if (!DOC_TYPE_SET.has(proposal.label)) return abstained(base, "label_outside_set");
    if (typeof proposal.score !== "number" || !Number.isFinite(proposal.score) || proposal.score < 0 || proposal.score > 1) {
      return abstained(base, "proposer_invalid_score");
    }
    const regionIds = new Set((input.regions ?? []).map((region) => region.regionId));
    return { ...base, labelKey: proposal.label, disposition: "proposed", abstainReason: null, internalScore: proposal.score,
      evidenceIds: proposal.evidenceIds.filter((id) => typeof id === "string" && regionIds.has(id)).slice(0, 16) };
  } catch {
    return abstained(base, "proposer_invalid_output");
  }
}

type RecordAnswer = { newPairs: { same_text: number; near_duplicate: number; revision_candidate: number }; labelsRecorded: number };

function readRecordAnswer(body: unknown, documents: number): RecordAnswer | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { schemaVersion?: unknown; documents?: unknown; newPairs?: Record<string, unknown>; labelsRecorded?: unknown };
  const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (value.schemaVersion !== "tavonel.library_organize.v1" || value.documents !== documents || !count(value.labelsRecorded)
    || !value.newPairs || typeof value.newPairs !== "object"
    || !count(value.newPairs.same_text) || !count(value.newPairs.near_duplicate) || !count(value.newPairs.revision_candidate)) return null;
  return value as RecordAnswer;
}

function reportIntegrityFault(mode: LibraryOrganizeMode, workspaceKey: string) {
  log("error", { event: "library_organize_integrity_fault", mode, code: "LIBRARY_TEXT_FINGERPRINT_CONFLICT" });
  void deliverOperationsAlert({
    alertId: randomUUID(), kind: "incident", severity: "critical", service: "supabase",
    summary: `Library text fingerprint conflict in ${workspaceKey}: one source version read as two texts (B2a)`,
    observedAt: new Date().toISOString(), runbookUrl: RUNBOOK,
  }).catch(() => undefined);
}

/**
 * Computes and records this compile's proposals. Returns nothing: under every mode the compile is
 * the compile it would have been with the flag off. Never throws.
 */
export async function organizeLibraryAtIntake(
  workspaceKey: string,
  inputs: readonly Input[],
  env: Env = process.env,
  proposer: DocTypeProposer = RULES_DOC_TYPE_V1,
): Promise<void> {
  const mode = libraryOrganizeMode(env);
  if (mode === "off" || inputs.length === 0) return;
  const fail = (code: string) => log("error", { event: "library_organize_failed", mode, code });
  // The methods run before the Core dispatch, so their cost is bounded by input size (review R1-M3).
  // ponytail: a compile above the budget is not organized in shadow; move this to a post-compile worker step to cover it.
  const textChars = inputs.reduce((sum, input) => sum + input.text.length, 0);
  if (textChars > LIBRARY_ORGANIZE_MAX_TEXT_CHARS) {
    return log("error", { event: "library_organize_skipped", mode, code: "LIBRARY_ORGANIZE_SKIPPED_BUDGET", documents: inputs.length, textChars });
  }
  const config = readSupabaseAdminConfig(env);
  if (!config) return fail("LIBRARY_ORGANIZE_STORE_NOT_CONFIGURED");

  let items: unknown[];
  try {
    const fingerprints = inputs.map((input) => textFingerprint(input.text));
    // The topic corpus is this compile's documents; its digest names it, so a re-cluster in another corpus is another row.
    const corpus = sha256(`${TOPIC_METHOD_VERSION}\n${fingerprints.map((fp) => fp?.textSha256 ?? "no-text").sort().join("\n")}`);
    const topics = proposeTopics(inputs.map((input) => input.text));
    const topicBase = { labelKind: "topic" as const, labelSetVersion: TOPIC_LABEL_SET_VERSION, method: TOPIC_METHOD,
      methodVersion: TOPIC_METHOD_VERSION, inputsSha256: corpus };
    items = await Promise.all(inputs.map(async (input, index) => {
      const fingerprint = fingerprints[index]!;
      const topic = topics[index]!;
      const topicRows: LabelRow[] = "abstain" in topic ? [abstained(topicBase, topic.abstain)]
        : topic.terms.map((term) => ({ ...topicBase, labelKey: term.term, disposition: "proposed" as const, abstainReason: null,
          internalScore: term.score, evidenceIds: [] }));
      return {
        documentId: input.documentId.toLowerCase(),
        sourceVersionId: input.versionKey.toLowerCase(),
        sanitizedSha256: input.inputSha256.toLowerCase(),
        textFingerprint: fingerprint ? { textSha256: fingerprint.textSha256, minhash: fingerprint.minhash } : null,
        labels: [await docTypeLabel(proposer, input, fingerprint?.textSha256 ?? null), ...topicRows],
      };
    }));
  } catch {
    return fail("LIBRARY_ORGANIZE_COMPUTE_FAILED");
  }

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/record_library_organize", {
      method: "POST", body: JSON.stringify({ p_workspace_key: workspaceKey, p_items: items }),
    });
  } catch {
    return fail("LIBRARY_ORGANIZE_STORE_UNREACHABLE");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown; code?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : "";
    if (body?.code === "PGRST202" || body?.code === "42883") return fail("LIBRARY_ORGANIZE_MIGRATION_ABSENT");
    if (message.includes("library_text_fingerprint_conflict")) return reportIntegrityFault(mode, workspaceKey);
    if (message.includes("library_organize_time_budget_exceeded") || body?.code === "57014") return fail("LIBRARY_ORGANIZE_STORE_TIME_BUDGET");
    if (message.includes("library_organize_request_invalid") || body?.code === "23514") return fail("LIBRARY_ORGANIZE_REQUEST_INVALID");
    return fail("LIBRARY_ORGANIZE_STORE_FAILED");
  }
  const answer = readRecordAnswer(await response.json().catch(() => null), inputs.length);
  if (!answer) return fail("LIBRARY_ORGANIZE_RESPONSE_INVALID");
  // Counts only, and only what this call added: no workspace, document, label or digest leaves through the log.
  log("info", { event: "library_organize_recorded", mode, documents: inputs.length,
    newSameTextPairs: answer.newPairs.same_text, newNearDuplicatePairs: answer.newPairs.near_duplicate,
    newRevisionCandidatePairs: answer.newPairs.revision_candidate, labelsRecorded: answer.labelsRecorded,
    textFingerprintVersion: TEXT_FINGERPRINT_VERSION });
}

/* ------------------------------------------------------------------------------------------- */
/* The Library data model. Internal and public are separate types, not one type with a filter.  */
/* ------------------------------------------------------------------------------------------- */

type RelationKind = "exact_bytes" | "same_text" | "near_duplicate" | "revision_candidate";
type Decision = "proposed" | "confirmed" | "rejected";

/** INTERNAL. Operators and the knowledge Arena only: carries methods, scores, thresholds and input digests. */
export type LibraryInternalLabel = Readonly<{
  documentId: string; sourceVersionId: string; labelKind: "doc_type" | "topic"; labelKey: string; labelSetVersion: string;
  method: string; methodVersion: string; inputsSha256: string; disposition: "proposed" | "abstained" | "confirmed" | "rejected";
  abstainReason: string | null; internalScore: number | null; evidenceIds: readonly string[]; createdAt: string;
}>;
export type LibraryInternalRelation = Readonly<{
  documentId: string; relatedDocumentId: string; kind: RelationKind; state: Decision; method: string; methodVersion: string;
  internalScore: number | null; internalThreshold: number | null; inputsSha256: string | null; evidence: Readonly<Record<string, unknown>>;
}>;
export type LibraryInternalView = Readonly<{ labels: readonly LibraryInternalLabel[]; relations: readonly LibraryInternalRelation[] }>;

/** PUBLIC. What a Library screen may show. No score, threshold, method, input digest or abstention reason. */
export type LibraryDocumentType = Readonly<{ label: DocType; state: "proposed" | "confirmed" }> | Readonly<{ label: null; state: "abstained" }>;
export type LibraryTopicTag = Readonly<{ label: string; state: "proposed" | "confirmed" }>;
export type LibraryDuplicate = Readonly<{
  relatedDocumentId: string;
  badge: "exact" | "near" | "revision";
  kind: RelationKind;
  state: "proposed" | "confirmed";
  /** The compare view's data: which representation matched, in public words (no method name). */
  evidence: Readonly<{ matchedOn: readonly ("file" | "text" | "text_similarity")[] }>;
}>;
export type LibraryDocument = Readonly<{
  documentId: string;
  documentType: LibraryDocumentType | null;
  topics: readonly LibraryTopicTag[];
  duplicates: readonly LibraryDuplicate[];
}>;

// Internal method names never reach the public DTO: each maps to a neutral word (review R1-M2).
const PUBLIC_MATCHED_ON: Readonly<Record<string, "file" | "text" | "text_similarity">> = {
  sanitized_sha256: "file", source_sha256: "file", normalized_text: "text", text_minhash: "text_similarity",
};
const RELATION_KINDS = new Set<string>(["exact_bytes", "same_text", "near_duplicate", "revision_candidate"]);
const nullableNumber = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));

function readInternalView(body: unknown): LibraryInternalView | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { schemaVersion?: unknown; labels?: unknown; relations?: unknown };
  if (value.schemaVersion !== "tavonel.library_organize_read.v1" || !Array.isArray(value.labels) || !Array.isArray(value.relations)) return null;
  for (const raw of value.labels as Record<string, unknown>[]) {
    if (!raw || typeof raw.documentId !== "string" || !UUID.test(raw.documentId) || (raw.labelKind !== "doc_type" && raw.labelKind !== "topic")
      || typeof raw.labelKey !== "string" || typeof raw.methodVersion !== "string" || typeof raw.inputsSha256 !== "string"
      || !["proposed", "abstained", "confirmed", "rejected"].includes(raw.disposition as string)
      || !nullableNumber(raw.internalScore) || !Array.isArray(raw.evidenceIds) || typeof raw.createdAt !== "string") return null;
  }
  for (const raw of value.relations as Record<string, unknown>[]) {
    if (!raw || typeof raw.documentId !== "string" || !UUID.test(raw.documentId) || typeof raw.relatedDocumentId !== "string"
      || !UUID.test(raw.relatedDocumentId) || !RELATION_KINDS.has(raw.kind as string)
      || !["proposed", "confirmed", "rejected"].includes(raw.state as string) || !nullableNumber(raw.internalScore)
      || !raw.evidence || typeof raw.evidence !== "object") return null;
  }
  return value as unknown as LibraryInternalView;
}

/** The internal rows for up to 128 documents of one workspace. Server-side only. */
export async function readLibraryInternal(workspaceKey: string, documentIds: readonly string[], env: Env = process.env):
  Promise<{ ok: true; view: LibraryInternalView } | { ok: false; code: string }> {
  if (documentIds.length < 1 || documentIds.length > 128 || !documentIds.every((id) => UUID.test(id.toLowerCase()))) {
    return { ok: false, code: "LIBRARY_ORGANIZE_REQUEST_INVALID" };
  }
  const config = readSupabaseAdminConfig(env);
  if (!config) return { ok: false, code: "LIBRARY_ORGANIZE_STORE_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/read_library_organize", {
      method: "POST", body: JSON.stringify({ p_workspace_key: workspaceKey, p_document_ids: documentIds.map((id) => id.toLowerCase()) }),
    });
  } catch {
    return { ok: false, code: "LIBRARY_ORGANIZE_STORE_UNREACHABLE" };
  }
  if (!response.ok) return { ok: false, code: "LIBRARY_ORGANIZE_STORE_FAILED" };
  const view = readInternalView(await response.json().catch(() => null));
  return view ? { ok: true, view } : { ok: false, code: "LIBRARY_ORGANIZE_RESPONSE_INVALID" };
}

/**
 * Internal -> public, field by field. Per document: a person's decision wins; otherwise the
 * production proposer's latest run (its newest inputs digest), so an Arena arm recorded in shadow
 * beside it never shows, and a document re-clustered in another corpus shows its latest topics.
 */
export function toLibraryDocuments(view: LibraryInternalView, documentIds: readonly string[],
  productionDocTypeMethodVersion: string = RULES_DOC_TYPE_V1.methodVersion): LibraryDocument[] {
  const latestRun = (labels: readonly LibraryInternalLabel[]) => {
    const newest = labels.reduce<LibraryInternalLabel | null>((best, label) => (!best || label.createdAt > best.createdAt ? label : best), null);
    return newest ? labels.filter((label) => label.inputsSha256 === newest.inputsSha256) : [];
  };
  return documentIds.map((raw) => {
    const documentId = raw.toLowerCase();
    const mine = view.labels.filter((label) => label.documentId === documentId);
    const types = mine.filter((label) => label.labelKind === "doc_type");
    const confirmedType = types.find((label) => label.disposition === "confirmed" && DOC_TYPE_SET.has(label.labelKey));
    const proposedType = latestRun(types.filter((label) => label.methodVersion === productionDocTypeMethodVersion
      && (label.disposition === "proposed" || label.disposition === "abstained")))[0];
    const documentType: LibraryDocumentType | null = confirmedType ? { label: confirmedType.labelKey as DocType, state: "confirmed" }
      : !proposedType ? null
        : proposedType.disposition === "abstained" || !DOC_TYPE_SET.has(proposedType.labelKey) ? { label: null, state: "abstained" }
          : { label: proposedType.labelKey as DocType, state: "proposed" };
    const topicRows = mine.filter((label) => label.labelKind === "topic");
    const rejected = new Set(topicRows.filter((label) => label.disposition === "rejected").map((label) => label.labelKey));
    const topics = new Map<string, LibraryTopicTag>();
    for (const label of topicRows.filter((row) => row.disposition === "confirmed")) topics.set(label.labelKey, { label: label.labelKey, state: "confirmed" });
    for (const label of latestRun(topicRows.filter((row) => row.disposition === "proposed" || row.disposition === "abstained"))) {
      if (label.disposition === "proposed" && !rejected.has(label.labelKey) && !topics.has(label.labelKey)) {
        topics.set(label.labelKey, { label: label.labelKey, state: "proposed" });
      }
    }
    const duplicates: LibraryDuplicate[] = view.relations
      .filter((relation) => relation.documentId === documentId && relation.state !== "rejected")
      .map((relation) => ({
        relatedDocumentId: relation.relatedDocumentId,
        badge: relation.kind === "exact_bytes" || relation.kind === "same_text" ? "exact" as const
          : relation.kind === "near_duplicate" ? "near" as const : "revision" as const,
        kind: relation.kind,
        state: relation.state as "proposed" | "confirmed",
        evidence: { matchedOn: [...new Set((Array.isArray(relation.evidence.matchedOn) ? relation.evidence.matchedOn : [])
          .map((item) => (typeof item === "string" ? PUBLIC_MATCHED_ON[item] : undefined))
          .filter((item): item is "file" | "text" | "text_similarity" => item !== undefined))] },
      }));
    return { documentId, documentType, topics: [...topics.values()], duplicates };
  });
}

/**
 * The Library DTO for a viewer. Answers only under `on` for a workspace inside an explicitly set
 * processing cohort, and names only documents the viewer may read now (connector ACL, paused and
 * deleted sources excluded): an unreadable requested document is dropped, an unreadable related
 * document is not named.
 */
export async function readLibraryDocuments(workspaceKey: string, documentIds: readonly string[], viewerUserId: string,
  env: Env = process.env): Promise<{ ok: true; documents: LibraryDocument[] } | { ok: false; code: string }> {
  if (libraryOrganizeMode(env) !== "on" || env.TAVONEL_PROCESSING_WORKSPACE_COHORT === undefined
    || processingCohortRefusal(workspaceKey, env) !== null) return { ok: false, code: "LIBRARY_ORGANIZE_NOT_ENABLED" };
  const read = await readLibraryInternal(workspaceKey, documentIds, env);
  if (!read.ok) return read;
  // ponytail: one access check per document (the checker answers all-or-nothing); batch when B4 renders a full Library page.
  const ids = [...new Set([...documentIds.map((id) => id.toLowerCase()), ...read.view.relations.map((relation) => relation.relatedDocumentId)])];
  const readable = new Set((await Promise.all(ids.map(async (id) =>
    (await checkConnectorSourceAccessForViewer(workspaceKey, [id], viewerUserId)).ok ? id : null)))
    .filter((id): id is string => id !== null));
  return {
    ok: true,
    documents: toLibraryDocuments(read.view, documentIds.filter((id) => readable.has(id.toLowerCase())))
      .map((document) => ({ ...document, duplicates: document.duplicates.filter((duplicate) => readable.has(duplicate.relatedDocumentId)) })),
  };
}
