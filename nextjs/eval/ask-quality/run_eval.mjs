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
 *     --base-url http://localhost:3000 --collections <corpusRef -> collectionId map.json>
 *
 * Fail-closed rules: a question file whose sha256 differs from PREREG.json stops the run; a set
 * PREREG has not pinned (sha256 null) is skipped and the receipt says NOT_FROZEN; a corpusRef with
 * no collection, a non-200 response or an answerMode other than evidence_excerpts aborts the run
 * with no receipt -- an operational failure is not an abstention and is never scored as one.
 * The token is read from the environment only and is never written anywhere.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Load every question set PREREG names, verifying each file against its pinned sha256. */
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
    const bytes = readFileSync(path.join(path.dirname(preregPath), entry.path));
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

/** Hosts this harness never sends a question to. Measuring production is not an E1 lane's call. */
export const PRODUCTION_HOSTS = [/^(?:www\.)?tavonel\.com$/, /\.tavonel\.com$/, /^tavonel-saas-foundation\.vercel\.app$/];

/** The baseline adapter: POST /api/v1/collections/{id}/ask, answerMode must be evidence_excerpts. */
export function createEvidenceExcerptsAnswerer({ baseUrl, token, collections, fetchImpl = fetch, now = () => performance.now() }) {
  if (!token) throw new Error("TAVONEL_EVAL_WORKSPACE_TOKEN is not set");
  if (!baseUrl) throw new Error("--base-url is required for the live answerer");
  const host = new URL(baseUrl).hostname;
  if (PRODUCTION_HOSTS.some((pattern) => pattern.test(host))) throw new Error(`refusing production host ${host}`);
  return {
    id: "evidence-excerpts-http",
    kind: "live",
    async ask(question, corpusRef) {
      const collectionId = collections[corpusRef];
      if (!collectionId) throw new Error(`no collection mapped for ${corpusRef}`);
      const url = new URL(`/api/v1/collections/${encodeURIComponent(collectionId)}/ask`, baseUrl);
      for (let attempt = 0; ; attempt += 1) {
        const started = now();
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ question }),
        });
        const latencyMs = Math.round(now() - started);
        if (response.status === 429 && attempt < 3) {
          const wait = Math.min(60, Number(response.headers.get("retry-after") ?? "5") || 5);
          await new Promise((resolve) => setTimeout(resolve, wait * 1000));
          continue;
        }
        const body = await response.json().catch(() => null);
        if (response.status !== 200 || body === null) throw new Error(`ask ${corpusRef}: HTTP ${response.status} ${body?.code ?? ""}`.trim());
        if (body.answerMode !== "evidence_excerpts") throw new Error(`ask ${corpusRef}: answerMode ${body.answerMode}, the baseline is evidence_excerpts`);
        return {
          answer: typeof body.answer === "string" ? body.answer : "",
          numeric: null,
          // The route exposes a 420-character `excerpt` per citation; that preview is what is scored.
          citations: (body.citations ?? []).map((citation) => ({
            text: typeof citation.excerpt === "string" ? citation.excerpt : "",
            evidenceId: citation.evidenceId ?? null,
            pageNumber1: citation.pageNumber1 ?? null,
          })),
          abstained: body.status !== "grounded",
          latencyMs,
          meta: { code: body.code ?? null, retrievalPath: body.retrievalPath ?? null, answerMode: body.answerMode, reason: body.reason ?? null },
        };
      }
    },
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

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
    answerer = createEvidenceExcerptsAnswerer({
      baseUrl: argument("--base-url"),
      token: process.env.TAVONEL_EVAL_WORKSPACE_TOKEN,
      collections: JSON.parse(readFileSync(map, "utf8")),
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
  const stem = path.join(outDir, `ask-quality-${answerer.id}-${runStartedAt.slice(0, 10)}`);
  writeFileSync(`${stem}.json`, `${JSON.stringify(receipt, null, 1)}\n`);
  writeFileSync(`${stem}.md`, score.renderMarkdown(receipt));
  console.log(score.renderMarkdown(receipt));
  console.log(`wrote ${stem}.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
