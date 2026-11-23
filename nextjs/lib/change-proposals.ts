import { createHash } from "node:crypto";
import {
  AGENT_ACL_SCAN_PAGES, AGENT_LABEL_BATCH_MAX, AGENT_OPEN_PROPOSALS_PER_PERSON, PROPOSAL_RESUME_AFTER_MS,
  agentProposalsEnabled, deriveAgentIdempotencyKey,
} from "./agent-access";
import { ACTION_RECEIPT_SCHEMA, readActionReceiptSigner, signActionReceipt } from "./action-receipt-signing";
import { canonicalJson } from "./change-notify";
import { checkConnectorSourceAccessForViewer } from "./connector-source-access";
import { requireFoundationSession, revalidateFoundationSession, type FoundationPrincipal } from "./developer-auth";
import type { ExportSigner } from "./export-signing";
import { COLLECTION_ID_PATTERN } from "./immutable-keys";
import { INTAKE_APPROVAL_ROLLOUT_ENABLED } from "./intake-approval-rollout";
import { DOC_TYPES } from "./library-methods";
import { decideLibraryLabel, readLibraryDocuments } from "./library-shadow";
import { compilePlanExecutor, type CompilePlanInput } from "./proposal-compile-plan";
import { labelCorrectionExecutor, type LabelPatchInput } from "./proposal-label-correction";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { getFoundationActiveWorld } from "./world-store";

/*
  Change proposals (WO-D30-2, D30 M9-03, U37, S29; agent proposals WO-AN-2, workorders/agent-native.md §4.1, §6, §7).
  A proposal is a request for a change to the World, kept for a person to confirm or reject. Creating one
  mutates nothing: the preview is the change it would make. A confirmation executes it once, through the
  executor of its action type, and records the outcome; an Undo issues the opposite decision and records that.
  The store is supabase/migrations/20261116130100_world_change_proposals.sql as extended by
  20261117130000_agent_proposals.sql. Deciding is session only; an agent can only propose.

  Every action type is one registry entry (PROPOSAL_EXECUTORS). A row whose type has no entry, whose input
  does not parse, or that names a document the viewer cannot read now is hidden from every list and is
  refused for confirm and undo.
*/

export const PROPOSAL_ACTION_TYPES = ["library_label", "compile_plan", "ontology_label_patch"] as const;
export type ProposalActionType = (typeof PROPOSAL_ACTION_TYPES)[number];
export const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PROPOSAL_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_BODY_BYTES = 8_192;
const LIST_LIMIT = 50;

/** The WO-D23-4 decision body minus its idempotency key; the proposal id is the key when it executes. */
export type LibraryLabelInput = Readonly<{
  documentId: string; sourceVersionId: string; labelKind: "doc_type" | "topic"; labelKey: string; decision: "confirmed" | "rejected";
}>;

/** Preview shapes, fixed here (§7); WO-AN-4 produces exactly the two that have no executor yet. */
export type CompilePlanPreview = Readonly<{
  documentIds: readonly string[]; documentsTotal: number; corpus: boolean; parts: number;
  quote: Readonly<{ rechargeCredits: number; balanceRechargeCredits: number; overageCredits: number }>;
}>;
export type OntologyLabelPatchPreview = Readonly<{
  collectionId: string; baseManifestDigest: string; objectId: string; kind: "Topic" | "Entity" | "Claim"; before: string; after: string; evidenceId: string;
}>;
type PreviewShapes = { library_label: LibraryLabelInput; compile_plan: CompilePlanPreview; ontology_label_patch: OntologyLabelPatchPreview };
/** The stored input of each type; for the two WO-AN-4 types it carries more than the preview (§4.2). */
type InputShapes = { library_label: LibraryLabelInput; compile_plan: CompilePlanInput; ontology_label_patch: LabelPatchInput };

const ownKeys = (value: object) => Object.keys(value).sort().join(",");
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const INPUT_KEYS = ownKeys({ documentId: 0, sourceVersionId: 0, labelKind: 0, labelKey: 0, decision: 0 });
const AGENT_INPUT_KEYS = ownKeys({ documentId: 0, labelKind: 0, labelKey: 0, decision: 0 });

function parseLibraryLabelInput(raw: unknown): LibraryLabelInput | null {
  if (!isObject(raw) || ownKeys(raw) !== INPUT_KEYS) return null;
  const { documentId, sourceVersionId, labelKind, labelKey, decision } = raw;
  if (typeof documentId !== "string" || !UUID.test(documentId) || typeof sourceVersionId !== "string" || !/^[a-f0-9]{64}$/.test(sourceVersionId)
    || (labelKind !== "doc_type" && labelKind !== "topic") || (decision !== "confirmed" && decision !== "rejected")
    || typeof labelKey !== "string" || labelKey.length < 1 || labelKey.length > 64 || CONTROL.test(labelKey)
    || (labelKind === "doc_type" && !(DOC_TYPES as readonly string[]).includes(labelKey))) return null;
  return { documentId, sourceVersionId, labelKind, labelKey, decision };
}

export function proposalInputDigest(input: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(input)).digest("hex")}`;
}

/** What a confirming client must send back: proof it rendered this proposal's preview (§6). */
export function proposalPreviewDigest(proposalId: string, actionType: string, preview: unknown): string {
  return proposalInputDigest({ proposalId, actionType, preview });
}

/** Evidence ids a proposal cites: at most 16 short strings; null when the field is malformed. */
export function parseEvidenceIds(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 16) return null;
  return raw.every((id) => typeof id === "string" && id.length >= 1 && id.length <= 128 && !CONTROL.test(id)) ? [...raw as string[]] : null;
}

export const PROPOSAL_STATES = ["proposed", "confirmed", "rejected", "expired", "stale", "executed", "failed", "undone", "withdrawn"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];
export type BindingKind = "active_manifest" | "source_inventory" | "correction_leaf";

/** A row of world_change_proposals as the RPCs return it (`to_jsonb`, plus the grant fields). Internal: never sent to a client. */
export type ProposalRow = Readonly<{
  proposal_id: string; workspace_key: string; collection_id: string | null; action_type: string; input: unknown; input_sha256: string;
  evidence_ids: string[]; state: ProposalState; expires_at: string; created_at: string; decided_at: string | null;
  binding_kind: string; principal_kind: string; principal_id: string; agent_grant_id: string | null; decided_by: string | null;
  expected_manifest_digest: string; idempotency_key: string; receipt: unknown;
  agent_client_label: string | null; agent_grantor_email: string | null;
}>;

export type ProposalProposer = { kind: "person" } | { kind: "agent"; grantedBy: string; clientLabel: string; clientLabelVerified: false };
type PublicCommon = Readonly<{
  proposalId: string; state: ProposalState; collectionId: string | null; previewDigest: string | null; resumable: boolean;
  evidenceIds: string[]; expiresAt: string; createdAt: string; decidedAt: string | null; proposer: ProposalProposer; notes: readonly "approver_only"[];
}>;
/** What a signed-in browser sees: a union discriminated by actionType. Never digests of the input, principals, grants or keys. */
export type PublicProposal = { [K in keyof PreviewShapes]: PublicCommon & Readonly<{ actionType: K; preview: PreviewShapes[K] | null }> }[keyof PreviewShapes];

/*
  The store's answer is checked field by field. The grant fields come only from get/page (`withGrant`); the
  collection list and the write RPCs return the bare row, so they are null there and an agent row is read again.
*/
function asRow(value: unknown, withGrant: boolean): ProposalRow | null {
  if (!isObject(value)) return null;
  const row = value;
  const text = (key: string) => typeof row[key] === "string";
  const textOrNull = (key: string) => row[key] === null || text(key);
  const agent = row.principal_kind === "agent";
  const ok = text("proposal_id") && text("workspace_key") && textOrNull("collection_id") && text("action_type") && text("input_sha256")
    && text("expires_at") && text("created_at") && textOrNull("decided_at") && text("binding_kind") && text("principal_kind")
    && text("principal_id") && textOrNull("agent_grant_id") && agent === text("agent_grant_id") && textOrNull("decided_by")
    && text("expected_manifest_digest") && text("idempotency_key") && row.receipt !== undefined
    && PROPOSAL_STATES.includes(row.state as ProposalState) && Array.isArray(row.evidence_ids) && row.input !== undefined
    && (!withGrant || ((agent ? text("agent_client_label") : row.agent_client_label === null) && textOrNull("agent_grantor_email")));
  return ok ? { ...row, agent_client_label: withGrant ? row.agent_client_label : null,
    agent_grantor_email: withGrant ? row.agent_grantor_email : null } as ProposalRow : null;
}

/** A row the store answered after a write: the grant fields are carried over from the row read by id. */
const withGrantOf = (next: ProposalRow, read: ProposalRow): ProposalRow =>
  ({ ...next, agent_client_label: read.agent_client_label, agent_grantor_email: read.agent_grantor_email });

export type Failure = { ok: false; code: string; status: number };
const failure = (code: string, status: number): Failure => ({ ok: false, code, status });

const RPC_ERRORS: ReadonlyArray<readonly [string, string, number]> = [
  ["proposal_request_invalid", "PROPOSAL_REQUEST_INVALID", 400],
  ["proposal_idempotency_conflict", "PROPOSAL_IDEMPOTENCY_CONFLICT", 409],
  ["proposal_not_found", "PROPOSAL_NOT_FOUND", 404],
  ["proposal_not_decidable", "PROPOSAL_NOT_DECIDABLE", 409],
  ["proposal_transition_illegal", "PROPOSAL_TRANSITION_ILLEGAL", 409],
  ["proposal_agent_grant_revoked", "PROPOSAL_AGENT_GRANT_REVOKED", 409],
  ["proposal_open_limit", "PROPOSAL_OPEN_LIMIT", 429],
];

/** One store RPC. Every error becomes a coded Failure; nothing throws. */
async function rpc(name: string, body: Record<string, unknown>): Promise<{ ok: true; body: unknown } | Failure> {
  const config = readSupabaseAdminConfig();
  if (!config) return failure("PROPOSAL_STORE_NOT_CONFIGURED", 503);
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  } catch {
    return failure("PROPOSAL_STORE_UNREACHABLE", 503);
  }
  const parsed = await response.json().catch(() => null) as { message?: unknown; code?: unknown } | null;
  if (!response.ok) {
    if (parsed?.code === "PGRST202" || parsed?.code === "42883") return failure("PROPOSAL_STORE_MIGRATION_ABSENT", 503);
    const message = typeof parsed?.message === "string" ? parsed.message : "";
    const known = RPC_ERRORS.find(([marker]) => message.includes(marker));
    return known ? failure(known[1], known[2]) : failure("PROPOSAL_STORE_FAILED", 503);
  }
  return { ok: true, body: parsed };
}

async function rpcRow(name: string, body: Record<string, unknown>, options: { withGrant?: boolean; pick?: (value: unknown) => unknown } = {}):
  Promise<{ ok: true; row: ProposalRow; body: unknown } | Failure> {
  const answered = await rpc(name, body);
  if (!answered.ok) return answered;
  const row = asRow(options.pick ? options.pick(answered.body) : answered.body, options.withGrant === true);
  return row ? { ok: true, row, body: answered.body } : failure("PROPOSAL_STORE_RESPONSE_INVALID", 503);
}

async function rpcRows(name: string, body: Record<string, unknown>, withGrant: boolean): Promise<{ ok: true; rows: ProposalRow[] } | Failure> {
  const answered = await rpc(name, body);
  if (!answered.ok) return answered;
  const rows = Array.isArray(answered.body) ? answered.body.map((value) => asRow(value, withGrant)) : null;
  return rows && rows.every((row) => row !== null) ? { ok: true, rows: rows as ProposalRow[] } : failure("PROPOSAL_STORE_RESPONSE_INVALID", 503);
}

/** The proposal by id inside the workspace (§5.5): absent, foreign and malformed ids are the same 404. */
export async function getProposal(workspaceKey: string, proposalId: string): Promise<{ ok: true; row: ProposalRow } | Failure> {
  if (!UUID.test(proposalId)) return failure("PROPOSAL_NOT_FOUND", 404);
  return rpcRow("get_world_change_proposal", { p_workspace_key: workspaceKey, p_proposal_id: proposalId }, { withGrant: true });
}

/** The newest proposals of one collection (today's list). Agent rows are read again by id for the grant fields the list lacks. */
export async function listProposals(workspaceKey: string, collectionId: string): Promise<{ ok: true; rows: ProposalRow[] } | Failure> {
  const listed = await rpcRows("list_world_change_proposals", { p_workspace_key: workspaceKey, p_collection_id: collectionId, p_limit: LIST_LIMIT }, false);
  if (!listed.ok) return listed;
  const rows = await Promise.all(listed.rows.map(async (row) => row.principal_kind === "agent" ? getProposal(workspaceKey, row.proposal_id) : { ok: true as const, row }));
  const failed = rows.find((answer) => !answer.ok);
  return failed && !failed.ok ? failed : { ok: true, rows: rows.map((answer) => (answer as { row: ProposalRow }).row) };
}

type Principal = Readonly<FoundationPrincipal>;

/** Who proposes: a signed-in person, or an agent acting for the person who made its grant. */
export type ProposalActor = Readonly<{
  workspaceKey: string; userId: string; authorizationRevision: number; accessSource?: FoundationPrincipal["accessSource"];
} & ({ kind: "session" } | { kind: "agent"; grantId: string; keyId: string })>;

export const sessionActor = (principal: Principal): ProposalActor => ({
  kind: "session", workspaceKey: principal.workspaceKey, userId: principal.userId,
  authorizationRevision: principal.authorizationRevision, accessSource: principal.accessSource,
});

/** Proposals are decided by a person: a session, never an API key, whatever its scopes. */
export async function requireProposalSession(request: Request): Promise<{ ok: true; principal: Principal } | Failure> {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return failure(auth.code, auth.status);
  return auth.principal.kind === "session" ? { ok: true, principal: auth.principal } : failure("PROPOSAL_SESSION_REQUIRED", 403);
}

/** A JSON object body of at most MAX_BODY_BYTES; null for anything else. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text().catch(() => null);
  if (raw === null || raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The viewer must be able to read every document now, in one call; a lost source access is a refusal, never an execution. */
async function checkDocuments(actor: Pick<ProposalActor, "workspaceKey" | "userId">, documentIds: readonly string[]): Promise<Failure | null> {
  if (documentIds.length === 0) return failure("PROPOSAL_INPUT_INVALID", 400);
  const access = await checkConnectorSourceAccessForViewer(actor.workspaceKey, [...documentIds], actor.userId);
  return access.ok ? null : failure(access.code, access.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503);
}

async function activeManifestDigest(workspaceKey: string, collectionId: string | null): Promise<{ ok: true; digest: string } | Failure> {
  if (collectionId === null) return failure("PROPOSAL_INPUT_INVALID", 400);
  const active = await getFoundationActiveWorld(workspaceKey, collectionId);
  if (active.ok) return { ok: true, digest: active.world.manifestDigest };
  return failure(active.code, active.code === "ACTIVE_WORLD_NOT_FOUND" ? 404 : 503);
}

// ---------------------------------------------------------------------------------------------------------
// Registry (§4.1): every type supplies every member; nothing has a default.
// ---------------------------------------------------------------------------------------------------------

export type ExecOk = { ok: true } & Readonly<Record<string, unknown>>;
export type ExecResult = ExecOk | Failure;
export type ExecContext<I> = Readonly<{ request: Request; actor: ProposalActor; row: ProposalRow; input: I }>;
export type Prepared<I> = { ok: true; input: I; collectionId: string | null; bindingDigest: string; evidenceIds: string[] };

/* Method syntax on purpose: an entry for one input type is stored in the string-keyed registry. */
export type ProposalExecutor<I> = {
  /** The stored input; unknown keys refused. */
  parse(raw: unknown): I | null;
  /** Every document the change touches; [] is invalid and hides the row. */
  documentsOf(input: I): string[];
  /** A pure projection of the stored input. */
  previewOf(input: I): object;
  readonly bindingKind: BindingKind;
  /** The creation dry-run: access first. Writes nothing. */
  prepare(actor: ProposalActor, raw: unknown, evidenceIds: string[]): Promise<Prepared<I> | Failure>;
  currentBinding(actor: ProposalActor, row: ProposalRow, input: I): Promise<{ ok: true; digest: string } | Failure>;
  /** Checked before the decision; never mutates. */
  preconditions(actor: ProposalActor, row: ProposalRow, input: I): Promise<Failure | null>;
  /** Idempotent by proposal id. */
  run(ctx: ExecContext<I>): Promise<ExecResult>;
  /** Absent: PROPOSAL_NOT_UNDOABLE. */
  undo?(ctx: ExecContext<I>): Promise<ExecResult>;
  /** What the signed receipt names. */
  resultRef(result: ExecOk): Record<string, unknown>;
};

const libraryLabel: ProposalExecutor<LibraryLabelInput> = {
  parse: parseLibraryLabelInput,
  documentsOf: (input) => [input.documentId],
  previewOf: (input) => input,
  bindingKind: "active_manifest",
  /*
    Raw: {collectionId, input, expectedManifestDigest?}. A person names the source version; an agent cannot
    (no reader gives it one), so for an agent it is filled from the Library's newest labelled version.
    For an agent, every failure before or at the access check is the same not-found.
  */
  async prepare(actor, raw, evidenceIds) {
    if (!isObject(raw) || Object.keys(raw).some((key) => !["collectionId", "input", "expectedManifestDigest"].includes(key))) return failure("PROPOSAL_REQUEST_INVALID", 400);
    const { collectionId, input, expectedManifestDigest } = raw;
    if (typeof collectionId !== "string" || !COLLECTION_ID_PATTERN.test(collectionId)
      || (expectedManifestDigest !== undefined && (typeof expectedManifestDigest !== "string" || !SHA256.test(expectedManifestDigest)))) {
      return failure("PROPOSAL_REQUEST_INVALID", 400);
    }
    const agent = actor.kind === "agent";
    const shaped = agent
      ? isObject(input) && ownKeys(input) === AGENT_INPUT_KEYS ? parseLibraryLabelInput({ ...input, sourceVersionId: "0".repeat(64) }) : null
      : parseLibraryLabelInput(input);
    if (!shaped) return failure("PROPOSAL_REQUEST_INVALID", 400);
    const denied = await checkDocuments(actor, [shaped.documentId]);
    if (denied) return agent ? failure("PROPOSAL_TARGET_NOT_FOUND", 404) : denied;
    let parsed: LibraryLabelInput = shaped;
    if (agent) {
      const library = await readLibraryDocuments(actor.workspaceKey, [shaped.documentId], actor.userId);
      if (!library.ok) return failure(library.code, library.code === "LIBRARY_ORGANIZE_NOT_ENABLED" ? 404 : 503);
      const sourceVersionId = library.sourceVersions[shaped.documentId];
      if (!sourceVersionId) return failure("PROPOSAL_TARGET_NOT_FOUND", 404);
      const filled = parseLibraryLabelInput({ ...shaped, sourceVersionId });
      if (!filled) return failure("PROPOSAL_TARGET_NOT_FOUND", 404);
      parsed = filled;
    }
    const active = await activeManifestDigest(actor.workspaceKey, collectionId);
    if (!active.ok) return active;
    if (expectedManifestDigest !== undefined && expectedManifestDigest !== active.digest) return failure("PROPOSAL_BASE_NOT_HEAD", 409);
    return { ok: true, input: parsed, collectionId, bindingDigest: active.digest, evidenceIds };
  },
  currentBinding: (actor, row) => activeManifestDigest(actor.workspaceKey, row.collection_id),
  preconditions: async () => null,
  run: ({ actor, row, input }) => decideLibraryLabel(actor.workspaceKey, { ...input, idempotencyKey: row.proposal_id }, actor.userId),
  undo: ({ actor, row, input }) =>
    decideLibraryLabel(actor.workspaceKey, { ...input, decision: `undo_${input.decision}`, idempotencyKey: `${row.proposal_id}:undo` }, actor.userId),
  resultRef: (result) => ({ replayed: result.replayed === true }),
};

/** One entry per type in PROPOSAL_ACTION_TYPES, and nothing else. */
export const PROPOSAL_EXECUTORS: Readonly<{ [K in ProposalActionType]: ProposalExecutor<InputShapes[K]> }> = {
  library_label: libraryLabel,
  compile_plan: compilePlanExecutor,
  ontology_label_patch: labelCorrectionExecutor,
};

function executorFor(actionType: string): ProposalExecutor<unknown> | null {
  return Object.hasOwn(PROPOSAL_EXECUTORS, actionType)
    ? (PROPOSAL_EXECUTORS as unknown as Readonly<Record<string, ProposalExecutor<unknown>>>)[actionType] ?? null : null;
}

/** The validated stored input, or null: a type without an executor or an input that does not parse. */
export function parseProposalInput(actionType: string, raw: unknown): unknown {
  return executorFor(actionType)?.parse(raw) ?? null;
}

type Resolved = Readonly<{ row: ProposalRow; executor: ProposalExecutor<unknown>; input: unknown; documents: string[]; proposer: ProposalProposer }>;

/** A row the registry can handle, or null (hidden): no executor, unparsable input, no documents, or an agent row without its grant. */
function resolveRow(row: ProposalRow): Resolved | null {
  const executor = executorFor(row.action_type);
  const input = executor?.parse(row.input) ?? null;
  if (!executor || input === null) return null;
  const documents = executor.documentsOf(input);
  if (!Array.isArray(documents) || documents.length === 0) return null;
  if (row.principal_kind !== "agent") return { row, executor, input, documents, proposer: { kind: "person" } };
  if (typeof row.agent_client_label !== "string") return null;
  return { row, executor, input, documents, proposer: {
    kind: "agent", grantedBy: row.agent_grantor_email ?? "a member of this workspace", clientLabel: row.agent_client_label, clientLabelVerified: false,
  } };
}

/** A confirmed row the viewer confirmed long enough ago that the first invocation can no longer be running (§6). */
function isResumable(row: ProposalRow, viewerId: string, now: Date): boolean {
  return row.state === "confirmed" && row.decided_by === viewerId && row.decided_at !== null
    && now.getTime() - Date.parse(row.decided_at) >= PROPOSAL_RESUME_AFTER_MS;
}

export type ProposalViewer = Readonly<{ userId: string; now: Date }>;

function publicOf(resolved: Resolved, viewer: ProposalViewer, withPreview: boolean): PublicProposal {
  const { row, executor, input, proposer } = resolved;
  const preview = withPreview ? executor.previewOf(input) : null;
  return {
    proposalId: row.proposal_id, actionType: row.action_type, state: row.state, collectionId: row.collection_id, preview,
    previewDigest: preview !== null && row.state === "proposed" ? proposalPreviewDigest(row.proposal_id, row.action_type, preview) : null,
    resumable: isResumable(row, viewer.userId, viewer.now), evidenceIds: row.evidence_ids, expiresAt: row.expires_at,
    createdAt: row.created_at, decidedAt: row.decided_at, proposer,
    notes: row.action_type === "compile_plan" && INTAKE_APPROVAL_ROLLOUT_ENABLED ? ["approver_only"] : [],
  } as PublicProposal;
}

/**
 * The public DTO, or null for a row the registry cannot handle (it is hidden, never shown without a preview).
 * `withPreview: false` is the state alone: the preview names documents, so it goes only to a viewer who may read them.
 */
export function toPublicProposal(row: ProposalRow, viewer: ProposalViewer, withPreview = true): PublicProposal | null {
  const resolved = resolveRow(row);
  return resolved ? publicOf(resolved, viewer, withPreview) : null;
}

/**
 * The proposals this viewer may see: a row is kept only when its type has an executor, its input parses and the
 * viewer can read every document it names now. One access call per row with all its documents (cached by the
 * sorted id list). A refusal drops the row; an access check that cannot answer fails the whole list closed.
 */
export async function filterReadableProposals(viewer: Pick<ProposalActor, "workspaceKey" | "userId">, rows: readonly ProposalRow[]):
  Promise<{ ok: true; rows: ProposalRow[] } | Failure> {
  const checks = new Map<string, Promise<Failure | null>>();
  const verdicts = await Promise.all(rows.map(async (row) => {
    const resolved = resolveRow(row);
    if (!resolved) return "hidden" as const;
    const ids = [...new Set(resolved.documents)].sort();
    const key = ids.join("\n");
    let check = checks.get(key);
    if (!check) { check = checkDocuments(viewer, ids); checks.set(key, check); }
    const denied = await check;
    return denied === null ? "readable" as const : denied.status === 403 ? "hidden" as const : "unavailable" as const;
  }));
  if (verdicts.includes("unavailable")) return failure("CONNECTOR_SOURCE_ACCESS_UNAVAILABLE", 503);
  return { ok: true, rows: rows.filter((_, index) => verdicts[index] === "readable") };
}

/* The page cursor: base64url of "<created_at>|<proposal_id>", the store's own text, so no precision is lost. */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;
type Position = Readonly<{ createdAt: string; id: string }>;
const encodeCursor = (position: Position) => Buffer.from(`${position.createdAt}|${position.id}`, "utf8").toString("base64url");

/*
  A cursor timestamp PostgreSQL would refuse is the caller's error (400), never the store's (503) (§16). The
  calendar fields must survive a round trip through Date (so 30 February and hour 25 are refused), the year is
  at least 1 (PostgreSQL has no year 0), and the offset is within ±15:59. Accepting a strict subset of what
  PostgreSQL takes is safe: the store only ever writes this form.
*/
function postgresTimestamp(text: string): boolean {
  const match = TIMESTAMP.exec(text);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (year < 1 || (match[7] !== undefined && (Number(match[7]) > 15 || Number(match[8]) > 59))) return false;
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  at.setUTCHours(hour, minute, second, 0);
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day
    && at.getUTCHours() === hour && at.getUTCMinutes() === minute && at.getUTCSeconds() === second;
}
function decodeCursor(cursor: string): Position | null {
  if (cursor.length < 1 || cursor.length > 128 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts.length !== 2) return null;
  const [createdAt, id] = parts as [string, string];
  const position = { createdAt, id };
  return postgresTimestamp(createdAt) && UUID.test(id) && encodeCursor(position) === cursor ? position : null;
}

/**
 * One page of the workspace's proposals, newest first (§6 Lists; R1 with `grantId`). Rows the viewer may not
 * see are dropped before the page is cut; further store pages are read until the page is full or
 * AGENT_ACL_SCAN_PAGES were read. The cursor is the last row consumed, never one past a row not yet returned.
 */
export async function listProposalsPage(viewer: Pick<ProposalActor, "workspaceKey" | "userId">, options: { cursor: string | null; grantId?: string | null }):
  Promise<{ ok: true; rows: ProposalRow[]; nextCursor: string | null } | Failure> {
  let position: Position | null = null;
  if (options.cursor !== null) {
    position = decodeCursor(options.cursor);
    if (!position) return failure("PROPOSAL_REQUEST_INVALID", 400);
  }
  if (options.grantId != null && !UUID.test(options.grantId)) return failure("PROPOSAL_REQUEST_INVALID", 400);
  const out: ProposalRow[] = [];
  for (let page = 0; page < AGENT_ACL_SCAN_PAGES; page += 1) {
    const listed = await rpcRows("list_world_change_proposals_page", {
      p_workspace_key: viewer.workspaceKey, p_agent_grant_id: options.grantId ?? null,
      p_before_created_at: position?.createdAt ?? null, p_before_id: position?.id ?? null, p_limit: LIST_LIMIT,
    }, true);
    if (!listed.ok) return listed;
    const readable = await filterReadableProposals(viewer, listed.rows);
    if (!readable.ok) return readable;
    const keep = new Set(readable.rows);
    for (const row of listed.rows) {
      position = { createdAt: row.created_at, id: row.proposal_id };
      if (keep.has(row)) out.push(row);
      if (out.length === LIST_LIMIT) return { ok: true, rows: out, nextCursor: encodeCursor(position) };
    }
    if (listed.rows.length < LIST_LIMIT) return { ok: true, rows: out, nextCursor: null };
  }
  return { ok: true, rows: out, nextCursor: position ? encodeCursor(position) : null };
}

// ---------------------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------------------

export type CreateProposalArgs = Readonly<{
  actionType: string; raw: unknown; evidenceIds: unknown; clientKey: string; toolName?: string; index?: number; openReserve?: number;
}>;
type ReadyToInsert = Readonly<{ actionType: string; executor: ProposalExecutor<unknown>; prepared: Prepared<unknown>; storedKey: string }>;

/** Validation and the executor's dry-run: everything but the insert. */
async function prepareProposal(actor: ProposalActor, args: CreateProposalArgs): Promise<ReadyToInsert | Failure> {
  const executor = executorFor(args.actionType);
  const evidenceIds = parseEvidenceIds(args.evidenceIds);
  if (!executor || !evidenceIds || typeof args.clientKey !== "string") return failure("PROPOSAL_REQUEST_INVALID", 400);
  let storedKey: string;
  if (actor.kind === "session") {
    // The agt_ namespace is the server's: a person's key never lands in it (I-14).
    if (!PROPOSAL_IDEMPOTENCY_KEY.test(args.clientKey) || args.clientKey.startsWith("agt_")) return failure("PROPOSAL_REQUEST_INVALID", 400);
    storedKey = args.clientKey;
  } else {
    try {
      storedKey = deriveAgentIdempotencyKey({
        principalId: actor.userId, grantId: actor.grantId, toolName: args.toolName ?? "", clientKey: args.clientKey, index: args.index ?? 0,
      });
    } catch {
      return failure("PROPOSAL_REQUEST_INVALID", 400);
    }
  }
  const prepared = await executor.prepare(actor, args.raw, evidenceIds);
  if (!prepared.ok) return prepared;
  return { actionType: args.actionType, executor, prepared, storedKey };
}

async function insertProposal(actor: ProposalActor, ready: ReadyToInsert, openReserve: number, now: Date):
  Promise<{ ok: true; row: ProposalRow; replayed: boolean } | Failure> {
  const { prepared } = ready;
  const created = await rpcRow("create_world_change_proposal", {
    p_workspace_key: actor.workspaceKey, p_collection_id: prepared.collectionId, p_action_type: ready.actionType, p_input: prepared.input,
    p_input_sha256: proposalInputDigest(prepared.input), p_evidence_ids: prepared.evidenceIds, p_expected_manifest_digest: prepared.bindingDigest,
    p_authorization_revision: actor.authorizationRevision, p_principal_kind: actor.kind, p_principal_id: actor.userId,
    p_idempotency_key: ready.storedKey, p_expires_at: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
    p_binding_kind: ready.executor.bindingKind, p_agent_grant_id: actor.kind === "agent" ? actor.grantId : null,
    p_open_limit: actor.kind === "agent" ? AGENT_OPEN_PROPOSALS_PER_PERSON : null, p_open_reserve: openReserve,
  }, { pick: (body) => (body as { proposal?: unknown } | null)?.proposal });
  if (!created.ok) return created;
  return { ok: true, row: created.row, replayed: (created.body as { replayed?: unknown }).replayed === true };
}

/** Creates one proposal; mutates nothing else. A replay of the same key and body returns the first row. */
export async function createProposal(actor: ProposalActor, args: CreateProposalArgs, now = new Date()):
  Promise<{ ok: true; row: ProposalRow; replayed: boolean } | Failure> {
  const ready = await prepareProposal(actor, args);
  if ("ok" in ready) return ready;
  const reserve = args.openReserve ?? 1;
  if (!Number.isSafeInteger(reserve) || reserve < 1) return failure("PROPOSAL_REQUEST_INVALID", 400);
  return insertProposal(actor, ready, reserve, now);
}

/**
 * A batch (§5.5): every item is validated and prepared before the first insert, so one bad item refuses the
 * call with no row. Each insert is its own transaction, reserving room for itself and every item after it;
 * a store failure at item k leaves 0..k-1, which a retry with the same client key replays before creating the rest.
 */
export async function createProposalBatch(actor: ProposalActor, items: readonly CreateProposalArgs[], now = new Date()):
  Promise<{ ok: true; created: { row: ProposalRow; replayed: boolean }[] } | Failure> {
  if (!Array.isArray(items) || items.length < 1 || items.length > AGENT_LABEL_BATCH_MAX) return failure("PROPOSAL_REQUEST_INVALID", 400);
  const prepared = await Promise.all(items.map((item, index) => prepareProposal(actor, { ...item, index })));
  const refused = prepared.find((ready): ready is Failure => "ok" in ready);
  if (refused) return refused;
  const created: { row: ProposalRow; replayed: boolean }[] = [];
  for (const [index, ready] of (prepared as ReadyToInsert[]).entries()) {
    const inserted = await insertProposal(actor, ready, items.length - index, now);
    if (!inserted.ok) return inserted;
    created.push({ row: inserted.row, replayed: inserted.replayed });
  }
  return { ok: true, created };
}

// ---------------------------------------------------------------------------------------------------------
// Decision (§6)
// ---------------------------------------------------------------------------------------------------------

const record = (row: ProposalRow, outcome: "executed" | "failed" | "undone", receipt: Record<string, unknown>) =>
  rpcRow("record_world_change_proposal_outcome", { p_workspace_key: row.workspace_key, p_proposal_id: row.proposal_id, p_outcome: outcome, p_receipt: receipt });

async function runSafely(run: () => Promise<ExecResult>): Promise<ExecResult> {
  try {
    return await run();
  } catch {
    return failure("PROPOSAL_EXECUTOR_FAILED", 500);
  }
}

/** Execute a confirmed row (idempotent by proposal id), sign the receipt of an agent-origin row, record the outcome. */
async function executeAndRecord(request: Request, actor: ProposalActor, resolved: Resolved, signer: ExportSigner | null, viewer: ProposalViewer):
  Promise<{ ok: true; proposal: PublicProposal } | Failure> {
  const { row, executor, input } = resolved;
  const executedAt = new Date().toISOString();
  const result = await runSafely(() => executor.run({ request, actor, row, input }));
  const outcome = result.ok ? "executed" as const : "failed" as const;
  const receipt: Record<string, unknown> = {
    proposalId: row.proposal_id, inputSha256: row.input_sha256, executedAt, decidedBy: actor.userId,
    result: result.ok ? { ok: true, ...executor.resultRef(result) } : { ok: false, code: result.code, status: result.status },
  };
  if (row.principal_kind === "agent") {
    // An agent-origin outcome is never recorded unsigned: the row stays confirmed and its confirmer can finish it.
    const signed = signer && signActionReceipt(signer, {
      schemaVersion: ACTION_RECEIPT_SCHEMA, proposalId: row.proposal_id, actionType: row.action_type, inputSha256: row.input_sha256,
      outcome, executedAt, resultRef: result.ok ? executor.resultRef(result) : { code: result.code }, confirmedIn: "signed_in_session",
    });
    if (!signed) return failure("PROPOSAL_OUTCOME_NOT_RECORDED", 503);
    receipt.signedReceipt = signed;
  }
  const recorded = await record(row, outcome, receipt);
  if (recorded.ok) return { ok: true, proposal: publicOf({ ...resolved, row: withGrantOf(recorded.row, row) }, viewer, true) };
  if (recorded.code === "PROPOSAL_TRANSITION_ILLEGAL") {
    // Someone recorded first (a resume racing the first invocation): the stored row is the answer.
    const stored = await getProposal(row.workspace_key, row.proposal_id);
    if (stored.ok) return { ok: true, proposal: publicOf({ ...resolved, row: stored.row }, viewer, true) };
  }
  return failure("PROPOSAL_OUTCOME_NOT_RECORDED", 503);
}

export type DecisionRequest = Readonly<{ decision: "confirm" | "reject"; previewDigest?: unknown }>;

/**
 * A person's decision on a row read by id. Nothing before the decide RPC writes anything. A confirmation
 * re-checks access to every document, the preview the client rendered, the session, the preconditions (an
 * agent-origin row needs the receipt signer) and the binding; the store then decides under its row lock, so a
 * duplicate, an expired, a withdrawn or a stale confirmation never reaches the executor. A row already
 * `confirmed` by this person at least PROPOSAL_RESUME_AFTER_MS ago resumes: it runs again under the same key.
 */
export async function decideProposal(request: Request, principal: Principal, row: ProposalRow, body: DecisionRequest, now = new Date()):
  Promise<{ ok: true; proposal: PublicProposal } | Failure> {
  const resolved = resolveRow(row);
  if (!resolved) return failure("PROPOSAL_INPUT_INVALID", 400);
  const { executor, input, documents } = resolved;
  const actor = sessionActor(principal);
  const viewer = { userId: principal.userId, now };
  const decide = async (mayPreview: boolean) => {
    const binding = await executor.currentBinding(actor, row, input);
    if (!binding.ok) return binding;
    const decided = await rpcRow("decide_world_change_proposal", {
      p_workspace_key: principal.workspaceKey, p_proposal_id: row.proposal_id, p_decision: body.decision, p_decided_by: principal.userId,
      p_current_manifest_digest: binding.digest,
    });
    return decided.ok ? { ok: true as const, resolved: { ...resolved, row: withGrantOf(decided.row, row) }, mayPreview } : decided;
  };

  if (body.decision === "reject") {
    // A rejection changes nothing in the World and is allowed with the flag off and without source access,
    // but then the answer is the state alone: the preview goes only where access was confirmed.
    const mayPreview = (await checkDocuments(actor, documents)) === null;
    const current = await revalidateFoundationSession(request, principal);
    if (!current.ok) return failure(current.code, current.status);
    const decided = await decide(mayPreview);
    return decided.ok ? { ok: true, proposal: publicOf(decided.resolved, viewer, mayPreview) } : decided;
  }

  const agentOrigin = row.principal_kind === "agent";
  if (agentOrigin && !agentProposalsEnabled()) return failure("AGENT_PROPOSALS_DISABLED", 409);
  const denied = await checkDocuments(actor, documents);
  if (denied) return denied;
  const resuming = row.state === "confirmed";
  if (resuming && !isResumable(row, principal.userId, now)) return failure("PROPOSAL_NOT_DECIDABLE", 409);
  if (!resuming) {
    if (typeof body.previewDigest !== "string") return failure("PROPOSAL_PREVIEW_DIGEST_REQUIRED", 400);
    if (body.previewDigest !== proposalPreviewDigest(row.proposal_id, row.action_type, executor.previewOf(input))) return failure("PROPOSAL_PREVIEW_CHANGED", 409);
  }
  const current = await revalidateFoundationSession(request, principal);
  if (!current.ok) return failure(current.code, current.status);
  const signer = agentOrigin ? readActionReceiptSigner(process.env, now) : null;
  if (agentOrigin && !signer) return failure("PROPOSAL_RECEIPT_SIGNER_NOT_CONFIGURED", 503);
  const blocked = await executor.preconditions(actor, row, input);
  if (blocked) return blocked;
  if (resuming) return executeAndRecord(request, actor, resolved, signer, viewer);
  const decided = await decide(true);
  if (!decided.ok) return decided;
  if (decided.resolved.row.state !== "confirmed") return { ok: true, proposal: publicOf(decided.resolved, viewer, true) };
  return executeAndRecord(request, actor, decided.resolved, signer, viewer);
}

/** Undo: an `executed` row of a type with an undo. The opposite decision first; when it is refused (someone decided since) nothing is recorded. */
export async function undoProposal(request: Request, principal: Principal, row: ProposalRow, now = new Date()):
  Promise<{ ok: true; proposal: PublicProposal } | Failure> {
  if (row.state !== "executed") return failure("PROPOSAL_NOT_UNDOABLE", 409);
  const resolved = resolveRow(row);
  if (!resolved) return failure("PROPOSAL_INPUT_INVALID", 400);
  const { executor, input, documents } = resolved;
  const undo = executor.undo?.bind(executor);
  if (!undo) return failure("PROPOSAL_NOT_UNDOABLE", 409);
  const actor = sessionActor(principal);
  const denied = await checkDocuments(actor, documents);
  if (denied) return denied;
  const current = await revalidateFoundationSession(request, principal);
  if (!current.ok) return failure(current.code, current.status);
  const undone = await runSafely(() => undo({ request, actor, row, input }));
  if (!undone.ok) return undone;
  const recorded = await record(row, "undone", {
    proposalId: row.proposal_id, undoneAt: new Date().toISOString(), undoneBy: principal.userId, result: { ok: true, ...executor.resultRef(undone) },
  });
  return recorded.ok ? { ok: true, proposal: publicOf({ ...resolved, row: withGrantOf(recorded.row, row) }, { userId: principal.userId, now }, true) } : recorded;
}
