import { AGENT_ACL_SCAN_PAGES, AGENT_CLIENT_KEY, AGENT_LABEL_BATCH_MAX, AGENT_PAGE, type AgentScope } from "./agent-access";
import { agentProposalDocuments, toAgentProposalView, type AgentProposalView } from "./agent-proposal-view";
import { CAPABILITY_MANIFEST_SCHEMA, parseCapabilityManifest } from "./capability-manifest";
import { createProposal, createProposalBatch, getProposal, listProposalsPage, type ProposalActor, type ProposalRow } from "./change-proposals";
import { isRestingCompileState, listWorkspaceCompileJobs, readCompileJob, type CompileJob } from "./compile-job-store";
import { checkConnectorSourceAccessForViewer } from "./connector-source-access";
import { readTombstonedUploadDocumentIds } from "./customer-source-lifecycle";
import { admitsDerivedCustomerData } from "./derived-data-admission";
import type { AgentPrincipal } from "./developer-auth";
import { COLLECTION_ID_PATTERN, groupImmutableDocuments, selectCurrentDocumentVersions } from "./immutable-keys";
import { libraryOrganizeMode, readLibraryDocuments } from "./library-shadow";
import { processingCohortRefusal } from "./processing-workspace-grant";
import { COMPILE_PLAN_MAX_BODY_BYTES } from "./proposal-compile-plan";
import { listImmutableWorkspaceObjects } from "./r2-objects";
import { listFoundationQuarantineRejects, readR2SignerEnv } from "./r2-synthetic-canary";
import { hasCorrectionChild } from "./review-store";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { loadWorldReadModel } from "./world-read-model";
import { getFoundationActiveWorld, listFoundationActiveWorlds } from "./world-store";

/*
  The nine tools of POST /api/agent-mcp (workorders/agent-native.md §3; WO-AN-5): six reads and three proposals.
  No tool decides, confirms, undoes, activates, cancels or revokes. Handlers call the libraries directly; the only
  HTTP re-dispatch is the compile executor's own, which runs when a person confirms, never here.

  Errors leave as one constant agent code (AGENT_ERROR_CODES). Every internal code goes through one table
  (agentCodeOf); a code the table does not name is UNAVAILABLE, and a handler that throws is UNAVAILABLE too, so
  no exception text, store message or internal code ever reaches the agent's model.

  Existence is not disclosed. For every tool that takes an id, the reads that decide whether the id names
  something this person can read run through `deciding`: any failure of them -- refused, unavailable, thrown --
  is NOT_FOUND, whatever the id (readable-but-absent, unreadable, another tenant's, random), because "the reader
  is down" must not tell "absent" from "exists but unreadable" (§3, §17 (a)). A failure after that decision is
  what it is (UNAVAILABLE, or the reused function's own refusal). The propose tools make the same decision here,
  with the same readers, before the executor runs, so an executor's later outage is never mistaken for it.
  Codes leave through the one table only. The security suite fuzzes both sides of that line for every
  id-taking tool, and every id class under every reader outage for byte identity.
*/

// -------------------------------------------------------------------------------------------------------------
// Error codes
// -------------------------------------------------------------------------------------------------------------

/** The constant codes an agent can see (§3), plus the refusals of reused functions that run after the access check. */
export const AGENT_ERROR_CODES = [
  "NOT_FOUND", "INPUT_INVALID", "RATE_LIMITED", "PROPOSAL_OPEN_LIMIT", "IDEMPOTENCY_CONFLICT", "PROPOSAL_QUOTE_OVER_BALANCE",
  "PROPOSAL_BASE_NOT_HEAD", "PATCH_BEFORE_MISMATCH", "PATCH_TARGET_NOT_EDITABLE", "LIBRARY_ORGANIZE_NOT_ENABLED", "WORLD_NOT_ACTIVE",
  "UNAVAILABLE",
  // after the access check: lineage, admission, trial, patch
  "CORPUS_TOO_LARGE", "INTAKE_APPROVAL_COMPILE_SET_INVALID", "INTAKE_PRICE_STALE", "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE",
  "TRIAL_WORLD_LIMIT_REACHED", "PATCH_TARGET_NOT_FOUND", "PATCH_NO_CHANGE", "PATCH_EVIDENCE_NOT_FOUND",
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

/*
  Internal code -> agent code: the one table. Codes the agent layer produces itself map to themselves. Anything
  else -- a store failure, a migration absent, a code added to a library later -- is UNAVAILABLE.
*/
const AGENT_CODE_OF: Readonly<Record<string, AgentErrorCode>> = {
  ...Object.fromEntries(AGENT_ERROR_CODES.map((code) => [code, code])),
  PROPOSAL_TARGET_NOT_FOUND: "NOT_FOUND",
  PROPOSAL_NOT_FOUND: "NOT_FOUND",
  PROPOSAL_REQUEST_INVALID: "INPUT_INVALID",
  PROPOSAL_INPUT_INVALID: "INPUT_INVALID",
  PATCH_LABEL_INVALID: "INPUT_INVALID",
  API_RATE_LIMITED: "RATE_LIMITED",
  PROPOSAL_IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  ACTIVE_WORLD_NOT_FOUND: "WORLD_NOT_ACTIVE",
};
export function agentCodeOf(internal: string): AgentErrorCode {
  return Object.hasOwn(AGENT_CODE_OF, internal) ? AGENT_CODE_OF[internal]! : "UNAVAILABLE";
}

export type AgentToolResult = { ok: true; output: unknown } | { ok: false; code: AgentErrorCode };
type Refusal = { ok: false; code: AgentErrorCode };
const refuse = (code: AgentErrorCode): Refusal => ({ ok: false, code });
const NOT_FOUND = refuse("NOT_FOUND");
const INPUT_INVALID = refuse("INPUT_INVALID");
const UNAVAILABLE = refuse("UNAVAILABLE");

// -------------------------------------------------------------------------------------------------------------
// Input validation: exact keys, bounded strings. No bytes, paths, URLs, SQL, workspace or user fields.
// -------------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JOB_ID = /^cjob-[a-f0-9]{32}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DOCUMENT_CURSOR = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const OFFSET_CURSOR = /^(?:0|[1-9][0-9]{0,5})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_LABEL = 500;
const KINDS = ["Topic", "Entity", "Claim"] as const;
type Kind = (typeof KINDS)[number];

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const label = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= MAX_LABEL && !CONTROL.test(value);

/** The arguments object when it has every required key and nothing but required and optional keys; else null. */
function exact(args: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  const value = args === undefined ? {} : args;
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) return null;
  return required.every((key) => Object.hasOwn(value, key)) ? value : null;
}

// -------------------------------------------------------------------------------------------------------------
// Shared readers
// -------------------------------------------------------------------------------------------------------------

export type AgentToolContext = Readonly<{ principal: AgentPrincipal; request: Request }>;

const actorOf = (principal: AgentPrincipal): ProposalActor => ({
  kind: "agent", workspaceKey: principal.workspaceKey, userId: principal.userId, authorizationRevision: principal.authorizationRevision,
  grantId: principal.grantId, keyId: principal.keyId,
});

/** A read that decides whether an id names something this person can read: a throw is a failure like any other (null). */
async function deciding<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

type Access = "readable" | "denied" | "unavailable";
/** One access call for a set of documents, as the grant's person. A checker that throws cannot answer. */
async function access(principal: AgentPrincipal, documentIds: readonly string[]): Promise<Access> {
  if (documentIds.length === 0) return "denied";
  const checked = await deciding(() => checkConnectorSourceAccessForViewer(principal.workspaceKey, [...documentIds], principal.userId));
  return checked?.ok ? "readable" : checked?.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? "denied" : "unavailable";
}

/** Access per document set, one call per distinct sorted set. */
function accessCache(principal: AgentPrincipal) {
  const cache = new Map<string, Promise<Access>>();
  return (documentIds: readonly string[]) => {
    const key = [...new Set(documentIds)].sort().join("\n");
    let found = cache.get(key);
    if (!found) { found = access(principal, [...new Set(documentIds)]); cache.set(key, found); }
    return found;
  };
}

function view(row: ProposalRow, readable: boolean): AgentProposalView | null {
  return toAgentProposalView(row, readable);
}

// -------------------------------------------------------------------------------------------------------------
// R1 get_workflow_status
// -------------------------------------------------------------------------------------------------------------

const LINKS = { addFiles: "/workspace/sources", connectSource: "/workspace/connections", inbox: "/workspace/changes", agentAccess: "/workspace/developer" } as const;
const JOB_SCAN = 50;

const jobSummary = (job: CompileJob) => ({
  jobId: job.jobId, state: job.state, collectionId: job.collectionId, documentsTotal: job.documentsTotal, documentsReady: job.documentsReady,
  blockedCount: job.blocked.length, resting: isRestingCompileState(job.state),
});

async function getWorkflowStatus({ principal }: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  if (!exact(args, [])) return INPUT_INVALID;
  const worlds = await listFoundationActiveWorlds(principal.workspaceKey, { limit: 25 });
  if (!worlds.ok) return UNAVAILABLE;
  const jobs = await listWorkspaceCompileJobs(principal.workspaceKey, JOB_SCAN);
  if (!jobs.ok) return UNAVAILABLE;
  const check = accessCache(principal);
  // A job naming any document the person cannot read is dropped before the cut and not counted.
  const verdicts = await Promise.all(jobs.value.map((job) => check(job.documentIds)));
  if (verdicts.includes("unavailable")) return UNAVAILABLE;
  const readableJobs = jobs.value.filter((_, index) => verdicts[index] === "readable").slice(0, AGENT_PAGE.jobs);
  // This grant's proposals only, filtered by access before the page is cut (listProposalsPage).
  const proposals = await listProposalsPage(principal, { cursor: null, grantId: principal.grantId });
  if (!proposals.ok) return UNAVAILABLE;
  const views = proposals.rows.filter((row) => row.agent_grant_id === principal.grantId)
    .map((row) => view(row, true)).filter((row): row is AgentProposalView => row !== null).slice(0, AGENT_PAGE.proposals);
  return {
    ok: true,
    output: {
      worlds: worlds.worlds.map((world) => ({ collectionId: world.collectionId, manifestDigest: world.manifestDigest, revision: world.revision })),
      jobs: readableJobs.map(jobSummary),
      proposals: views,
      links: { ...LINKS },
    },
  };
}

// -------------------------------------------------------------------------------------------------------------
// R2 get_proposal
// -------------------------------------------------------------------------------------------------------------

async function getProposalTool({ principal }: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  const input = exact(args, ["proposalId"]);
  if (!input || !text(input.proposalId, UUID)) return INPUT_INVALID;
  const { proposalId } = input;
  const found = await deciding(() => getProposal(principal.workspaceKey, proposalId));
  // Absent, another tenant's, another grant's and a store that cannot answer are one answer.
  if (!found?.ok || found.row.agent_grant_id !== principal.grantId || found.row.workspace_key !== principal.workspaceKey) return NOT_FOUND;
  const documents = agentProposalDocuments(found.row);
  if (!documents) return NOT_FOUND;
  const readable = await access(principal, documents);
  if (readable === "unavailable") return UNAVAILABLE;
  const shown = view(found.row, readable === "readable");
  return shown ? { ok: true, output: shown } : NOT_FOUND;
}

// -------------------------------------------------------------------------------------------------------------
// R3 get_compile_job
// -------------------------------------------------------------------------------------------------------------

async function getCompileJobTool({ principal }: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  const input = exact(args, ["jobId"]);
  if (!input || !text(input.jobId, JOB_ID)) return INPUT_INVALID;
  // The job read and the access check decide the job's existence: any failure of either is the same not-found.
  const { jobId } = input;
  const read = await deciding(() => readCompileJob(principal.workspaceKey, jobId));
  if (!read?.ok) return NOT_FOUND;
  const job = read.value;
  if (job.workspaceKey !== principal.workspaceKey) return NOT_FOUND;
  if (await access(principal, job.documentIds) !== "readable") return NOT_FOUND;
  return {
    ok: true,
    output: {
      jobId: job.jobId, state: job.state, collectionId: job.collectionId, documentsTotal: job.documentsTotal, documentsReady: job.documentsReady,
      blocked: job.blocked.map((blocker) => ({ documentId: blocker.documentId, kind: blocker.kind, reason: blocker.reason })),
      blockedResolution: job.blockedResolution, resting: isRestingCompileState(job.state),
    },
  };
}

// -------------------------------------------------------------------------------------------------------------
// R4 list_candidates / R5 get_candidate_objects
// -------------------------------------------------------------------------------------------------------------

const CANDIDATE_SCAN = 50;
type Candidate = Readonly<{ manifestDigest: string; registeredAt: string; documentIds: readonly string[] }>;

function asCandidates(body: unknown): Candidate[] | null {
  if (!Array.isArray(body)) return null;
  const out: Candidate[] = [];
  for (const row of body as unknown[]) {
    if (!isObject(row) || !text(row.manifestDigest, SHA256) || typeof row.registeredAt !== "string" || !Array.isArray(row.documentIds)
      || row.documentIds.length < 1 || !row.documentIds.every((id) => typeof id === "string" && id.length > 0)) return null;
    out.push({ manifestDigest: row.manifestDigest, registeredAt: row.registeredAt, documentIds: [...row.documentIds as string[]] });
  }
  return out;
}

/**
 * The collection's candidates this person can read, newest first, before any page is cut: the read that decides
 * whether a collection id (and a digest in it) names something readable. A collection with none (absent,
 * another tenant's, unreadable) is NOT_FOUND; so is a listing or an access check that fails in any way. Nothing
 * else is read here: a caller reads the active pointer only after it has decided its own id exists.
 */
async function readableCandidates(principal: AgentPrincipal, collectionId: string): Promise<{ ok: true; candidates: Candidate[] } | Refusal> {
  const listed = await deciding(async () => {
    const config = readSupabaseAdminConfig();
    if (!config) return null;
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/list_collection_candidates", {
      method: "POST", body: JSON.stringify({ p_workspace_key: principal.workspaceKey, p_collection_id: collectionId, p_limit: CANDIDATE_SCAN }),
    });
    return response.ok ? asCandidates(await response.json()) : null;
  });
  if (!listed) return NOT_FOUND;
  const check = accessCache(principal);
  const verdicts = await Promise.all(listed.map((candidate) => check(candidate.documentIds)));
  if (verdicts.includes("unavailable")) return NOT_FOUND;
  const candidates = listed.filter((_, index) => verdicts[index] === "readable");
  return candidates.length === 0 ? NOT_FOUND : { ok: true, candidates };
}

type ActivePointer = { manifestDigest: string; revision: number } | null;
async function activePointer(workspaceKey: string, collectionId: string): Promise<{ ok: true; active: ActivePointer } | Refusal> {
  const active = await getFoundationActiveWorld(workspaceKey, collectionId);
  if (active.ok) return { ok: true, active: { manifestDigest: active.world.manifestDigest, revision: active.world.revision } };
  return active.code === "ACTIVE_WORLD_NOT_FOUND" ? { ok: true, active: null } : UNAVAILABLE;
}

const CANDIDATE_STATE = "candidate — not active";
/** I-26: a digest is shown as active only when it is the active pointer. */
const stateOf = (digest: string, active: ActivePointer) => (active !== null && active.manifestDigest === digest ? "active" : CANDIDATE_STATE);

/** The base a candidate was corrected from (a recorded correction naming it as its result), or null. */
async function correctedFrom(workspaceKey: string, collectionId: string, digest: string): Promise<{ ok: true; from: string | null } | Refusal> {
  const config = readSupabaseAdminConfig();
  if (!config) return UNAVAILABLE;
  const query = new URLSearchParams({
    workspace_key: `eq.${workspaceKey}`, collection_id: `eq.${collectionId}`, resulting_manifest_digest: `eq.${digest}`,
    select: "manifest_digest", order: "created_at.asc", limit: "1",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_review_decisions?${query}`);
    const rows: unknown = response.ok ? await response.json().catch(() => null) : null;
    if (!Array.isArray(rows)) return UNAVAILABLE;
    if (rows.length === 0) return { ok: true, from: null };
    const from = (rows[0] as { manifest_digest?: unknown } | null)?.manifest_digest;
    return text(from, SHA256) ? { ok: true, from } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

async function listCandidatesTool({ principal }: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  const input = exact(args, ["collectionId"]);
  if (!input || !text(input.collectionId, COLLECTION_ID_PATTERN)) return INPUT_INVALID;
  const collectionId = input.collectionId;
  const found = await readableCandidates(principal, collectionId);
  if (!found.ok) return found;
  const page = found.candidates.slice(0, AGENT_PAGE.candidates);
  const lineage = await Promise.all(page.map(async (candidate) => {
    const [child, from] = await Promise.all([
      hasCorrectionChild(principal.workspaceKey, collectionId, candidate.manifestDigest),
      correctedFrom(principal.workspaceKey, collectionId, candidate.manifestDigest),
    ]);
    return child.ok && from.ok ? { leaf: !child.child, from: from.from } : null;
  }));
  if (lineage.includes(null)) return UNAVAILABLE;
  const pointer = await activePointer(principal.workspaceKey, collectionId);
  if (!pointer.ok) return pointer;
  return {
    ok: true,
    output: {
      active: pointer.active,
      candidates: page.map((candidate, index) => ({
        manifestDigest: candidate.manifestDigest, registeredAt: candidate.registeredAt, state: stateOf(candidate.manifestDigest, pointer.active),
        correctedFrom: lineage[index]!.from, correctionLeaf: lineage[index]!.leaf,
      })),
    },
  };
}

async function getCandidateObjectsTool({ principal }: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  const input = exact(args, ["collectionId", "manifestDigest"], ["kind", "cursor"]);
  if (!input || !text(input.collectionId, COLLECTION_ID_PATTERN) || !text(input.manifestDigest, SHA256)
    || (input.kind !== undefined && !(KINDS as readonly unknown[]).includes(input.kind))
    || (input.cursor !== undefined && !text(input.cursor, OFFSET_CURSOR))) return INPUT_INVALID;
  const { collectionId, manifestDigest } = input;
  const found = await readableCandidates(principal, collectionId);
  if (!found.ok) return found;
  const candidate = found.candidates.find((item) => item.manifestDigest === manifestDigest);
  if (!candidate) return NOT_FOUND;
  if (!await admitsDerivedCustomerData(principal.workspaceKey, candidate.documentIds)) return NOT_FOUND;
  const model = await loadWorldReadModel(principal.workspaceKey, collectionId, manifestDigest);
  if (!model.ok) return model.status === 403 || model.status === 404 ? NOT_FOUND : UNAVAILABLE;
  if (model.model.world.manifestDigest !== manifestDigest) return NOT_FOUND;
  const pointer = await activePointer(principal.workspaceKey, collectionId);
  if (!pointer.ok) return pointer;
  const kind = input.kind as Kind | undefined;
  const objects = model.model.objects
    .filter((object) => (KINDS as readonly string[]).includes(object.type) && (kind === undefined || object.type === kind))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // The candidate is immutable (content-addressed by its digest), so an offset into it is a stable cursor.
  const start = input.cursor === undefined ? 0 : Number(input.cursor);
  const page = objects.slice(start, start + AGENT_PAGE.objects);
  const end = start + page.length;
  return {
    ok: true,
    output: {
      state: stateOf(manifestDigest, pointer.active),
      objects: page.map((object) => ({ objectId: object.id, kind: object.type, label: object.label, evidenceIds: object.evidenceRefs.slice(0, 16) })),
      nextCursor: end < objects.length ? String(end) : null,
    },
  };
}

// -------------------------------------------------------------------------------------------------------------
// R6 list_documents
// -------------------------------------------------------------------------------------------------------------

type ListedDocument = Readonly<{ documentId: string; state: string; addedAt: string | null }>;

/**
 * The listing a signed-in person sees (app/api/documents/route.ts), from the same primitives, narrowed to id,
 * state and the time the current sanitized version became durable. Sorted by id.
 */
async function workspaceDocuments(workspaceKey: string): Promise<{ ok: true; documents: ListedDocument[] } | Refusal> {
  const signer = readR2SignerEnv();
  if (!signer) return UNAVAILABLE;
  const listed = await listImmutableWorkspaceObjects(signer, workspaceKey);
  if (!listed.ok) return UNAVAILABLE;
  const tombstoned = await readTombstonedUploadDocumentIds(workspaceKey);
  if (!tombstoned.ok) return UNAVAILABLE;
  const quarantine = await listFoundationQuarantineRejects(signer, workspaceKey);
  // ponytail: a truncated quarantine listing fails the call (no partial flag in R6); page it when a workspace reaches the bound.
  if (!quarantine.ok || quarantine.truncated) return UNAVAILABLE;
  const selected = selectCurrentDocumentVersions(groupImmutableDocuments(workspaceKey, listed.objects));
  const seen = new Set<string>([...tombstoned.ids]);
  const out: ListedDocument[] = [];
  const add = (documentId: string, state: string, addedAt: string | null) => {
    const key = documentId.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ documentId, state, addedAt });
  };
  for (const document of selected.documents) add(document.documentId, document.processingState, document.sanitizedObservedAt ?? null);
  // An ambiguous current version is listed for operator review and has no sanitized time (ambiguousPipelineDocument).
  for (const documentId of selected.ambiguousDocumentIds) add(documentId, "operator_review", null);
  for (const documentId of quarantine.documentIds) add(documentId, "refused", null);
  for (const documentId of quarantine.storedDocumentIds) add(documentId, "stored", null);
  out.sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0));
  return { ok: true, documents: out };
}

async function listDocumentsTool({ principal }: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  const input = exact(args, [], ["cursor"]);
  if (!input || (input.cursor !== undefined && !text(input.cursor, DOCUMENT_CURSOR))) return INPUT_INVALID;
  const cursor = input.cursor as string | undefined;
  const listed = await workspaceDocuments(principal.workspaceKey);
  if (!listed.ok) return listed;
  const after = cursor === undefined ? listed.documents : listed.documents.filter((document) => document.documentId > cursor);
  const size = AGENT_PAGE.documents;
  const page: ListedDocument[] = [];
  let consumed = 0;
  // ACL before paging: one call for a window; when it is denied, one call per id. Unreadable ids are neither listed nor counted.
  for (let window = 0; window < AGENT_ACL_SCAN_PAGES && consumed < after.length && page.length < size; window += 1) {
    const slice = after.slice(consumed, consumed + size);
    const whole = await access(principal, slice.map((document) => document.documentId));
    if (whole === "unavailable") return UNAVAILABLE;
    const verdicts = whole === "readable" ? slice.map(() => "readable" as Access)
      : await Promise.all(slice.map((document) => access(principal, [document.documentId])));
    if (verdicts.includes("unavailable")) return UNAVAILABLE;
    for (const [index, document] of slice.entries()) {
      consumed += 1;
      if (verdicts[index] === "readable") page.push(document);
      if (page.length === size) break;
    }
  }
  const last = consumed > 0 ? after[consumed - 1]!.documentId : null;
  return {
    ok: true,
    output: {
      documents: page.map((document) => ({ documentId: document.documentId, state: document.state, addedAt: document.addedAt })),
      nextCursor: consumed < after.length ? last : null,
    },
  };
}

// -------------------------------------------------------------------------------------------------------------
// P1 propose_compile / P3 propose_library_labels / P4 propose_label_correction
// -------------------------------------------------------------------------------------------------------------

const clientKey = (value: unknown): value is string => text(value, AGENT_CLIENT_KEY);

/** The single-row answer of a propose tool. */
function proposed(created: Awaited<ReturnType<typeof createProposal>>): AgentToolResult {
  if (!created.ok) return refuse(agentCodeOf(created.code));
  const shown = view(created.row, true);
  return shown ? { ok: true, output: shown } : UNAVAILABLE;
}

async function proposeCompile({ principal }: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  const input = exact(args, ["documentIds", "idempotencyKey"]);
  if (!input || !clientKey(input.idempotencyKey) || !Array.isArray(input.documentIds) || input.documentIds.length < 1
    || !input.documentIds.every((id) => text(id, UUID)) || new Set(input.documentIds).size !== input.documentIds.length
    || Buffer.byteLength(JSON.stringify({ documentIds: input.documentIds }), "utf8") > COMPILE_PLAN_MAX_BODY_BYTES) return INPUT_INVALID;
  const created = await createProposal(actorOf(principal), {
    actionType: "compile_plan", raw: { documentIds: input.documentIds }, evidenceIds: undefined, clientKey: input.idempotencyKey,
    toolName: "propose_compile", index: 0,
  });
  // The dry-run folds a failure of its own existence-deciding reads into not-found (§17 (a)); nothing is folded here.
  return proposed(created);
}

/** The Library answers only under `on` for a workspace inside an explicitly set processing cohort (library-shadow.ts). */
function libraryOrganizeEnabled(workspaceKey: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return libraryOrganizeMode(env) === "on" && env.TAVONEL_PROCESSING_WORKSPACE_COHORT !== undefined && processingCohortRefusal(workspaceKey, env) === null;
}

const LABEL_ITEM_KEYS = ["documentId", "labelKind", "labelKey", "decision"] as const;

async function proposeLibraryLabels({ principal }: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  const input = exact(args, ["collectionId", "expectedManifestDigest", "items", "idempotencyKey"]);
  if (!input || !text(input.collectionId, COLLECTION_ID_PATTERN) || !text(input.expectedManifestDigest, SHA256) || !clientKey(input.idempotencyKey)
    || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > AGENT_LABEL_BATCH_MAX) return INPUT_INVALID;
  const items = input.items.map((item: unknown) => exact(item, LABEL_ITEM_KEYS));
  if (items.some((item) => item === null || !text(item.documentId, UUID) || (item.labelKind !== "doc_type" && item.labelKind !== "topic")
    || typeof item.labelKey !== "string" || item.labelKey.length < 1 || item.labelKey.length > 64 || CONTROL.test(item.labelKey)
    || (item.decision !== "confirmed" && item.decision !== "rejected"))) return INPUT_INVALID;
  // Checked before any per-document check: with the Library off nothing is read.
  if (!libraryOrganizeEnabled(principal.workspaceKey)) return refuse("LIBRARY_ORGANIZE_NOT_ENABLED");
  const { collectionId, expectedManifestDigest, idempotencyKey } = input;
  // The existence decision: every item names a document this person can read that the Library has a labelled
  // version of. The executor repeats it; deciding it here first keeps an outage of these reads a not-found.
  const documentIds = [...new Set((items as Record<string, unknown>[]).map((item) => item.documentId as string))];
  if (await access(principal, documentIds) !== "readable") return NOT_FOUND;
  const library = await deciding(() => readLibraryDocuments(principal.workspaceKey, documentIds, principal.userId));
  if (!library?.ok || documentIds.some((id) => !Object.hasOwn(library.sourceVersions, id))) return NOT_FOUND;
  const created = await createProposalBatch(actorOf(principal), (items as Record<string, unknown>[]).map((item) => ({
    actionType: "library_label",
    raw: { collectionId, expectedManifestDigest, input: { documentId: item.documentId, labelKind: item.labelKind, labelKey: item.labelKey, decision: item.decision } },
    evidenceIds: undefined, clientKey: idempotencyKey, toolName: "propose_library_labels",
  })));
  if (!created.ok) return refuse(agentCodeOf(created.code));
  const views = created.created.map(({ row }) => view(row, true));
  return views.every((row) => row !== null) ? { ok: true, output: views } : UNAVAILABLE;
}

async function proposeLabelCorrection({ principal }: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  const input = exact(args, ["collectionId", "baseManifestDigest", "objectId", "before", "after", "evidenceId", "idempotencyKey"]);
  if (!input || !text(input.collectionId, COLLECTION_ID_PATTERN) || !text(input.baseManifestDigest, SHA256) || !text(input.objectId, OBJECT_ID)
    || !label(input.before) || !label(input.after) || !text(input.evidenceId, OBJECT_ID) || !clientKey(input.idempotencyKey)) return INPUT_INVALID;
  const { idempotencyKey, ...raw } = input;
  // The existence decision, as R5 makes it: the base is a candidate of the collection this person can read.
  const found = await readableCandidates(principal, input.collectionId);
  if (!found.ok) return found;
  if (!found.candidates.some((candidate) => candidate.manifestDigest === input.baseManifestDigest)) return NOT_FOUND;
  const created = await createProposal(actorOf(principal), {
    actionType: "ontology_label_patch", raw, evidenceIds: undefined, clientKey: idempotencyKey as string, toolName: "propose_label_correction", index: 0,
  });
  return proposed(created);
}

// -------------------------------------------------------------------------------------------------------------
// The table
// -------------------------------------------------------------------------------------------------------------

type Schema = Readonly<Record<string, unknown>>;
const object = (properties: Record<string, Schema>, required: readonly string[] = []): Schema =>
  ({ type: "object", properties, required: [...required], additionalProperties: false });
const uuid: Schema = { type: "string", pattern: UUID.source };
const digest: Schema = { type: "string", pattern: SHA256.source };
const collection: Schema = { type: "string", pattern: COLLECTION_ID_PATTERN.source };
const clientKeySchema: Schema = { type: "string", pattern: AGENT_CLIENT_KEY.source };
const labelText: Schema = { type: "string", minLength: 1, maxLength: MAX_LABEL };

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const PROPOSE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export type AgentTool = Readonly<{
  name: string;
  mode: "read" | "propose";
  scope: AgentScope;
  proposalActionType?: string;
  description: string;
  inputSchema: Schema;
  annotations: typeof READ | typeof PROPOSE;
  handler: (context: AgentToolContext, args: unknown) => Promise<AgentToolResult>;
}>;

export const AGENT_MCP_TOOLS: readonly AgentTool[] = [
  { name: "get_workflow_status", mode: "read", scope: "agent:read", annotations: READ, handler: getWorkflowStatus,
    description: "Active Worlds, readable compile jobs, this connection's own proposals and the app links.", inputSchema: object({}) },
  { name: "get_proposal", mode: "read", scope: "agent:read", annotations: READ, handler: getProposalTool,
    description: "One of this connection's proposals, with its signed receipt once it ran.", inputSchema: object({ proposalId: uuid }, ["proposalId"]) },
  { name: "get_compile_job", mode: "read", scope: "agent:read", annotations: READ, handler: getCompileJobTool,
    description: "One compile job: state, exact counts, blockers.",
    inputSchema: object({ jobId: { type: "string", pattern: JOB_ID.source } }, ["jobId"]) },
  { name: "list_candidates", mode: "read", scope: "agent:read", annotations: READ, handler: listCandidatesTool,
    description: "The collection's candidates, newest first; a candidate is not active unless it says so.",
    inputSchema: object({ collectionId: collection }, ["collectionId"]) },
  { name: "get_candidate_objects", mode: "read", scope: "agent:read", annotations: READ, handler: getCandidateObjectsTool,
    description: "Topics, entities and claims of one candidate, with their evidence ids.",
    inputSchema: object({ collectionId: collection, manifestDigest: digest, kind: { type: "string", enum: [...KINDS] },
      cursor: { type: "string", maxLength: 64 } }, ["collectionId", "manifestDigest"]) },
  { name: "list_documents", mode: "read", scope: "agent:read", annotations: READ, handler: listDocumentsTool,
    description: "Your documents: id, state and when the current version was added.",
    inputSchema: object({ cursor: { type: "string", maxLength: 64 } }) },
  { name: "propose_compile", mode: "propose", scope: "agent:propose", proposalActionType: "compile_plan", annotations: PROPOSE, handler: proposeCompile,
    description: "Suggest compiling these documents. Nothing starts until a person confirms it in a signed-in TAVONEL session.",
    inputSchema: object({ documentIds: { type: "array", items: uuid, minItems: 1, uniqueItems: true }, idempotencyKey: clientKeySchema }, ["documentIds", "idempotencyKey"]) },
  { name: "propose_library_labels", mode: "propose", scope: "agent:propose", proposalActionType: "library_label", annotations: PROPOSE,
    handler: proposeLibraryLabels,
    description: "Suggest library labels for documents of a collection with an Active World. Each waits for a person to confirm.",
    inputSchema: object({
      collectionId: collection, expectedManifestDigest: digest, idempotencyKey: clientKeySchema,
      items: { type: "array", minItems: 1, maxItems: AGENT_LABEL_BATCH_MAX, items: object({
        documentId: uuid, labelKind: { type: "string", enum: ["doc_type", "topic"] }, labelKey: { type: "string", minLength: 1, maxLength: 64 },
        decision: { type: "string", enum: ["confirmed", "rejected"] },
      }, LABEL_ITEM_KEYS) },
    }, ["collectionId", "expectedManifestDigest", "items", "idempotencyKey"]) },
  { name: "propose_label_correction", mode: "propose", scope: "agent:propose", proposalActionType: "ontology_label_patch", annotations: PROPOSE,
    handler: proposeLabelCorrection,
    description: "Suggest correcting one label of a candidate. A confirmed correction makes a new candidate; Active is untouched.",
    inputSchema: object({
      collectionId: collection, baseManifestDigest: digest, objectId: { type: "string", pattern: OBJECT_ID.source }, before: labelText, after: labelText,
      evidenceId: { type: "string", pattern: OBJECT_ID.source }, idempotencyKey: clientKeySchema,
    }, ["collectionId", "baseManifestDigest", "objectId", "before", "after", "evidenceId", "idempotencyKey"]) },
];

/** The table as a capability manifest: read/propose modes only, known action types, no duplicates. */
export function agentToolManifest(tools: readonly AgentTool[] = AGENT_MCP_TOOLS) {
  return {
    schemaVersion: CAPABILITY_MANIFEST_SCHEMA, manifestId: "tavonel-agent-mcp-v1",
    issuedAt: "2026-11-17T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    tools: tools.map((tool) => ({ name: tool.name, mode: tool.mode, scope: tool.scope,
      ...(tool.proposalActionType !== undefined ? { proposalActionType: tool.proposalActionType } : {}) })),
  };
}

/** Throws when the table is not a valid capability manifest; run at module load. */
export function assertAgentToolTable(tools: readonly AgentTool[] = AGENT_MCP_TOOLS): void {
  const parsed = parseCapabilityManifest(agentToolManifest(tools));
  if (!parsed.ok) throw new Error(`agent_mcp_tool_table_invalid:${parsed.reason}`);
}
assertAgentToolTable();

const BY_NAME = new Map(AGENT_MCP_TOOLS.map((tool) => [tool.name, tool]));
export const agentTool = (name: unknown): AgentTool | null => (typeof name === "string" ? BY_NAME.get(name) ?? null : null);

/** tools/list: what an MCP client sees of each tool. */
export const agentToolList = () => AGENT_MCP_TOOLS.map((tool) => ({
  name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: { ...tool.annotations },
}));

/** Runs one tool. Never throws: a handler that throws is UNAVAILABLE, and every refusal is an agent code. */
export async function callAgentTool(tool: AgentTool, context: AgentToolContext, args: unknown): Promise<AgentToolResult> {
  try {
    const result = await tool.handler(context, args);
    return result.ok ? result : refuse(agentCodeOf(result.code));
  } catch {
    return UNAVAILABLE;
  }
}
