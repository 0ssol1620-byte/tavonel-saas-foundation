import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  W1-A5 (PROGRAM-2026-11-04 §4.A "A5"): the signed answer receipt.

  Proved here: the receipt holds the allowlisted fields and never the question; `off` and
  `shadow` change nothing a caller sees; `on` inside the canary cohort adds `signedReceipt`, and
  with no usable signer refuses the answer with 503 ANSWER_SIGNING_UNAVAILABLE instead of sending
  it unsigned; an unknown mode is a 503 too. The published verifier accepts a real receipt and
  refuses a forged key, a tampered payload, an edited answer, another scope and a wrong question.

  Not proved: the signing-time p95 on production hardware. Shadow logs it; A5's shadow step reads it.
*/

const { authorize, revalidate, activeWorld, pipeline, sourceIds, sourceAccess } = vi.hoisted(() => ({
  authorize: vi.fn(), revalidate: vi.fn(), activeWorld: vi.fn(), pipeline: vi.fn(), sourceIds: vi.fn(), sourceAccess: vi.fn(),
}));
vi.mock("@/lib/active-world-source-access", () => ({ loadActiveWorldSourceIds: sourceIds }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: sourceAccess, checkConnectorSourceAccessForViewer: sourceAccess }));
vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
  revalidateFoundationAuthorization: revalidate,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: activeWorld,
}));
vi.mock("@/lib/retrieval-pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-pipeline")>()),
  runRetrievalPipeline: pipeline,
}));

import { POST as ask } from "../app/api/collections/[id]/ask/route";
import { applyAnswerReceipt, readAnswerReceiptMode, readAnswerReceiptSigner, signAnswerReceipt } from "./answer-receipt-signing";
import { buildContextPacket } from "./context-packet";
import { readExportSignerEnv } from "./export-signing";
import { signCompileReceipt } from "./compile-receipt-signing";
import { resetWorkspaceCostGuard } from "./workspace-cost-guard";

const WORKSPACE = "pilot-answer";
const COLLECTION = `collection-${"a".repeat(32)}`;
const DIGEST = `sha256:${"d".repeat(64)}`;
const QUESTION = "What is the notice period?";
const params = Promise.resolve({ id: COLLECTION });
const verifier = resolve(import.meta.dirname, "../public/developer/tavonel-verify-answer.mjs");
const scratch = mkdtempSync(join(tmpdir(), "tavonel-answer-receipt-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function keyEnv(keyId = "foundation-answers-2026", lifecycle: { status?: string; expiresAt?: string } = {}) {
  const pair = generateKeyPairSync("ed25519");
  const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
  const trust = {
    schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2, activeKeyId: keyId,
    keys: [{
      keyId, keyVersion: 1, algorithm: "Ed25519", status: lifecycle.status ?? "active",
      notBefore: "2026-01-01T00:00:00.000Z", expiresAt: lifecycle.expiresAt ?? "2030-01-01T00:00:00.000Z",
      publicKeySpkiDerBase64: spki.toString("base64"),
      publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
    }],
  };
  return {
    trust,
    env: {
      TAVONEL_EXPORT_SIGNING_KEY_ID: keyId,
      TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify(trust),
    },
  };
}
const KEY = keyEnv();
const OTHER = keyEnv();

let seq = 0;
function file(name: string, value: unknown) {
  const path = join(scratch, `${seq++}-${name}`);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}
function verify(receipt: unknown, extra: string[] = [], trust: unknown = KEY.trust) {
  const run = spawnSync(process.execPath, [verifier, "--receipt", file("receipt.json", receipt), "--trust-store", file("trust.json", trust), ...extra], { encoding: "utf8", timeout: 10_000 });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function request() {
  return new Request(`https://tavonel.test/api/collections/${COLLECTION}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer tvnl_live_probe" },
    body: JSON.stringify({ question: QUESTION }),
  });
}

function stubKey(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkspaceCostGuard();
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", WORKSPACE);
  sourceIds.mockResolvedValue({ ok: true, documentIds: ["source-fixture"] });
  sourceAccess.mockResolvedValue({ ok: true });
  revalidate.mockImplementation(async (_request, expected) => ({ ok: true, principal: expected }));
  authorize.mockResolvedValue({
    ok: true,
    principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: "user-1", scopes: [], authorizationRevision: 7, workspaceRole: "owner" },
  });
  activeWorld.mockResolvedValue({
    ok: true,
    world: { manifestDigest: DIGEST, revision: 3, worldStateId: "world-state-1", candidateObjectKey: `candidates/${WORKSPACE}/${COLLECTION}/candidate.json` },
  });
  const packet = buildContextPacket([{
    unitId: "unit-notice", text: "The notice period is ninety days.", claimIds: [], entityIds: [], sourceVersionId: "version-a",
    evidenceIds: ["evidence-notice"], pageNumber1: 2, bbox1000: [10, 20, 900, 80], authority: "official", lexicalRank: 1,
  }], { worldId: COLLECTION, worldVersion: "3", retrievalProfile: "p", question: QUESTION });
  pipeline.mockResolvedValue({
    ok: true, packet,
    diagnostics: { compileRunId: "run-1", retrievalProfileId: "p", rerankerApplied: false, gateRejections: [], degradations: [] },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetWorkspaceCostGuard();
});

describe("TAVONEL_ASK_RECEIPT_SIGNED", () => {
  it("reads off, shadow and on, and nothing else", () => {
    for (const value of [undefined, "", "off"]) expect(readAnswerReceiptMode({ TAVONEL_ASK_RECEIPT_SIGNED: value })).toBe("off");
    expect(readAnswerReceiptMode({ TAVONEL_ASK_RECEIPT_SIGNED: "shadow" })).toBe("shadow");
    expect(readAnswerReceiptMode({ TAVONEL_ASK_RECEIPT_SIGNED: "on" })).toBe("on");
    for (const value of ["ON", "true", "1", " on"]) expect(readAnswerReceiptMode({ TAVONEL_ASK_RECEIPT_SIGNED: value }), value).toBeNull();
  });

  it("off: the answer is unchanged and nothing is signed", async () => {
    stubKey(KEY.env);
    const response = await ask(request(), { params });
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("signedReceipt");
  });

  it("shadow: computes and times the receipt, logs only the outcome, and adds nothing to the answer", async () => {
    stubKey(KEY.env);
    vi.stubEnv("TAVONEL_ASK_RECEIPT_SIGNED", "shadow");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await ask(request(), { params });
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("signedReceipt");
      const lines = info.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("answer_receipt_sli"));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ sli: "tavonel.answer_receipt_sli.v1", mode: "shadow", outcome: "signed" });
      expect(lines[0]).not.toContain(QUESTION);
    } finally { info.mockRestore(); }
  });

  it("shadow with no signer still answers: a shadow failure changes nothing a caller sees", async () => {
    vi.stubEnv("TAVONEL_ASK_RECEIPT_SIGNED", "shadow");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await ask(request(), { params });
      expect(response.status).toBe(200);
      expect(info.mock.calls.map(([line]) => String(line)).some((line) => line.includes("\"signer_unavailable\""))).toBe(true);
    } finally { info.mockRestore(); }
  });

  it("an unknown mode refuses the answer rather than guessing one", async () => {
    stubKey(KEY.env);
    vi.stubEnv("TAVONEL_ASK_RECEIPT_SIGNED", "yes");
    const response = await ask(request(), { params });
    expect([response.status, (await response.json()).code]).toEqual([503, "ANSWER_RECEIPT_MODE_INVALID"]);
  });
});

describe("on, inside the canary cohort", () => {
  it("adds a receipt over the allowlisted fields, with the question's hash and never its text", async () => {
    stubKey(KEY.env);
    vi.stubEnv("TAVONEL_ASK_RECEIPT_SIGNED", "on");
    const response = await ask(request(), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    const payload = JSON.parse(body.signedReceipt.payloadJson);
    expect(Object.keys(payload)).toEqual(["schemaVersion", "collectionId", "worldStateId", "manifestDigest", "questionSha256",
      "answerMode", "status", "citations", "answerability", "outputSha256", "issuedAt"]);
    expect(payload).toMatchObject({
      schemaVersion: "tavonel.answer_receipt.v1", collectionId: COLLECTION, worldStateId: "world-state-1", manifestDigest: DIGEST,
      questionSha256: `sha256:${createHash("sha256").update(QUESTION).digest("hex")}`, answerMode: "evidence_excerpts",
      status: "grounded", citations: ["evidence-notice"], answerability: null, outputSha256: body.receipt.outputSha256,
    });
    expect(body.signedReceipt.payloadJson).not.toContain("notice period");
    expect(body.signedReceipt.signature).toMatchObject({ schemaVersion: "tavonel.export_signature.v2", signatureScope: "tavonel.signed_answer_receipt.v1" });

    const ok = verify(body, ["--question-file", file("q.txt", `${QUESTION}\n`)]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, answerChecked: true, questionChecked: true, citations: 1 });
    expect(verify(body.signedReceipt).status).toBe(0);
    expect(verify(body, ["--question-file", file("q.txt", "Another question?")]).stderr).toContain("questionSha256");
  });

  it("refuses the answer with 503 ANSWER_SIGNING_UNAVAILABLE when no lifecycle signer exists, never sending it unsigned", async () => {
    vi.stubEnv("TAVONEL_ASK_RECEIPT_SIGNED", "on");
    const missing = await ask(request(), { params });
    expect([missing.status, await missing.json()]).toEqual([503, { code: "ANSWER_SIGNING_UNAVAILABLE" }]);
    // A key with no trust store is a v1 signer: nobody could verify its receipt later, so it is no signer.
    vi.stubEnv("TAVONEL_EXPORT_SIGNING_KEY_ID", KEY.env.TAVONEL_EXPORT_SIGNING_KEY_ID);
    vi.stubEnv("TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64", KEY.env.TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64);
    const v1 = await ask(request(), { params });
    expect([v1.status, await v1.json()]).toEqual([503, { code: "ANSWER_SIGNING_UNAVAILABLE" }]);
  });

  it("on with a cohort that cannot be read refuses (503), never answers unsigned (R1 M3)", async () => {
    stubKey(KEY.env);
    vi.stubEnv("TAVONEL_ASK_RECEIPT_SIGNED", "on");
    for (const cohort of [undefined, "", "pilot-a,", `${WORKSPACE},pilot-b,pilot-c,pilot-d`]) {
      vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", cohort as string);
      expect(applyAnswerReceipt({ workspaceKey: WORKSPACE, collectionId: COLLECTION, question: QUESTION, body: { code: "X" } }), String(cohort))
        .toEqual({ ok: false, code: "REMOTE_MCP_COHORT_CONFIG_INVALID" });
    }
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", undefined as unknown as string);
    const response = await ask(request(), { params });
    expect([response.status, await response.json()]).toEqual([503, { code: "REMOTE_MCP_COHORT_CONFIG_INVALID" }]);
  });

  it("outside the cohort, on behaves as shadow", async () => {
    stubKey(KEY.env);
    vi.stubEnv("TAVONEL_ASK_RECEIPT_SIGNED", "on");
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-other");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(applyAnswerReceipt({ workspaceKey: WORKSPACE, collectionId: COLLECTION, question: QUESTION, body: { code: "X" } }))
        .toEqual({ ok: true, body: { code: "X" } });
    } finally { info.mockRestore(); }
  });
});

describe("the published verifier refuses what it must", () => {
  async function signedBody() {
    stubKey(KEY.env);
    vi.stubEnv("TAVONEL_ASK_RECEIPT_SIGNED", "on");
    return (await ask(request(), { params })).json();
  }

  it("refuses a receipt signed by a key the trust store does not hold", async () => {
    const body = await signedBody();
    const forged = verify(body, [], OTHER.trust);
    expect(forged.status).toBe(1);
    expect(forged.stderr).toContain("lifecycle policy");
    // A fingerprint alone cannot see revocation, so it is not accepted as the trust anchor (R1 M7).
    const fingerprintOnly = spawnSync(process.execPath, [verifier, "--receipt", file("r.json", body), "--trusted-fingerprint", KEY.trust.keys[0]!.publicKeySpkiSha256], { encoding: "utf8" });
    expect([fingerprintOnly.status, fingerprintOnly.stderr]).toEqual([1, expect.stringContaining("usage")]);
    expect(verify(body, ["--trusted-fingerprint", KEY.trust.keys[0]!.publicKeySpkiSha256]).status).toBe(0);
    expect(verify(body, ["--trusted-fingerprint", OTHER.trust.keys[0]!.publicKeySpkiSha256]).stderr).toContain("trusted fingerprint");
    // A receipt re-signed with another key but keeping the trusted key's identity fields.
    const otherSigner = readAnswerReceiptSigner(OTHER.env)!;
    const resigned = otherSigner.signPayload(Buffer.from(body.signedReceipt.payloadJson, "utf8"));
    expect(verify({ ...body, signedReceipt: { ...body.signedReceipt, signature: { ...resigned, keyId: body.signedReceipt.signature.keyId } } }).status).toBe(1);
  });

  it("refuses one field changed in the payload, the answer text edited, and a citation dropped", async () => {
    const body = await signedBody();
    const payload = JSON.parse(body.signedReceipt.payloadJson);
    const tampered = { ...body, signedReceipt: { ...body.signedReceipt, payloadJson: JSON.stringify({ ...payload, status: "abstained" }) } };
    expect(verify(tampered).stderr).toContain("payload digest");
    const edited = verify({ ...body, answer: `${body.answer} Unless renewed.` });
    expect(edited.stderr).toContain("changed after signing");
    expect(verify({ ...body, citations: [] }).stderr).toContain("citations");
    const otherWorld = verify({ ...body, activeWorld: { ...body.activeWorld, worldStateId: "world-state-2" } });
    expect(otherWorld.stderr).toContain("World state");
  });

  it("refuses a signature from another scope, and a v1 signature", async () => {
    const body = await signedBody();
    const compileSigner = readExportSignerEnv(KEY.env, new Date(), "tavonel.signed_compile_receipt.v1")!;
    const compile = signCompileReceipt(compileSigner, {
      tenantId: "t", workspaceId: "t", collectionId: COLLECTION, manifestDigest: DIGEST, lifecycle: "candidate", coreRuntime: "core-v2",
      worldStateId: null, coreRequestId: "req-1", coreOutputSha256: DIGEST, customerDataGateReceiptSha256: DIGEST,
      sourceDocuments: [{ documentId: "doc-1", versionKey: "a".repeat(64) }], compiledAt: "2026-11-04T00:00:00.000Z",
    })!;
    const crossScope = compileSigner.signPayload(Buffer.from(body.signedReceipt.payloadJson, "utf8"));
    expect(compile).not.toBeNull();
    expect(verify({ ...body, signedReceipt: { ...body.signedReceipt, signature: crossScope } }).stderr).toContain("scope");
    expect(verify({ ...body, signedReceipt: { ...body.signedReceipt, signature: { ...body.signedReceipt.signature, schemaVersion: "tavonel.export_signature.v1" } } }).status).toBe(1);
    expect(verify({ payloadJson: "{}", signature: null }).status).toBe(1);
  });
});

describe("the verifier's key lifecycle policy (review R1 M7)", () => {
  const DAY = 86_400_000;
  async function signedBody() {
    stubKey(KEY.env);
    vi.stubEnv("TAVONEL_ASK_RECEIPT_SIGNED", "on");
    return (await ask(request(), { params })).json();
  }
  /** The body's receipt signed again at `at` with `env`'s key, the payload's issuedAt set to `at` and then `edit`ed. */
  function resign(body: { signedReceipt: { payloadJson: string } }, env: Record<string, string>, at: Date, edit = (payload: Record<string, unknown>) => payload) {
    const payload = edit({ ...JSON.parse(body.signedReceipt.payloadJson), issuedAt: at.toISOString() });
    const signer = readAnswerReceiptSigner(env, at);
    expect(signer).not.toBeNull();
    return { ...body, signedReceipt: signAnswerReceipt(signer!, payload as never)! };
  }

  it("B: a key that expired after signing still verifies the receipt it signed inside its window", async () => {
    const lapsed = keyEnv("foundation-answers-lapsed", { expiresAt: new Date(Date.now() - DAY).toISOString() });
    const body = resign(await signedBody(), lapsed.env, new Date(Date.now() - 10 * DAY));
    expect(verify(body, [], lapsed.trust).status).toBe(0);
  });

  it("C: refuses a payload issuedAt that is not the signing time", async () => {
    const body = resign(await signedBody(), KEY.env, new Date(), (payload) => ({ ...payload, issuedAt: "2026-02-01T00:00:00.000Z" }));
    expect(verify(body).stderr).toContain("not the signing time");
  });

  it("D: refuses a signing time in the future", async () => {
    const body = resign(await signedBody(), KEY.env, new Date(Date.now() + 200 * DAY));
    expect(verify(body).stderr).toContain("in the future");
  });

  it("F: refuses a revoked key, with or without a fingerprint pin", async () => {
    const body = await signedBody();
    const revoked = { ...KEY.trust, keys: [{ ...KEY.trust.keys[0]!, status: "revoked" }] };
    expect(verify(body, [], revoked).stderr).toContain("lifecycle policy");
    expect(verify(body, ["--trusted-fingerprint", KEY.trust.keys[0]!.publicKeySpkiSha256], revoked).stderr).toContain("lifecycle policy");
  });

  it("G: refuses a key status it does not know, and accepts retired", async () => {
    const body = await signedBody();
    expect(verify(body, [], { ...KEY.trust, keys: [{ ...KEY.trust.keys[0]!, status: "pending" }] }).stderr).toContain("lifecycle policy");
    expect(verify(body, [], { ...KEY.trust, keys: [{ ...KEY.trust.keys[0]!, status: "retired" }] }).status).toBe(0);
  });
});
