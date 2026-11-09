#!/usr/bin/env node
/**
 * E2 answerability gate runner (PREREG-E2.json). From nextjs/:
 *
 *   node --experimental-strip-types eval/ask-quality/e2/run_e2.mjs --phase calibration
 *   # commit the calibration receipt, then:
 *   node --experimental-strip-types eval/ask-quality/e2/run_e2.mjs --phase holdout --calibration <receipt.json>
 *
 * Fail-closed: the E1 question sets must match the E1 PREREG; every pinned code file and 10-K must
 * match its PREREG-E2 sha256 (code is hashed with CRLF read as LF, so a Windows checkout agrees with
 * CI); the calibration phase never replays a holdout question; the holdout phase refuses unless the
 * calibration receipt and PREREG-E2.json are committed and unmodified at HEAD, the receipt names this
 * PREREG, and no holdout receipt exists yet -- the first holdout receipt is the verdict.
 * No network, no model, no paid call.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEXTJS = path.resolve(HERE, "../../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lfSha256 = (file) => sha256(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
const git = (args) => execFileSync("git", args, { cwd: HERE, encoding: "utf8" }).trim();
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

function committedUnchanged(file) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", file], { cwd: HERE, stdio: "ignore" });
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", file], { cwd: HERE, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await import("../../../scripts/router/register-ts-loader.mjs");
  const phase = argument("--phase");
  if (phase !== "calibration" && phase !== "holdout") throw new Error("--phase calibration|holdout is required");

  const preregPath = path.join(HERE, "PREREG-E2.json");
  const preregBytes = readFileSync(preregPath);
  const prereg = JSON.parse(preregBytes.toString("utf8"));
  const preregSha256 = sha256(preregBytes);
  // Pre-registration first: no phase reads a single verdict before PREREG-E2.json is committed as it stands.
  if (!committedUnchanged(preregPath)) throw new Error("PREREG-E2.json must be committed and unmodified at HEAD before any phase runs");

  for (const [file, expected] of Object.entries(prereg.pinnedCode)) {
    const actual = lfSha256(path.join(NEXTJS, file));
    if (actual !== expected) throw new Error(`${file}: sha256 ${actual} is not the pre-registered ${expected}`);
  }
  const { loadQuestionSets } = await import("../run_eval.mjs");
  const { preregSha256: e1Sha256, questions } = loadQuestionSets(path.join(HERE, "..", "PREREG.json"));
  if (e1Sha256 !== prereg.inputs.e1Prereg.sha256) throw new Error(`E1 PREREG ${e1Sha256} is not the pinned ${prereg.inputs.e1Prereg.sha256}`);
  const holdoutIds = questions.filter((question) => question.split === "holdout").map((question) => question.id).sort();
  if (sha256(holdoutIds.join("\n")) !== prereg.split.holdoutIdsSha256 || holdoutIds.length !== prereg.split.holdoutN) {
    throw new Error("the holdout split is not the pre-registered one");
  }

  const e2 = await import("./e2.ts");
  let threshold = null;
  let calibrationRef = null;
  if (phase === "holdout") {
    const receiptPath = argument("--calibration");
    if (!receiptPath) throw new Error("--calibration <committed calibration receipt> is required");
    if (!committedUnchanged(path.resolve(receiptPath))) {
      throw new Error("the calibration receipt must be committed and unmodified at HEAD before the holdout is read");
    }
    const receiptsDir = path.join(HERE, "receipts");
    if (existsSync(receiptsDir) && readdirSync(receiptsDir).some((name) => name.startsWith("holdout-"))) {
      throw new Error("a holdout receipt already exists; the first one is the verdict and is never re-run");
    }
    const calibration = JSON.parse(readFileSync(receiptPath, "utf8"));
    if (calibration.phase !== "calibration" || calibration.preregSha256 !== preregSha256) {
      throw new Error("the calibration receipt was not produced under this PREREG-E2");
    }
    threshold = calibration.calibration.threshold;
    calibrationRef = { path: path.relative(NEXTJS, path.resolve(receiptPath)).replace(/\\/g, "/"), sha256: sha256(readFileSync(receiptPath)), gitCommit: git(["log", "-1", "--format=%H", "--", path.resolve(receiptPath)]) };
  }

  const cacheDir = path.resolve(argument("--cache") ?? path.join(HERE, "..", "cache"));
  const artifacts = new Map();
  for (const corpus of prereg.corpus.documents) {
    const documents = corpus.filings.map((filing) => {
      const bytes = readFileSync(path.join(cacheDir, filing.cacheName));
      if (sha256(bytes) !== filing.sha256) throw new Error(`${filing.cacheName}: not the pinned 10-K`);
      return { accession: filing.accession, html: bytes.toString("utf8") };
    });
    artifacts.set(corpus.corpusRef, e2.buildCorpusArtifact(corpus.corpusRef, documents));
  }

  const selected = questions.filter((question) => question.split === phase && question.set !== "human");
  const replays = selected.map((question) => {
    const artifact = artifacts.get(question.corpusRef);
    if (!artifact) throw new Error(`${question.id}: no corpus for ${question.corpusRef}`);
    return e2.replayQuestion(question, artifact);
  });

  const runStartedAt = new Date().toISOString();
  let body;
  if (phase === "calibration") {
    const calibration = e2.chooseThreshold(replays);
    const { metrics, statusCounts, rows } = e2.holdoutReport(replays, calibration.threshold);
    body = { calibration, calibrationSplitMetrics: metrics, statusCounts, rows };
  } else {
    body = { threshold, calibrationReceipt: calibrationRef, ...e2.holdoutReport(replays, threshold) };
  }
  const receipt = {
    schema: "tavonel.ask_answerability_e2_receipt.v1",
    status: "IMPLEMENTED_NOT_PROVEN",
    phase,
    preregSha256,
    e1PreregSha256: e1Sha256,
    retriever: "lib/grounded-ask.ts answerGroundedQuestion (excerpt-concatenation-fallback), offline replay over chunked 10-K HTML",
    corpora: [...artifacts].map(([corpusRef, artifact]) => ({ corpusRef, chunks: artifact.chunkCount, manifestDigest: artifact.manifestDigest })),
    questionsReplayed: replays.length,
    gitSha: git(["rev-parse", "HEAD"]),
    gitDirty: git(["status", "--porcelain"]).length > 0,
    runStartedAt,
    ...body,
  };
  const { canonicalJson } = await import("../score.ts");
  receipt.receiptSha256 = sha256(canonicalJson(receipt));
  const outDir = path.join(HERE, "receipts");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${phase}-${runStartedAt.replace(/[:.]/g, "")}-${receipt.receiptSha256.slice(0, 12)}.json`);
  writeFileSync(file, `${JSON.stringify(receipt, null, 1)}\n`, { flag: "wx" });
  const summary = phase === "calibration"
    ? { threshold: body.calibration.threshold, constraintMet: body.calibration.constraintMet, replayed: replays.length }
    : { verdict: body.verdict, criteria: body.criteria, replayed: replays.length };
  console.log(JSON.stringify(summary, null, 1));
  console.log(`wrote ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
