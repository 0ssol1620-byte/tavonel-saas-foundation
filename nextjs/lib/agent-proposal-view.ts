import { PROPOSAL_EXECUTORS, parseProposalInput, type ProposalRow, type ProposalState } from "./change-proposals";

/*
  AgentProposalView (workorders/agent-native.md §7; WO-AN-5): what an agent sees of a proposal. A separate type,
  never PublicProposal with fields filtered out. It carries the proposal, its state, the preview the person will
  confirm (null when the grant's person cannot read every document it names now), the evidence it cites, when it
  expires, where a person confirms it, and the signed receipt once it ran.

  Never: principal ids, the decider, the grant, the idempotency key, the binding digest, the preview digest, the
  input digest, scores. The key-set test in agent-proposal-view.test.ts pins every field.
*/

export type AgentReceipt = Readonly<{ payload: string; signature: Readonly<Record<string, unknown>> }>;

export type AgentProposalView = Readonly<{
  proposalId: string;
  actionType: string;
  state: ProposalState;
  preview: object | null;
  evidenceIds: readonly string[];
  expiresAt: string;
  confirmUrl: string;
  receipt?: AgentReceipt;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TERMINAL: readonly ProposalState[] = ["executed", "failed"];
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The signed receipt an agent-origin row records (`receipt.signedReceipt` = {payloadJson, signature}), or null.
 * `payload` is the exact signed JSON text, so the signature verifies over the bytes the agent holds. A payload
 * that does not name this proposal is not this proposal's receipt and is not shown.
 */
function receiptOf(row: ProposalRow): AgentReceipt | null {
  if (!TERMINAL.includes(row.state) || !isObject(row.receipt)) return null;
  const signed = row.receipt.signedReceipt;
  if (!isObject(signed) || typeof signed.payloadJson !== "string" || !isObject(signed.signature)) return null;
  let payload: unknown;
  try { payload = JSON.parse(signed.payloadJson); } catch { return null; }
  if (!isObject(payload) || payload.proposalId !== row.proposal_id) return null;
  return { payload: signed.payloadJson, signature: { ...signed.signature } };
}

/**
 * The agent's view of one row, or null when the row is not one an agent may be shown at all: a type without an
 * executor or an input that does not parse (hidden, never shown without a preview). `readable` says whether the
 * grant's person can read every document the row names now; without it the preview is null.
 */
export function toAgentProposalView(row: ProposalRow, readable: boolean): AgentProposalView | null {
  if (!UUID.test(row.proposal_id) || !Object.hasOwn(PROPOSAL_EXECUTORS, row.action_type)) return null;
  const input = parseProposalInput(row.action_type, row.input);
  if (input === null) return null;
  const executor = PROPOSAL_EXECUTORS[row.action_type as keyof typeof PROPOSAL_EXECUTORS] as { previewOf(input: unknown): object };
  const receipt = receiptOf(row);
  return {
    proposalId: row.proposal_id,
    actionType: row.action_type,
    state: row.state,
    preview: readable ? executor.previewOf(input) : null,
    evidenceIds: [...row.evidence_ids],
    expiresAt: row.expires_at,
    confirmUrl: `/workspace/changes?proposal=${row.proposal_id}`,
    ...(receipt ? { receipt } : {}),
  };
}

/** Every document the row names (the executor's documentsOf), or null for a row that is hidden. */
export function agentProposalDocuments(row: ProposalRow): string[] | null {
  if (!Object.hasOwn(PROPOSAL_EXECUTORS, row.action_type)) return null;
  const input = parseProposalInput(row.action_type, row.input);
  if (input === null) return null;
  const executor = PROPOSAL_EXECUTORS[row.action_type as keyof typeof PROPOSAL_EXECUTORS] as { documentsOf(input: unknown): string[] };
  const documents = executor.documentsOf(input);
  return Array.isArray(documents) && documents.length > 0 ? documents : null;
}
