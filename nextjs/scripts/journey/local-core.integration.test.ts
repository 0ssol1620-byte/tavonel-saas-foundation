import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dispatchProductCoreV2, projectProductCoreV2Candidate,
  type ProductCoreV2CompileResponse,
} from "../../lib/core-runtime-v2";
import type { CollectionOcrInput } from "../../lib/collection-compiler";
import { validatePromotableCollectionArtifact } from "../../lib/collection-download";
import { buildWorldReadModel } from "../../lib/world-read-model";
import { answerGroundedQuestion } from "../../lib/grounded-ask";

const hmac = "synthetic-local-core-test-secret-never-a-deployment-key";
const workspace = process.env.TAVONEL_LOCAL_CORE_TEST_WORKSPACE ?? "pilot-realcore";
if (!/^pilot-[A-Za-z0-9]{1,16}$/.test(workspace)) throw new Error("Invalid synthetic Core workspace");
function exportSyntheticArtifact(name: string, artifact: unknown) {
  const directory = process.env.TAVONEL_LOCAL_CORE_ARTIFACT_OUT;
  if (directory) writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ syntheticOnly: true, workspace, artifact }));
}
let processHandle: ChildProcess | undefined;
let baseUrl = "";
let temporary = "";
let coreDirectory = "";
let python = "";
let releaseDigest = "";

function input(id: string, text: string): CollectionOcrInput {
  const digest = createHash("sha256").update(text).digest("hex");
  const key = `immutable/${workspace}/${workspace}/${id}/${digest}/sanitized.pdf`;
  return { documentId: id, versionKey: digest, inputSha256: `sha256:${digest}`,
    sanitizedKey: key, sourceImmutableKey: key, ocrJsonKey: key.replace("sanitized.pdf", "ocr.json"),
    pageCount: 1, text, regions: [{ regionId: `${id}-page1-region1`, pageIndex0: 0, pageNumber1: 1,
      order: 0, blockType: "paragraph", text, bbox1000: [100, 120, 900, 240],
      confidence: 0.99, authority: "official" }] };
}
const firstInputs = [input("synthetic-policy", "The synthetic company's payment terms are 30 days."),
  input("synthetic-board", "The synthetic board approved the payment policy.")];
const secondInputs = [input("synthetic-policy", "The synthetic company's payment terms are 45 days."), firstInputs[1]!];
let first: ProductCoreV2CompileResponse;

function cleanEnvironment() {
  const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && allowed.has(key.toUpperCase())));
  const sources = readdirSync(path.join(coreDirectory, "packages"), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => path.join(coreDirectory, "packages", entry.name, "src"))
    .filter(existsSync);
  return { ...env, NODE_ENV: "test" as const, PYTHONPATH: sources.join(path.delimiter), PYTHONDONTWRITEBYTECODE: "1",
    TAVONEL_LOCAL_CORE_TEST_HMAC: hmac, TAVONEL_LOCAL_CORE_RELEASE_DIGEST: releaseDigest,
    TAVONEL_LOCAL_CORE_JOURNAL: path.join(temporary, "compile-journal.sqlite") };
}
async function start() {
  const child = spawn(python, [path.resolve(import.meta.dirname, "local-core-server.py")], {
    cwd: import.meta.dirname, env: cleanEnvironment(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  processHandle = child;
  let errors = "";
  child.stderr!.on("data", chunk => { errors = (errors + String(chunk)).slice(-8000); });
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Core startup timeout: ${errors}`)); }, 20_000);
    let stdout = "";
    child.stdout!.on("data", chunk => {
      stdout += String(chunk);
      const line = stdout.split(/\r?\n/)[0];
      if (!line || !stdout.includes("\n")) return;
      try { const ready = JSON.parse(line); clearTimeout(timeout); resolve(ready.port); }
      catch { clearTimeout(timeout); reject(new Error(`Invalid Core readiness: ${stdout}`)); }
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Core exited ${code}: ${errors}`)); });
  });
  baseUrl = `http://127.0.0.1:${port}`;
  expect((await fetch(`${baseUrl}/health`).then(response => response.json())).customerDataEnabled).toBe(false);
}
async function stop() {
  const child = processHandle;
  if (!child || child.exitCode !== null) return;
  await new Promise<void>(resolve => {
    child.once("close", () => { clearTimeout(timeout); resolve(); });
    const timeout = setTimeout(() => child.kill(), 3000);
    void fetch(`${baseUrl}/__local_test_shutdown`, { method: "POST" }).catch(() => child.kill());
  });
  processHandle = undefined;
}
async function compile(inputs: CollectionOcrInput[], previous: Parameters<typeof dispatchProductCoreV2>[4] = null) {
  // The explicit test transport is loopback HTTP. Production env parsing still requires HTTPS.
  const reply = await dispatchProductCoreV2({ url: baseUrl, hmac }, workspace, inputs, new Date(), previous);
  if (!reply.ok) throw new Error(reply.code);
  return reply.result;
}
beforeAll(async () => {
  coreDirectory = process.env.TAVONEL_LOCAL_CORE_DIR ?? "";
  python = process.env.TAVONEL_LOCAL_CORE_PYTHON ?? "";
  if (!coreDirectory || !python || !existsSync(path.join(coreDirectory, "packages/product-core/src")) || !existsSync(python)) {
    throw new Error("Set TAVONEL_LOCAL_CORE_DIR to an isolated Core clone and TAVONEL_LOCAL_CORE_PYTHON to a Python executable with FastAPI/httpx. No live fallback is allowed.");
  }
  const coreCommit = execFileSync("git", ["--git-dir", path.join(coreDirectory, ".git"), "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
  releaseDigest = `sha256:${createHash("sha256").update(coreCommit).digest("hex")}`;
  temporary = mkdtempSync(path.join(tmpdir(), "tavonel-real-core-journey-"));
  await start();
});
afterAll(async () => { await stop(); if (temporary) rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

describe.sequential("real Foundation to local Python Core boundary", () => {
  it("compiles signed HTTP input into promotable evidence with the computed Core validation contract", async () => {
    first = await compile(firstInputs);
    expect(first.status).toBe("completed");
    expect(first.receipt.coreReleaseDigest).toBe(releaseDigest);
    expect(first.receipt.equivalence).toBe("not_run");
    expect(first.candidate.units.length).toBeGreaterThan(0);
    expect(first.candidate.package.files.find(file => file.path === "rag/chunks.jsonl")?.content).toContain("30 days");
    expect(first.candidate.validation.immutableInputsOnly).toBe(true);
    const projected = projectProductCoreV2Candidate(first, firstInputs, true)!;
    expect(projected).not.toBeNull();
    const artifact = { ...projected, coreExecution: { status: first.status, runtime: first.runtime,
      worldStateId: first.candidate.worldStateId, receipt: first.receipt } };
    expect(validatePromotableCollectionArtifact(artifact, artifact.collectionId)).not.toBeNull();
    expect(buildWorldReadModel(artifact, artifact.collectionId)!.evidence.length).toBeGreaterThan(0);
    expect(answerGroundedQuestion(artifact, "What are the payment terms?")!.answer).toContain("30 days");
    exportSyntheticArtifact("initial", artifact);
    // Removing the actual authority's check must still refuse publication.
    const incomplete = structuredClone(first);
    delete incomplete.candidate.validation.immutableInputsOnly;
    expect(projectProductCoreV2Candidate(incomplete, firstInputs, true)).toBeNull();
    const failed = structuredClone(first);
    failed.candidate.validation.immutableInputsOnly = false;
    expect(projectProductCoreV2Candidate(failed, firstInputs, true)).toBeNull();
    for (const file of first.candidate.package.files) {
      expect(`sha256:${createHash("sha256").update(file.content).digest("hex")}`).toBe(file.sha256);
    }
  });
  it("replays the durable compile after process restart with a newly bound attempt receipt", async () => {
    await stop(); await start();
    const replay = await compile(firstInputs);
    expect(replay.candidate).toEqual(first.candidate);
    expect(replay.receipt.outputSha256).toBe(first.receipt.outputSha256);
    expect(replay.receipt.requestId).not.toBe(first.receipt.requestId);
  });
  it("runs a real incremental parent and full-rebuild equivalence check across two revisions", async () => {
    // Use the real prior units, never reconstruct a previous world from grouped chunks.
    const parent = { worldStateId: first.candidate.worldStateId, manifestDigest: first.candidate.manifestDigest,
      units: first.candidate.units as Array<Record<string, unknown>>, artifactHashes: first.candidate.artifactHashes };
    const second = await compile(secondInputs, parent);
    expect(second.status).toBe("completed");
    expect(second.candidate.parentWorldStateId).toBe(first.candidate.worldStateId);
    expect(second.receipt.equivalence).toBe("passed");
    expect(second.candidate.canonicalKnowledgeModel.collectionId).toBe(first.candidate.canonicalKnowledgeModel.collectionId);
    expect(second.candidate.manifestDigest).not.toBe(first.candidate.manifestDigest);
    expect(second.candidate.package.files.find(file => file.path === "rag/chunks.jsonl")?.content).toContain("45 days");
    expect(second.candidate.validation.immutableInputsOnly).toBe(true);
    const projected = projectProductCoreV2Candidate(second, secondInputs, true)!;
    expect(projected).not.toBeNull();
    const artifact = { ...projected, coreExecution: { status: second.status, runtime: second.runtime,
      worldStateId: second.candidate.worldStateId, receipt: second.receipt } };
    expect(validatePromotableCollectionArtifact(artifact, artifact.collectionId)).not.toBeNull();
    expect(answerGroundedQuestion(artifact, "What are the payment terms?")!.answer).toContain("45 days");
    exportSyntheticArtifact("updated", artifact);
  });
  it("refuses an unauthenticated HTTP caller and a mismatched HMAC", async () => {
    const anonymous = await fetch(`${baseUrl}/v2/compile`, { method: "POST", body: "{}" });
    expect(anonymous.status).toBe(401);
    const refused = await dispatchProductCoreV2({ url: baseUrl, hmac: "untrusted-synthetic-fixture-secret-32-bytes" }, workspace, firstInputs);
    expect(refused.ok).toBe(false);
  });
  it("refuses a real Core response changed in transit without rebinding the output digest", async () => {
    const refused = await dispatchProductCoreV2({ url: `${baseUrl}/__local_test_tamper`, hmac }, workspace, firstInputs);
    expect(refused).toEqual({ ok: false, code: "CORE_V2_RECEIPT_INVALID" });
  });
});
