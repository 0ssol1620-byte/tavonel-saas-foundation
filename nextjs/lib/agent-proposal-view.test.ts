import { describe, expect, it } from "vitest";
import { agentProposalDocuments, toAgentProposalView } from "./agent-proposal-view";
import type { ProposalRow } from "./change-proposals";

/*
  AgentProposalView (workorders/agent-native.md §7; WO-AN-5): the key set is pinned, and nothing the agent must
  never see -- principal ids, decider, grant, idempotency key, binding digest, preview digest, input digest --
  reaches it under any key.
*/

const PROPOSAL = "00000000-0000-4000-8000-0000000000a1";
const PERSON = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const GRANT = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
const DOC = "0a000000-0000-4000-8000-00000000000a";
const BINDING = `sha256:${"8".repeat(64)}`;
const INPUT_SHA = `sha256:${"9".repeat(64)}`;
const IDEM = "agt_secretsecretsecretsecretsecretsecretsec";
const input = { documentId: DOC, sourceVersionId: "a".repeat(64), labelKind: "topic", labelKey: "pricing", decision: "confirmed" };
const SIGNED = { payloadJson: JSON.stringify({ schemaVersion: "tavonel.action_receipt.v1", proposalId: PROPOSAL, outcome: "executed" }),
  signature: { alg: "Ed25519", keyId: "k", keyVersion: 1, signature: "c2ln" } };

const row = (fields: Record<string, unknown> = {}) => ({
  proposal_id: PROPOSAL, workspace_key: "pilot-a", collection_id: `collection-${"c".repeat(32)}`, action_type: "library_label", input,
  input_sha256: INPUT_SHA, evidence_ids: ["ev-1"], state: "proposed", expires_at: "2026-11-24T00:00:00Z", created_at: "2026-11-17T00:00:00Z",
  decided_at: null, binding_kind: "active_manifest", principal_kind: "agent", principal_id: PERSON, agent_grant_id: GRANT, decided_by: null,
  expected_manifest_digest: BINDING, idempotency_key: IDEM, receipt: null, agent_client_label: "Claude", agent_grantor_email: "a@example.com",
  ...fields,
}) as unknown as ProposalRow;

describe("toAgentProposalView", () => {
  it("has exactly the §7 keys (receipt only once it ran)", () => {
    expect(Object.keys(toAgentProposalView(row(), true)!).sort())
      .toEqual(["actionType", "confirmUrl", "evidenceIds", "expiresAt", "preview", "proposalId", "state"]);
    const executed = toAgentProposalView(row({ state: "executed", decided_by: PERSON, decided_at: "2026-11-17T01:00:00Z",
      receipt: { decidedBy: PERSON, proposalId: PROPOSAL, signedReceipt: SIGNED } }), true)!;
    expect(Object.keys(executed).sort())
      .toEqual(["actionType", "confirmUrl", "evidenceIds", "expiresAt", "preview", "proposalId", "receipt", "state"]);
    expect(Object.keys(executed.receipt!).sort()).toEqual(["payload", "signature"]);
  });

  it("names the inbox deep link and the preview the person will confirm", () => {
    expect(toAgentProposalView(row(), true)).toEqual({
      proposalId: PROPOSAL, actionType: "library_label", state: "proposed", preview: input, evidenceIds: ["ev-1"],
      expiresAt: "2026-11-24T00:00:00Z", confirmUrl: `/workspace/changes?proposal=${PROPOSAL}`,
    });
  });

  it("never carries a principal, the decider, the grant, a key, a digest or the person's email (mutant: spread the row)", () => {
    const executed = row({ state: "executed", decided_by: PERSON, decided_at: "2026-11-17T01:00:00Z",
      receipt: { decidedBy: PERSON, proposalId: PROPOSAL, signedReceipt: SIGNED } });
    for (const readable of [true, false]) {
      const text = JSON.stringify(toAgentProposalView(executed, readable));
      for (const secret of [PERSON, GRANT, IDEM, BINDING, INPUT_SHA, "a@example.com", "Claude", "principal", "decided", "grant", "idempotency"]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it("shows no preview when the person cannot read every document now", () => {
    expect(toAgentProposalView(row(), false)?.preview).toBeNull();
  });

  it("shows the receipt as the exact signed bytes, and only a receipt naming this proposal", () => {
    const executed = (signedReceipt: unknown, state = "executed") =>
      toAgentProposalView(row({ state, decided_by: PERSON, receipt: { signedReceipt } }), true);
    expect(executed(SIGNED)?.receipt).toEqual({ payload: SIGNED.payloadJson, signature: SIGNED.signature });
    expect(executed({ ...SIGNED, payloadJson: JSON.stringify({ proposalId: "00000000-0000-4000-8000-0000000000a2" }) })?.receipt).toBeUndefined();
    expect(executed({ ...SIGNED, payloadJson: "{not json" })?.receipt).toBeUndefined();
    expect(executed(SIGNED, "confirmed")?.receipt).toBeUndefined();
    expect(executed(null)?.receipt).toBeUndefined();
  });

  it("hides a row whose type has no executor or whose input does not parse", () => {
    expect(toAgentProposalView(row({ action_type: "merge_documents" }), true)).toBeNull();
    expect(toAgentProposalView(row({ input: { ...input, extra: 1 } }), true)).toBeNull();
    expect(toAgentProposalView(row({ action_type: "toString" }), true)).toBeNull();
    expect(agentProposalDocuments(row({ action_type: "toString" }))).toBeNull();
  });

  it("documents are the executor's documentsOf", () => {
    expect(agentProposalDocuments(row())).toEqual([DOC]);
    expect(agentProposalDocuments(row({ input: { ...input, documentId: "nope" } }))).toBeNull();
  });
});
