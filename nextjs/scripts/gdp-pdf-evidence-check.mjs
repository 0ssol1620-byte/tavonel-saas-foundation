#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GDP_PDF_ARMS,
  buildGdpPdfRunReceipt,
  gdpPdfProtocolDigest,
  validateGdpPdfRunReceipt,
} from "../lib/gdp-pdf-eval.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const protocolPath = path.resolve(here, "../eval/gdp-pdf/protocol.json");
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index < 0 || index === args.length - 1) return null;
  return args[index + 1];
}

function readJson(file) {
  return JSON.parse(readFileSync(path.resolve(file), "utf8"));
}

function verifyProtocol(protocol) {
  const problems = [];
  if (protocol?.schemaVersion !== "tavonel.gdp_pdf.protocol.v1") problems.push("unsupported protocol schema");
  if (protocol?.benchmarkId !== "surgeai/GDP.pdf") problems.push("unexpected benchmark id");
  if (protocol?.dataset?.revision !== "400e411fc344b1b8dd2a51e70a7ecdf469c05b3c") problems.push("dataset revision drift");
  if (protocol?.dataset?.expectedTaskCount !== 100) problems.push("dataset denominator drift");
  if (protocol?.upstreamHarness?.revision !== "7a72a514a6ab19c90babb00adc817e4ae86b9c1b") problems.push("harness revision drift");
  const arms = Object.keys(protocol?.arms ?? {}).sort();
  if (JSON.stringify(arms) !== JSON.stringify([...GDP_PDF_ARMS].sort())) problems.push("four-arm protocol drift");
  if (protocol?.dataset?.redistribution !== "disabled" || protocol?.dataset?.trainingUse !== "prohibited") {
    problems.push("dataset handling boundary drift");
  }
  if (problems.length > 0) throw new Error(`GDP.pdf protocol refused: ${problems.join("; ")}`);
  return {
    ok: true,
    mode: "protocol-dry-run",
    protocolDigest: gdpPdfProtocolDigest(protocol),
    datasetRevision: protocol.dataset.revision,
    harnessRevision: protocol.upstreamHarness.revision,
    expectedTaskCount: protocol.dataset.expectedTaskCount,
    arms: GDP_PDF_ARMS,
    networkUsed: false,
    secretsUsed: false,
    resultsPublished: false,
  };
}

const inputPath = valueAfter("--input");
const outputPath = valueAfter("--output");

try {
  if (!inputPath) {
    process.stdout.write(`${JSON.stringify(verifyProtocol(readJson(protocolPath)), null, 2)}\n`);
  } else {
    const bundle = readJson(inputPath);
    const receipt = buildGdpPdfRunReceipt(bundle.run);
    if (bundle.receipt) {
      const problems = validateGdpPdfRunReceipt(bundle.run, bundle.receipt);
      if (problems.length > 0) throw new Error(`GDP.pdf receipt refused: ${problems.join("; ")}`);
    }
    const result = { ok: true, receipt, suppliedReceiptValidated: Boolean(bundle.receipt) };
    if (outputPath) writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
