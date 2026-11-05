#!/usr/bin/env node
/**
 * E1 ask-quality runner. From nextjs/:
 *
 *   # CI / harness check: the fixture answerer, no network
 *   node --experimental-strip-types eval/ask-quality/run_eval.mjs --answerer fixture
 *
 *   # the baseline: the evidence_excerpts Ask path of a NON-production deployment
 *   TAVONEL_EVAL_WORKSPACE_TOKEN=<workspace API token> \
 *   node --experimental-strip-types eval/ask-quality/run_eval.mjs --answerer evidence-excerpts \
 *     --base-url http://localhost:3000 --collections <corpusRef -> collectionId map.json> \
 *     [--allow-host <exact non-loopback host> ...]
 *
 * Fail-closed rules: a question file whose sha256 or size differs from PREREG.json stops the run;
 * a set PREREG has not pinned (sha256 null) is skipped and the receipt says NOT_FROZEN; a corpusRef
 * with no collection, a non-200 response or an answerMode other than evidence_excerpts aborts the
 * run with no receipt -- an operational failure is not an abstention and is never scored as one.
 * Hosts: loopback only unless --allow-host names one, production never (live-adapter.ts).
 * The token is read from the environment only and is never written anywhere.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Load every question set PREREG names, verifying each file against its pinned sha256 and size. */
export function loadQuestionSets(preregPath = path.join(HERE, "PREREG.json")) {
  const preregBytes = readFileSync(preregPath);
  const prereg = JSON.parse(preregBytes.toString("utf8"));
  const sets = [];
  const questions = [];
  for (const entry of prereg.questionSets) {
    if (entry.sha256 === null) {
      sets.push({ id: entry.id, path: entry.path, sha256: null, status: "NOT_FROZEN", questionsScored: 0 });
      continue;
    }
    const bytes = readFileSync(path.resolve(path.dirname(preregPath), entry.path));
    const actual = sha256(bytes);
    if (actual !== entry.sha256) throw new Error(`${entry.path}: sha256 ${actual} is not the pre-registered ${entry.sha256}`);
    const file = JSON.parse(bytes.toString("utf8"));
    // A human row a person has not verified is never scored, even inside a frozen file.
    const scored = file.questions.filter((question) => question.set !== "human" || question.humanVerified === true);
    if (scored.length !== entry.n) throw new Error(`${entry.path}: ${scored.length} scorable questions, PREREG says ${entry.n}`);
    sets.push({ id: entry.id, path: entry.path, sha256: actual, status: "FROZEN", questionsScored: scored.length });
    questions.push(...scored);
  }
  return { prereg, preregSha256: sha256(preregBytes), sets, questions };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const argumentsNamed = (name) => process.argv.flatMap((value, index) => (value === name ? [process.argv[index + 1]] : []));

function git(args) {
  return execFileSync("git", args, { cwd: HERE, encoding: "utf8" }).trim();
}

async function main() {
  // Node's resolver never adds `.ts`; score.ts imports ../ask-eval/metrics extensionlessly.
  await import("../../scripts/router/register-ts-loader.mjs");
  const score = await import("./score.ts");
  const { preregSha256, sets, questions } = loadQuestionSets(argument("--prereg"));
  const kind = argument("--answerer") ?? "fixture";
  let answerer;
  if (kind === "fixture") answerer = score.createFixtureAnswerer(questions);
  else if (kind === "evidence-excerpts") {
    const map = argument("--collections");
    if (!map) throw new Error("--collections <map.json> is required for the live answerer");
    const { createEvidenceExcerptsAnswerer } = await import("./live-adapter.ts");
    answerer = createEvidenceExcerptsAnswerer({
      baseUrl: argument("--base-url"),
      token: process.env.TAVONEL_EVAL_WORKSPACE_TOKEN,
      collections: JSON.parse(readFileSync(map, "utf8")),
      allowHosts: argumentsNamed("--allow-host"),
    });
  } else throw new Error(`unknown --answerer ${kind}`);

  const runStartedAt = new Date().toISOString();
  const rows = await score.runEval(questions, answerer);
  const receipt = score.buildReceipt({
    preregSha256, questionSets: sets, answerer: { id: answerer.id, kind: answerer.kind },
    gitSha: git(["rev-parse", "HEAD"]), gitDirty: git(["status", "--porcelain"]).length > 0, runStartedAt, rows,
  });
  const errors = score.validateReceipt(receipt);
  if (errors.length > 0) throw new Error(`receipt failed validation: ${errors.join(", ")}`);
  const outDir = argument("--out") ?? path.join(HERE, "results");
  mkdirSync(outDir, { recursive: true });
  // Run time and receipt digest in the name, written with "wx": a later run never overwrites an earlier receipt.
  const stem = path.join(outDir, `ask-quality-${answerer.id}-${runStartedAt.replace(/[:.]/g, "")}-${receipt.receiptSha256.slice(0, 12)}`);
  writeFileSync(`${stem}.json`, `${JSON.stringify(receipt, null, 1)}\n`, { flag: "wx" });
  writeFileSync(`${stem}.md`, score.renderMarkdown(receipt), { flag: "wx" });
  console.log(score.renderMarkdown(receipt));
  console.log(`wrote ${stem}.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
