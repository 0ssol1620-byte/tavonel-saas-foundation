// Offline extraction loss report (WO-EXTRACT-LOSS-1). Operator tool: prints counts, never text.
//
//   node scripts/extraction-loss-report.mjs [inputs.json]
//
// `inputs.json` is an array of CollectionOcrInput (the shape lib/entity-extraction-eval.inputs.json
// has). Without an argument it runs the synthetic fixture lib/extraction-loss-report.synthetic.inputs.json. It runs the
// TypeScript FALLBACK extractor; the Python Core's funnel is not measured here (see the report's
// `notMeasured`). Needs no env flag: running this script is the opt-in. Reads files, writes
// stdout only, makes no network call.
//
// The lib is TypeScript with extension-less imports, which plain node cannot load, so the script
// re-executes itself under vite-node, which ships with the vitest the repo already installs.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

if (process.env.EXTRACTION_LOSS_CHILD !== "1") {
  const require = createRequire(import.meta.url);
  const viteNodeDir = dirname(createRequire(require.resolve("vitest/package.json")).resolve("vite-node/package.json"));
  const run = spawnSync(
    process.execPath,
    [join(viteNodeDir, "vite-node.mjs"), "--config", join(here, "..", "vitest.config.ts"), fileURLToPath(import.meta.url), "--", ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, EXTRACTION_LOSS_CHILD: "1" } },
  );
  process.exit(run.status ?? 1);
}

const { compileCollectionCandidateWithLossReport, validateCollectionOcrInput } = await import("../lib/collection-compiler.ts");
const { compareCountsToReadModel } = await import("../lib/extraction-loss-report.ts");
const { buildWorldReadModel } = await import("../lib/world-read-model.ts");

const inputPath = resolve(process.argv.slice(2).filter((arg) => arg !== "--")[0]
  ?? join(here, "..", "lib", "extraction-loss-report.synthetic.inputs.json"));
const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const inputs = raw.map((item) => validateCollectionOcrInput(item));
if (!Array.isArray(raw) || inputs.length === 0 || inputs.some((item) => item === null)) {
  process.stderr.write("extraction-loss-report: input must be a non-empty array of valid CollectionOcrInput\n");
  process.exit(2);
}

const { artifact, report } = compileCollectionCandidateWithLossReport(inputs);

// UI-vs-API equality: the artifact's counts against the objects the read model renders. The read
// model returns null for an artifact it cannot read; that is reported as not checked, never as agreement.
// The wrapper below only carries a placeholder coreExecution so the reader accepts the artifact;
// it is built in memory for this check and is never written anywhere.
const readable = {
  ...artifact,
  coreExecution: {
    status: artifact.lifecycle === "review_required" ? "review_required" : "completed",
    runtime: "tavonel-collection-compiler-ts-v1/offline-loss-report",
    worldStateId: null,
    receipt: { requestId: `offline-${artifact.collectionId}`, outputSha256: artifact.manifestDigest, candidatePromotion: false },
  },
};
const readModel = buildWorldReadModel(readable, artifact.collectionId);
if (readModel) report.countEquality = compareCountsToReadModel(artifact.validation.counts, readModel.objects);

process.stdout.write(`${JSON.stringify({ inputPath, report }, null, 2)}\n`);
