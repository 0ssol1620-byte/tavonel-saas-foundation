/**
 * Verify a signed TAVONEL answer receipt, offline.
 *
 * Published as `tavonel-verify-answer.mjs` on https://tavonel.com/developers and pinned by sha256
 * in /developer/channel.json. Node standard library only: a verifier that needs `pnpm install`
 * is not one a customer on a clean machine can run.
 *
 *   node tavonel-verify-answer.mjs --receipt answer.json --trust-store trust.json
 *     [--trusted-fingerprint sha256:<64 hex>] [--question-file q.txt]
 *
 * `--receipt` is either the whole Ask response (the JSON body that carries `signedReceipt`) or the
 * `signedReceipt` object alone. Given the whole response, the answer itself is checked too: its
 * status, citations, World and output digest must be the ones the receipt signed, and the output
 * digest is recomputed from the answer text and citations, so an edited answer under an intact
 * receipt fails. `--question-file` additionally checks the question you asked against the
 * receipt's questionSha256 (the receipt never holds the question itself).
 *
 * The trust anchor must come from somewhere other than the receipt:
 * GET https://tavonel.com/api/export/trust publishes it. The trust store is required, because it is
 * the only place a revoked key is named; `--trusted-fingerprint` is an additional pin, never a
 * substitute. Exit 0 when the receipt verifies, 1 otherwise.
 *
 * Key lifecycle policy: a receipt is valid if its key was valid when it was signed. A key that has
 * since expired or been retired still verifies the receipts it signed inside its validity window;
 * a revoked key verifies nothing, and any status other than active or retired is refused. Because
 * the signing time is written by the signer, the verifier also refuses a signing time in the
 * future (beyond MAX_CLOCK_SKEW_MS) and a payload issuedAt that is not the signing time (beyond
 * ISSUED_AT_TOLERANCE_MS). A key suspected of compromise must be marked revoked, not deleted.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const SCOPE = "tavonel.signed_answer_receipt.v1";
const SCHEMA = "tavonel.answer_receipt.v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const ISSUED_AT_TOLERANCE_MS = 5_000;
const ACCEPTED_KEY_STATUSES = ["active", "retired"];
const FIELDS = ["schemaVersion", "collectionId", "worldStateId", "manifestDigest", "questionSha256", "answerMode",
  "status", "citations", "answerability", "outputSha256", "issuedAt"];

const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const instant = (value) => typeof value === "string" && INSTANT.test(value) && new Date(value).toISOString() === value;

// The canonical form the answer's outputSha256 is computed over (lib/grounded-ask.ts `canonicalize`).
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

function parseArguments(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) return null;
    args.set(name.slice(2), value);
  }
  const receipt = args.get("receipt");
  const trustedFingerprint = args.get("trusted-fingerprint")?.toLowerCase();
  const trustStore = args.get("trust-store");
  if (!receipt || !trustStore || (trustedFingerprint !== undefined && !SHA256.test(trustedFingerprint))) return null;
  return { receipt, trustedFingerprint, trustStore, questionFile: args.get("question-file") };
}

function checkPayload(payload, payloadJson) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("receipt payload is not an object");
  if (JSON.stringify(Object.keys(payload)) !== JSON.stringify(FIELDS)) throw new Error("receipt payload fields are not the v1 allowlist");
  if (JSON.stringify(payload) !== payloadJson) throw new Error("receipt payload JSON is not canonical");
  if (payload.schemaVersion !== SCHEMA) throw new Error("receipt schema is unsupported");
  for (const key of ["collectionId", "worldStateId", "answerMode"]) {
    if (typeof payload[key] !== "string" || !IDENTIFIER.test(payload[key])) throw new Error(`receipt ${key} is malformed`);
  }
  for (const key of ["manifestDigest", "questionSha256", "outputSha256"]) {
    if (typeof payload[key] !== "string" || !SHA256.test(payload[key])) throw new Error(`receipt ${key} is malformed`);
  }
  if (payload.status !== "grounded" && payload.status !== "abstained") throw new Error("receipt status is malformed");
  if (!Array.isArray(payload.citations) || !payload.citations.every((id) => typeof id === "string" && IDENTIFIER.test(id))) {
    throw new Error("receipt citations are malformed");
  }
  if (payload.answerability !== null) throw new Error("receipt answerability is not supported by this verifier");
  if (!instant(payload.issuedAt)) throw new Error("receipt issuedAt is malformed");
}

async function checkSignature(signature, payloadBytes, options) {
  if (!signature || signature.schemaVersion !== "tavonel.export_signature.v2" || signature.algorithm !== "Ed25519") {
    throw new Error("signature is not a v2 Ed25519 signature");
  }
  if (signature.signatureScope !== SCOPE) throw new Error(`signature scope is not ${SCOPE}`);
  if (!Number.isSafeInteger(signature.keyVersion) || signature.keyVersion < 1 || !instant(signature.issuedAt) || !instant(signature.expiresAt)
    || Date.parse(signature.expiresAt) <= Date.parse(signature.issuedAt)) throw new Error("signature lifecycle fields are malformed");
  if (Date.parse(signature.issuedAt) > Date.now() + MAX_CLOCK_SKEW_MS) throw new Error("signature signing time is in the future");
  const publicKeyDer = Buffer.from(String(signature.publicKeySpkiDerBase64), "base64");
  if (publicKeyDer.toString("base64") !== signature.publicKeySpkiDerBase64) throw new Error("public key is not canonical Base64");
  const fingerprint = digest(publicKeyDer);
  if (fingerprint !== signature.publicKeySpkiSha256) throw new Error("public key fingerprint does not match the signature");
  if (options.trustedFingerprint !== undefined && fingerprint !== options.trustedFingerprint) {
    throw new Error("public key fingerprint does not match the trusted fingerprint");
  }
  {
    const trust = JSON.parse(await readFile(resolve(options.trustStore), "utf8"));
    if (trust.schemaVersion !== "tavonel.export_trust.v2" || trust.minimumSignatureVersion !== 2 || !Array.isArray(trust.keys)) {
      throw new Error("trust store is not a tavonel.export_trust.v2 document");
    }
    const keys = trust.keys.filter((key) => key?.keyId === signature.keyId && key?.keyVersion === signature.keyVersion);
    const key = keys.length === 1 ? keys[0] : null;
    const issued = Date.parse(signature.issuedAt);
    if (!key || !ACCEPTED_KEY_STATUSES.includes(key.status) || key.algorithm !== "Ed25519" || key.publicKeySpkiSha256 !== fingerprint
      || key.publicKeySpkiDerBase64 !== signature.publicKeySpkiDerBase64 || !instant(key.notBefore) || !instant(key.expiresAt)
      || issued < Date.parse(key.notBefore) || issued >= Date.parse(key.expiresAt)
      || Date.parse(signature.expiresAt) > Date.parse(key.expiresAt)) throw new Error("signature key lifecycle policy rejected the receipt");
  }
  if (digest(payloadBytes) !== signature.signedPayloadSha256) throw new Error("payload digest does not match the signature");
  const signatureBytes = Buffer.from(String(signature.signatureBase64), "base64");
  if (signatureBytes.byteLength !== 64 || signatureBytes.toString("base64") !== signature.signatureBase64) {
    throw new Error("signature is not canonical Ed25519 bytes");
  }
  const header = `${JSON.stringify({
    schemaVersion: signature.schemaVersion, algorithm: signature.algorithm, signatureScope: signature.signatureScope,
    keyId: signature.keyId, keyVersion: signature.keyVersion, issuedAt: signature.issuedAt, expiresAt: signature.expiresAt,
    signedPayloadSha256: signature.signedPayloadSha256,
  })}\n`;
  const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
  if (publicKey.asymmetricKeyType !== "ed25519"
    || !verify(null, Buffer.concat([Buffer.from(header, "utf8"), payloadBytes]), publicKey, signatureBytes)) {
    throw new Error("Ed25519 signature verification failed");
  }
  return { keyId: signature.keyId, keyVersion: signature.keyVersion, fingerprint, signedAt: signature.issuedAt };
}

/** The answer the receipt travelled with must be the answer it signed. */
function checkAnswer(response, payload) {
  const same = (label, left, right) => { if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`answer ${label} does not match the receipt`); };
  same("collection", response.receipt?.collectionId, payload.collectionId);
  same("World state", response.activeWorld?.worldStateId, payload.worldStateId);
  same("manifest digest", response.receipt?.manifestDigest, payload.manifestDigest);
  same("answer mode", response.answerMode, payload.answerMode);
  same("status", response.status, payload.status);
  same("citations", Array.isArray(response.citations) ? response.citations.map((citation) => citation?.evidenceId) : null, payload.citations);
  same("output digest", response.receipt?.outputSha256, payload.outputSha256);
  const recomputed = digest(Buffer.from(canonicalize({
    status: response.status, answer: response.answer, reason: response.reason, citations: response.citations,
  }), "utf8"));
  if (recomputed !== payload.outputSha256) throw new Error("answer text or citations were changed after signing");
}

function fail(message) {
  process.stderr.write(`TAVONEL answer verification failed: ${message}\n`);
  process.exitCode = 1;
}

const options = parseArguments(process.argv.slice(2));
if (!options) {
  fail(`usage: node ${basename(process.argv[1] ?? "tavonel-verify-answer.mjs")} --receipt <answer.json> --trust-store <trust.json> [--trusted-fingerprint sha256:<64 hex>] [--question-file <question.txt>]`);
} else {
  try {
    const document = JSON.parse(await readFile(resolve(options.receipt), "utf8"));
    const response = document && typeof document === "object" && document.signedReceipt ? document : null;
    const signed = response ? response.signedReceipt : document;
    if (!signed || typeof signed.payloadJson !== "string" || !signed.signature) throw new Error("no signedReceipt in the file");
    const payloadBytes = Buffer.from(signed.payloadJson, "utf8");
    const key = await checkSignature(signed.signature, payloadBytes, options);
    const payload = JSON.parse(signed.payloadJson);
    checkPayload(payload, signed.payloadJson);
    if (Math.abs(Date.parse(payload.issuedAt) - Date.parse(key.signedAt)) > ISSUED_AT_TOLERANCE_MS) {
      throw new Error("receipt issuedAt is not the signing time");
    }
    if (response) checkAnswer(response, payload);
    if (options.questionFile) {
      const question = await readFile(resolve(options.questionFile), "utf8");
      // A trailing newline from an editor is not part of the question that was asked.
      if (digest(Buffer.from(question.replace(/\r?\n$/, ""), "utf8")) !== payload.questionSha256) {
        throw new Error("the question does not match the receipt's questionSha256");
      }
    }
    process.stdout.write(`${JSON.stringify({
      ok: true, collectionId: payload.collectionId, worldStateId: payload.worldStateId, status: payload.status,
      citations: payload.citations.length, answerChecked: Boolean(response), questionChecked: Boolean(options.questionFile),
      issuedAt: payload.issuedAt, ...key,
    })}\n`);
  } catch (error) {
    fail(error instanceof Error ? error.message : "unknown verification error");
  }
}
