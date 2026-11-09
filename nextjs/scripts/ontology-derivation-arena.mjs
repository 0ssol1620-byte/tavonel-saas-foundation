#!/usr/bin/env node
/*
  C1 derivation Arena, deterministic baseline arm (PROGRAM-2026-11-04 §4.C, Arena C1-AX).

  Runs `deriveBaselineSchema` over the public SEC sample already in this repository
  (lib/explore-sample.w4.inputs.json: five Apple filings, their text-layer regions with page and
  box) and writes what it measured. No model, no network, no paid call.

    node --experimental-strip-types scripts/ontology-derivation-arena.mjs [--out <dir>]

  What it measures, all deterministic: candidate counts; evidence validity (every quote verbatim
  in its unit, on its page and box -- §4.C requires 100%); duplicate labels; whether two runs over
  the same input, one of them shuffled, give byte-identical receipts; wall time.

  What it does not measure, and says so: type recall against a human reference schema and the
  share of meaningless types need the reference schemas F-10 has not produced. They are reported
  NOT_MEASURED, never estimated.

  A model-backed arm is not part of this repository; it is reported NOT_RUN.
*/
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  deriveBaselineSchema,
  sha256Of,
  verifiedEvidence,
} from "../lib/ontology-derivation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "../lib/explore-sample.w4.inputs.json");
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt === -1 ? null : resolve(args[outAt + 1] ?? ".");

const fixtureText = readFileSync(FIXTURE, "utf8");
const filings = JSON.parse(fixtureText);
const units = filings.flatMap((filing) => filing.regions
  .filter((region) => typeof region.text === "string" && region.text.trim().length > 0)
  .map((region) => ({
    evidenceId: region.regionId,
    documentId: filing.documentId,
    page: region.pageNumber1,
    bbox: region.bbox1000,
    text: region.text,
  })));

function measure(label, derivation, unitList, seconds) {
  const index = new Map(unitList.map((unit) => [unit.evidenceId, unit]));
  const evidence = derivation.candidates.flatMap((candidate) => candidate.evidence);
  const valid = derivation.candidates.reduce((sum, candidate) => sum + verifiedEvidence(candidate.evidence, index).length, 0);
  const labels = derivation.candidates.map((candidate) => `${candidate.kind}:${candidate.label.toLowerCase()}`);
  return {
    arm: label,
    deriver: derivation.receipt.deriver,
    deriverVersion: derivation.receipt.deriverVersion,
    modelId: derivation.receipt.modelId,
    modelRevision: derivation.receipt.modelRevision,
    promptSha256: derivation.receipt.promptSha256,
    schemaSha256: derivation.receipt.schemaSha256,
    priceSnapshot: derivation.receipt.priceSnapshot,
    inputsSha256: derivation.receipt.inputsSha256,
    outputSha256: derivation.receipt.outputSha256,
    receiptSha256: derivation.receiptSha256,
    units: derivation.receipt.units,
    documents: derivation.receipt.documents,
    classes: derivation.receipt.classes,
    properties: derivation.receipt.properties,
    evidenceItems: evidence.length,
    evidenceValid: valid,
    evidenceValidity: { numerator: valid, denominator: evidence.length },
    droppedEvidence: derivation.receipt.droppedEvidence,
    droppedCandidates: derivation.receipt.droppedCandidates,
    duplicateLabels: labels.length - new Set(labels).size,
    seconds: Number(seconds.toFixed(3)),
    typeRecall: "NOT_MEASURED (no human reference schema; F-10)",
    meaninglessTypeShare: "NOT_MEASURED (needs human judgement; F-10)",
  };
}

const t0 = performance.now();
const first = deriveBaselineSchema(units);
const t1 = performance.now();
const shuffled = [...units].reverse();
const second = deriveBaselineSchema(shuffled);
const baseline = measure("baseline", first, units, (t1 - t0) / 1000);
const summary = {
  schema: "tavonel.ontology_derivation_arena.v1",
  campaign: "C1-AX baseline arm, public SEC sample (repository fixture)",
  fixture: { path: "nextjs/lib/explore-sample.w4.inputs.json", sha256: sha256Of(fixtureText), filings: filings.map((f) => f.documentId) },
  baseline,
  deterministic: first.receiptSha256 === second.receiptSha256,
  modelArm: "NOT_RUN (no model-backed deriver in this repository)",
};

console.log(JSON.stringify(summary, null, 2));
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(out, "baseline-receipt.json"), `${JSON.stringify(first.receipt, null, 2)}\n`);
  writeFileSync(join(out, "baseline-candidates.json"), `${JSON.stringify(first.candidates, null, 2)}\n`);
}
const failed = !summary.deterministic || baseline.evidenceValid !== baseline.evidenceItems;
process.exit(failed ? 1 : 0);
