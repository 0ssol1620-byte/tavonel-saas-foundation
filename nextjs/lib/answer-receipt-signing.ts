import { createHash } from "node:crypto";
import {
  ANSWER_RECEIPT_SIGNATURE_SCOPE,
  readExportSignerEnv,
  type ExportSignatureV2,
  type ExportSigner,
} from "./export-signing";
import { remoteMcpCohortRefusal } from "./remote-mcp";

/*
  W1-A5 (PROGRAM-2026-11-04 §4.A "A5"): a signed answer receipt.

  An Ask answer used to carry a hash receipt only (`grounded-ask.ts`: outputSha256 over the answer,
  citations and status). This signs an allowlist of identifiers and digests about that answer with
  the export Ed25519 key, under its own protected-header scope, so a receipt signature never
  verifies as an export manifest or a compile receipt and the reverse. Only a lifecycle (v2)
  signer signs: without a trust store nobody could verify the receipt later.

  The question is never in the receipt -- only its sha256, over the exact UTF-8 text the route
  answered. Citations are evidence ids only; excerpts stay in the answer, whose bytes the
  receipt binds through outputSha256.

  TAVONEL_ASK_RECEIPT_SIGNED is `off` (unset or empty reads as off), `shadow` or `on`; anything
  else is a configuration error and Ask refuses with 503 rather than guessing a mode.

    off     nothing is signed.
    shadow  the receipt is computed and timed, never added to the response, and a signing failure
            changes nothing a caller sees (it is logged).
    on      for a workspace inside the canary cohort, the response carries `signedReceipt`; with
            no usable signer the answer is refused with 503 ANSWER_SIGNING_UNAVAILABLE -- never
            sent unsigned. Outside the cohort `on` behaves as `shadow` (appendix A: a mode's `on`
            takes effect only inside the cohort; rollout is a reviewed change).

  The response field is additive, so an N-1 client that does not read it does not break.
*/

export const ANSWER_RECEIPT_SCHEMA = "tavonel.answer_receipt.v1" as const;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAX_CITATIONS = 64;

export type AnswerReceiptPayload = {
  schemaVersion: typeof ANSWER_RECEIPT_SCHEMA;
  collectionId: string;
  worldStateId: string;
  manifestDigest: string;
  questionSha256: string;
  answerMode: string;
  status: "grounded" | "abstained";
  citations: string[];
  /** E2 answerability is not computed on this path yet; null says so rather than inventing one. */
  answerability: null;
  outputSha256: string;
  issuedAt: string;
};

export type SignedAnswerReceipt = { payloadJson: string; signature: ExportSignatureV2 };

type Env = Readonly<Record<string, string | undefined>>;
export type AnswerReceiptMode = "off" | "shadow" | "on";

export function readAnswerReceiptMode(env: Env = process.env): AnswerReceiptMode | null {
  const value = env.TAVONEL_ASK_RECEIPT_SIGNED;
  if (value === undefined || value === "" || value === "off") return "off";
  return value === "shadow" || value === "on" ? value : null;
}

export function readAnswerReceiptSigner(env: Env = process.env, now = new Date()): ExportSigner | null {
  const signer = readExportSignerEnv(env, now, ANSWER_RECEIPT_SIGNATURE_SCOPE);
  return signer?.keyVersion ? signer : null;
}

export const questionSha256 = (question: string) => `sha256:${createHash("sha256").update(question, "utf8").digest("hex")}`;

/** The payload, field by field from the answer body; null when any field is off-shape. */
export function answerReceiptPayload(input: {
  collectionId: string;
  question: string;
  body: Record<string, unknown>;
  issuedAt: string;
}): AnswerReceiptPayload | null {
  const { body } = input;
  const world = body.activeWorld as { worldStateId?: unknown; manifestDigest?: unknown } | undefined;
  const receipt = body.receipt as { manifestDigest?: unknown; outputSha256?: unknown; collectionId?: unknown } | undefined;
  const citations = Array.isArray(body.citations) ? body.citations.map((citation) => (citation as { evidenceId?: unknown })?.evidenceId) : null;
  if (!IDENTIFIER.test(input.collectionId) || receipt?.collectionId !== input.collectionId
    || typeof world?.worldStateId !== "string" || !IDENTIFIER.test(world.worldStateId)
    || typeof receipt?.manifestDigest !== "string" || !SHA256.test(receipt.manifestDigest) || world.manifestDigest !== receipt.manifestDigest
    || typeof receipt.outputSha256 !== "string" || !SHA256.test(receipt.outputSha256)
    || typeof body.answerMode !== "string" || !IDENTIFIER.test(body.answerMode)
    || (body.status !== "grounded" && body.status !== "abstained")
    || !citations || citations.length > MAX_CITATIONS || !citations.every((id) => typeof id === "string" && IDENTIFIER.test(id))
    || !Number.isFinite(Date.parse(input.issuedAt)) || new Date(input.issuedAt).toISOString() !== input.issuedAt) return null;
  return {
    schemaVersion: ANSWER_RECEIPT_SCHEMA,
    collectionId: input.collectionId,
    worldStateId: world.worldStateId,
    manifestDigest: receipt.manifestDigest,
    questionSha256: questionSha256(input.question),
    answerMode: body.answerMode,
    status: body.status,
    citations: citations as string[],
    answerability: null,
    outputSha256: receipt.outputSha256,
    issuedAt: input.issuedAt,
  };
}

export function signAnswerReceipt(signer: ExportSigner, payload: AnswerReceiptPayload): SignedAnswerReceipt | null {
  const payloadJson = JSON.stringify(payload);
  const signature = signer.signPayload(Buffer.from(payloadJson, "utf8"));
  return signature.schemaVersion === "tavonel.export_signature.v2" && signature.signatureScope === ANSWER_RECEIPT_SIGNATURE_SCOPE
    ? { payloadJson, signature }
    : null;
}

export type AnswerSigningOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: "ANSWER_SIGNING_UNAVAILABLE" | "ANSWER_RECEIPT_MODE_INVALID" | "REMOTE_MCP_COHORT_CONFIG_INVALID" };

/**
 * What the Ask route does with a 200 answer body. Pure but for the log line it writes in shadow;
 * `now` and `env` are injectable for tests.
 */
export function applyAnswerReceipt(input: {
  workspaceKey: string;
  collectionId: string;
  question: string;
  body: Record<string, unknown>;
  env?: Env;
  now?: Date;
}): AnswerSigningOutcome {
  const env = input.env ?? process.env;
  const mode = readAnswerReceiptMode(env);
  if (mode === null) return { ok: false, code: "ANSWER_RECEIPT_MODE_INVALID" };
  if (mode === "off") return { ok: true, body: input.body };
  /*
    `on` signs inside the W1 canary cohort (TAVONEL_REMOTE_MCP_COHORT) and behaves as shadow outside
    it. A cohort that cannot be read is not "outside": it refuses, never answers unsigned (R1 M3).
  */
  const cohort = mode === "on" ? remoteMcpCohortRefusal(input.workspaceKey, env) : "REMOTE_MCP_COHORT_EXCLUDED";
  if (cohort === "REMOTE_MCP_COHORT_CONFIG_INVALID") return { ok: false, code: cohort };
  const live = cohort === null;
  const started = performance.now();
  const now = input.now ?? new Date();
  const signer = readAnswerReceiptSigner(env, now);
  const payload = signer ? answerReceiptPayload({ ...input, issuedAt: now.toISOString() }) : null;
  const signed = signer && payload ? signAnswerReceipt(signer, payload) : null;
  if (!live) {
    try {
      console.info(JSON.stringify({
        sli: "tavonel.answer_receipt_sli.v1", mode,
        outcome: signed ? "signed" : signer ? "payload_refused" : "signer_unavailable",
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      }));
    } catch { /* shadow telemetry never changes an answer */ }
    return { ok: true, body: input.body };
  }
  if (!signed) return { ok: false, code: "ANSWER_SIGNING_UNAVAILABLE" };
  return { ok: true, body: { ...input.body, signedReceipt: signed } };
}
