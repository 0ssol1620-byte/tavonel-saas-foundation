import {
  ACTION_RECEIPT_SIGNATURE_SCOPE,
  isScopedSignature,
  readExportSignerEnv,
  type ExportSignatureV2,
  type ExportSigner,
} from "./export-signing";

/*
  WO-AN-2 (workorders/agent-native.md §6, §7, I-27): the signed receipt of an agent-originated proposal.

  A person confirmed, in a signed-in session, a change an agent suggested; the server executed it once.
  The receipt signs what was done -- the proposal, its action type, the digest of its stored input, the
  outcome, when, and the reference the executor names -- with the export Ed25519 key under its own
  protected-header scope, so it never verifies as an export manifest, a compile receipt or an answer
  receipt, and none of those verifies as this. Only a lifecycle (v2) signer signs: without a trust
  store nobody could verify the receipt later. Modelled on lib/answer-receipt-signing.ts.

  Never in the payload: principal ids, the decider, the grant, the idempotency key, the binding digest,
  the preview digest.
*/

export const ACTION_RECEIPT_SCHEMA = "tavonel.action_receipt.v1" as const;

export type ActionReceiptPayload = Readonly<{
  schemaVersion: typeof ACTION_RECEIPT_SCHEMA;
  proposalId: string;
  actionType: string;
  inputSha256: string;
  outcome: "executed" | "failed";
  executedAt: string;
  resultRef: Readonly<Record<string, unknown>>;
  confirmedIn: "signed_in_session";
}>;

export type SignedActionReceipt = { payloadJson: string; signature: ExportSignatureV2 };

type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTION_TYPE = /^[a-z][a-z_]{0,63}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

/** The v2 signer for this scope, or null: a signer without a key version has no trust store to verify against. */
export function readActionReceiptSigner(env: Env = process.env, now = new Date()): ExportSigner | null {
  const signer = readExportSignerEnv(env, now, ACTION_RECEIPT_SIGNATURE_SCOPE);
  return signer?.keyVersion ? signer : null;
}

/** The signed receipt, or null when a field is off-shape or the signer did not sign under this scope. */
export function signActionReceipt(signer: ExportSigner, payload: ActionReceiptPayload): SignedActionReceipt | null {
  if (payload.schemaVersion !== ACTION_RECEIPT_SCHEMA || !UUID.test(payload.proposalId) || !ACTION_TYPE.test(payload.actionType)
    || !SHA256.test(payload.inputSha256) || (payload.outcome !== "executed" && payload.outcome !== "failed")
    || !Number.isFinite(Date.parse(payload.executedAt)) || new Date(payload.executedAt).toISOString() !== payload.executedAt
    || !payload.resultRef || typeof payload.resultRef !== "object" || Array.isArray(payload.resultRef)
    || payload.confirmedIn !== "signed_in_session") return null;
  const payloadJson = JSON.stringify(payload);
  const signature = signer.signPayload(Buffer.from(payloadJson, "utf8"));
  return isScopedSignature(signature, ACTION_RECEIPT_SIGNATURE_SCOPE) ? { payloadJson, signature: signature as ExportSignatureV2 } : null;
}
