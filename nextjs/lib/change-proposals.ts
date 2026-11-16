import { createHash } from "node:crypto";
import { canonicalJson } from "./change-notify";
import { checkConnectorSourceAccessForViewer } from "./connector-source-access";
import { requireFoundationSession, revalidateFoundationSession, type FoundationPrincipal } from "./developer-auth";
import { COLLECTION_ID_PATTERN } from "./immutable-keys";
import { DOC_TYPES } from "./library-methods";
import { decideLibraryLabel, type LibraryDecisionResult } from "./library-shadow";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { getFoundationActiveWorld } from "./world-store";

/*
  Change proposals (WO-D30-2, D30 M9-03, U37, S29). A proposal is a request for a change to the World,
  kept for a person to confirm or reject. Creating one mutates nothing: the preview is the change it
  would make. A confirmation executes it once, through the executor for its action type, and records
  the outcome; an Undo issues the opposite decision and records that. The store is
  supabase/migrations/20261116130100_world_change_proposals.sql; every route here is session only.
*/

export const PROPOSAL_ACTION_TYPES = ["library_label"] as const;
export type ProposalActionType = (typeof PROPOSAL_ACTION_TYPES)[number];
export const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PROPOSAL_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_BODY_BYTES = 8_192;
const LIST_LIMIT = 50;

/** The WO-D23-4 decision body minus its idempotency key; the proposal id is the key when it executes. */
export type LibraryLabelInput = Readonly<{
  documentId: string; sourceVersionId: string; labelKind: "doc_type" | "topic"; labelKey: string; decision: "confirmed" | "rejected";
}>;

const ownKeys = (value: object) => Object.keys(value).sort().join(",");
const INPUT_KEYS = ownKeys({ documentId: 0, sourceVersionId: 0, labelKind: 0, labelKey: 0, decision: 0 });

/** The validated input, or null. Unknown keys are refused; an Undo is never proposed, only a confirm or a reject. */
export function parseProposalInput(actionType: string, raw: unknown): LibraryLabelInput | null {
  if (actionType !== "library_label" || !raw || typeof raw !== "object" || Array.isArray(raw) || ownKeys(raw) !== INPUT_KEYS) return null;
  const { documentId, sourceVersionId, labelKind, labelKey, decision } = raw as Record<string, unknown>;
  if (typeof documentId !== "string" || !UUID.test(documentId) || typeof sourceVersionId !== "string" || !/^[a-f0-9]{64}$/.test(sourceVersionId)
    || (labelKind !== "doc_type" && labelKind !== "topic") || (decision !== "confirmed" && decision !== "rejected")
    || typeof labelKey !== "string" || labelKey.length < 1 || labelKey.length > 64 || CONTROL.test(labelKey)
    || (labelKind === "doc_type" && !(DOC_TYPES as readonly string[]).includes(labelKey))) return null;
  return { documentId, sourceVersionId, labelKind, labelKey, decision };
}

export function proposalInputDigest(input: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(input)).digest("hex")}`;
}

/** Evidence ids a proposal cites: at most 16 short strings; null when the field is malformed. */
export function parseEvidenceIds(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 16) return null;
  return raw.every((id) => typeof id === "string" && id.length >= 1 && id.length <= 128 && !CONTROL.test(id)) ? [...raw as string[]] : null;
}

export const PROPOSAL_STATES = ["proposed", "confirmed", "rejected", "expired", "stale", "executed", "failed", "undone"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

/** A row of world_change_proposals as the RPCs return it (`to_jsonb`). Internal: never sent to a client. */
export type ProposalRow = Readonly<{
  proposal_id: string; workspace_key: string; collection_id: string; action_type: string; input: unknown; input_sha256: string;
  evidence_ids: string[]; state: ProposalState; expires_at: string; created_at: string; decided_at: string | null;
}>;

/** What a client sees: the dry-run preview (the label change it would make), never digests, principals or keys. */
export type PublicProposal = Readonly<{
  proposalId: string; actionType: string; state: ProposalState; preview: LibraryLabelInput | null; evidenceIds: string[];
  expiresAt: string; createdAt: string; decidedAt: string | null;
}>;

/** `withPreview: false` is the state alone: the preview names a document and a label, so it goes only to a viewer who may read that document. */
export function toPublicProposal(row: ProposalRow, withPreview = true): PublicProposal {
  return {
    proposalId: row.proposal_id, actionType: row.action_type, state: row.state,
    preview: withPreview ? parseProposalInput(row.action_type, row.input) : null,
    evidenceIds: row.evidence_ids, expiresAt: row.expires_at, createdAt: row.created_at, decidedAt: row.decided_at,
  };
}

function asRow(value: unknown): ProposalRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const text = (key: string) => typeof row[key] === "string";
  return text("proposal_id") && text("workspace_key") && text("collection_id") && text("action_type") && text("input_sha256")
    && text("expires_at") && text("created_at") && (row.decided_at === null || text("decided_at"))
    && PROPOSAL_STATES.includes(row.state as ProposalState) && Array.isArray(row.evidence_ids) && row.input !== undefined
    ? value as ProposalRow : null;
}

export type Failure = { ok: false; code: string; status: number };
const failure = (code: string, status: number): Failure => ({ ok: false, code, status });

const RPC_ERRORS: ReadonlyArray<readonly [string, string, number]> = [
  ["proposal_request_invalid", "PROPOSAL_REQUEST_INVALID", 400],
  ["proposal_idempotency_conflict", "PROPOSAL_IDEMPOTENCY_CONFLICT", 409],
  ["proposal_not_found", "PROPOSAL_NOT_FOUND", 404],
  ["proposal_not_decidable", "PROPOSAL_NOT_DECIDABLE", 409],
  ["proposal_transition_illegal", "PROPOSAL_TRANSITION_ILLEGAL", 409],
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

async function rpcRow(name: string, body: Record<string, unknown>, pick: (value: unknown) => unknown = (value) => value):
  Promise<{ ok: true; row: ProposalRow; body: unknown } | Failure> {
  const answered = await rpc(name, body);
  if (!answered.ok) return answered;
  const row = asRow(pick(answered.body));
  return row ? { ok: true, row, body: answered.body } : failure("PROPOSAL_STORE_RESPONSE_INVALID", 503);
}

export async function listProposals(workspaceKey: string, collectionId: string): Promise<{ ok: true; rows: ProposalRow[] } | Failure> {
  const answered = await rpc("list_world_change_proposals", { p_workspace_key: workspaceKey, p_collection_id: collectionId, p_limit: LIST_LIMIT });
  if (!answered.ok) return answered;
  const rows = Array.isArray(answered.body) ? answered.body.map(asRow) : [];
  return Array.isArray(answered.body) && rows.every((row) => row !== null) ? { ok: true, rows: rows as ProposalRow[] } : failure("PROPOSAL_STORE_RESPONSE_INVALID", 503);
}

type Principal = Readonly<FoundationPrincipal>;

/** Proposals are a person's act: a session, never an API key, whatever its scopes. */
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
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** The viewer must be able to read the document now; a lost source access is a refusal, never an execution. */
async function checkViewerAccess(principal: Principal, input: LibraryLabelInput): Promise<Failure | null> {
  const access = await checkConnectorSourceAccessForViewer(principal.workspaceKey, [input.documentId], principal.userId);
  return access.ok ? null : failure(access.code, access.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503);
}

/**
 * The proposals this viewer may see: a proposal is listed only when its document is readable by the viewer now.
 * Each distinct document is checked once. A refusal drops the proposals of that document; an access check that
 * cannot answer fails the whole list closed. A proposal whose input names no document carries no preview and stays.
 */
export async function filterReadableProposals(principal: Principal, rows: ProposalRow[]): Promise<{ ok: true; rows: ProposalRow[] } | Failure> {
  const documentOf = (row: ProposalRow) => parseProposalInput(row.action_type, row.input)?.documentId ?? null;
  const documentIds = [...new Set(rows.map(documentOf).filter((id): id is string => id !== null))];
  const verdicts = await Promise.all(documentIds.map(async (documentId) => ({
    documentId, access: await checkConnectorSourceAccessForViewer(principal.workspaceKey, [documentId], principal.userId),
  })));
  const unanswered = verdicts.find((verdict) => !verdict.access.ok && verdict.access.code !== "CONNECTOR_SOURCE_ACCESS_DENIED");
  if (unanswered) return failure("CONNECTOR_SOURCE_ACCESS_UNAVAILABLE", 503);
  const readable = new Set(verdicts.filter((verdict) => verdict.access.ok).map((verdict) => verdict.documentId));
  return { ok: true, rows: rows.filter((row) => { const id = documentOf(row); return id === null || readable.has(id); }) };
}

async function activeManifestDigest(workspaceKey: string, collectionId: string): Promise<{ ok: true; digest: string } | Failure> {
  const active = await getFoundationActiveWorld(workspaceKey, collectionId);
  if (active.ok) return { ok: true, digest: active.world.manifestDigest };
  return failure(active.code, active.code === "ACTIVE_WORLD_NOT_FOUND" ? 404 : 503);
}

/** Creates a proposal bound to the active World; mutates nothing else. A replay of the same key and body returns the first row. */
export async function createProposal(principal: Principal, args: {
  collectionId: string; actionType: string; input: unknown; evidenceIds: unknown; idempotencyKey: string; now?: Date;
}): Promise<{ ok: true; proposal: PublicProposal; replayed: boolean } | Failure> {
  const input = parseProposalInput(args.actionType, args.input);
  const evidenceIds = parseEvidenceIds(args.evidenceIds);
  if (!input || !evidenceIds || !COLLECTION_ID_PATTERN.test(args.collectionId) || !PROPOSAL_IDEMPOTENCY_KEY.test(args.idempotencyKey)) {
    return failure("PROPOSAL_REQUEST_INVALID", 400);
  }
  const denied = await checkViewerAccess(principal, input);
  if (denied) return denied;
  const active = await activeManifestDigest(principal.workspaceKey, args.collectionId);
  if (!active.ok) return active;
  const now = args.now ?? new Date();
  const created = await rpcRow("create_world_change_proposal", {
    p_workspace_key: principal.workspaceKey, p_collection_id: args.collectionId, p_action_type: args.actionType, p_input: input,
    p_input_sha256: proposalInputDigest(input), p_evidence_ids: evidenceIds, p_expected_manifest_digest: active.digest,
    p_authorization_revision: principal.authorizationRevision, p_principal_kind: "session", p_principal_id: principal.userId,
    p_idempotency_key: args.idempotencyKey, p_expires_at: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
  }, (body) => (body as { proposal?: unknown } | null)?.proposal);
  if (!created.ok) return created;
  return { ok: true, proposal: toPublicProposal(created.row, true), replayed: (created.body as { replayed?: unknown }).replayed === true };
}

/** One executor per action type. `run` is the confirmed change, `undo` the opposite decision. Both are idempotent by key. */
const EXECUTORS: Readonly<Record<ProposalActionType, {
  run: (workspaceKey: string, input: LibraryLabelInput, userId: string, proposalId: string) => Promise<LibraryDecisionResult>;
  undo: (workspaceKey: string, input: LibraryLabelInput, userId: string, proposalId: string) => Promise<LibraryDecisionResult>;
}>> = {
  library_label: {
    run: (workspaceKey, input, userId, proposalId) => decideLibraryLabel(workspaceKey, { ...input, idempotencyKey: proposalId }, userId),
    undo: (workspaceKey, input, userId, proposalId) =>
      decideLibraryLabel(workspaceKey, { ...input, decision: `undo_${input.decision}`, idempotencyKey: `${proposalId}:undo` }, userId),
  },
};

async function execute(which: "run" | "undo", row: ProposalRow, principal: Principal): Promise<LibraryDecisionResult> {
  const input = parseProposalInput(row.action_type, row.input);
  if (!input) return failure("PROPOSAL_INPUT_INVALID", 400);
  try {
    return await EXECUTORS[row.action_type as ProposalActionType][which](principal.workspaceKey, input, principal.userId, row.proposal_id);
  } catch {
    return failure("PROPOSAL_EXECUTOR_FAILED", 500);
  }
}

const record = (row: ProposalRow, outcome: "executed" | "failed" | "undone", receipt: Record<string, unknown>) =>
  rpcRow("record_world_change_proposal_outcome", { p_workspace_key: row.workspace_key, p_proposal_id: row.proposal_id, p_outcome: outcome, p_receipt: receipt });

/** The proposal, looked up inside the collection the caller names: a proposal outside it is not found, never guessed at. */
export async function findProposal(workspaceKey: string, collectionId: unknown, proposalId: string): Promise<{ ok: true; row: ProposalRow } | Failure> {
  if (typeof collectionId !== "string" || !COLLECTION_ID_PATTERN.test(collectionId) || !UUID.test(proposalId)) return failure("PROPOSAL_REQUEST_INVALID", 400);
  const listed = await listProposals(workspaceKey, collectionId);
  if (!listed.ok) return listed;
  const row = listed.rows.find((candidate) => candidate.proposal_id === proposalId);
  return row ? { ok: true, row } : failure("PROPOSAL_NOT_FOUND", 404);
}

/**
 * A person's decision. The store decides under a row lock against the active World digest, so a duplicate, an
 * expired or a stale confirmation never reaches the executor; only a `confirmed` row executes, once. The executor's
 * outcome is recorded either way. A failed execution is recorded as `failed` and never retried.
 */
export async function decideProposal(request: Request, principal: Principal, row: ProposalRow, decision: "confirm" | "reject", now = new Date()):
  Promise<{ ok: true; proposal: PublicProposal } | Failure> {
  const input = parseProposalInput(row.action_type, row.input);
  // A confirmation needs source access and is refused without it. A rejection is allowed without it (it changes
  // nothing in the World), but then the answer is the state alone: the preview goes only where access was confirmed.
  let mayPreview = true;
  if (decision === "confirm") {
    if (!input) return failure("PROPOSAL_INPUT_INVALID", 400);
    const denied = await checkViewerAccess(principal, input);
    if (denied) return denied;
  } else {
    mayPreview = input !== null && (await checkViewerAccess(principal, input)) === null;
  }
  const current = await revalidateFoundationSession(request, principal);
  if (!current.ok) return failure(current.code, current.status);
  const active = await activeManifestDigest(principal.workspaceKey, row.collection_id);
  if (!active.ok) return active;
  const decided = await rpcRow("decide_world_change_proposal", {
    p_workspace_key: principal.workspaceKey, p_proposal_id: row.proposal_id, p_decision: decision, p_decided_by: principal.userId,
    p_current_manifest_digest: active.digest, p_now: now.toISOString(),
  });
  if (!decided.ok) return decided;
  if (decided.row.state !== "confirmed") return { ok: true, proposal: toPublicProposal(decided.row, mayPreview) };
  const executedAt = new Date().toISOString();
  const result = await execute("run", decided.row, principal);
  const recorded = await record(decided.row, result.ok ? "executed" : "failed", {
    proposalId: row.proposal_id, inputSha256: row.input_sha256, executedAt, decidedBy: principal.userId,
    result: result.ok ? { ok: true, replayed: result.replayed } : { ok: false, code: result.code, status: result.status },
  });
  return recorded.ok ? { ok: true, proposal: toPublicProposal(recorded.row, mayPreview) } : failure("PROPOSAL_OUTCOME_NOT_RECORDED", 503);
}

/** Undo: `executed` only. The opposite decision is issued first; when the library refuses it (someone decided since) nothing is recorded. */
export async function undoProposal(request: Request, principal: Principal, row: ProposalRow):
  Promise<{ ok: true; proposal: PublicProposal } | Failure> {
  if (row.state !== "executed") return failure("PROPOSAL_NOT_UNDOABLE", 409);
  const input = parseProposalInput(row.action_type, row.input);
  if (!input) return failure("PROPOSAL_INPUT_INVALID", 400);
  const denied = await checkViewerAccess(principal, input);
  if (denied) return denied;
  const current = await revalidateFoundationSession(request, principal);
  if (!current.ok) return failure(current.code, current.status);
  const undone = await execute("undo", row, principal);
  if (!undone.ok) return undone;
  const recorded = await record(row, "undone", {
    proposalId: row.proposal_id, undoneAt: new Date().toISOString(), undoneBy: principal.userId, result: { ok: true, replayed: undone.replayed },
  });
  return recorded.ok ? { ok: true, proposal: toPublicProposal(recorded.row, true) } : recorded;
}
