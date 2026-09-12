#!/usr/bin/env node
// The 18-step full-journey model, and the checker that reads a prove.mjs receipt against it.
//
//   node acceptance-checker.mjs --plan                 what each step would call, no credentials
//   node acceptance-checker.mjs <receipt.json>          validate + print the journey table
//   node acceptance-checker.mjs <receipt.json> --json   the same rows as JSON
//
// WG-032 (6-state vocabulary), WG-033 (execution / semantic / task recorded together),
// WG-055 (the package contract a file-consumption step has to find).
//
// This file makes no network call and reads no credential. It is pure over a receipt, so the
// test in `nextjs/lib/journey-acceptance.test.ts` drives exactly what the CLI drives.
//
// Node 22. No dependencies.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Blueprint §5. The only six words a step status may be. */
export const STATUSES = ["PASS", "FAIL", "NOT_RUN", "NOT_APPLICABLE", "HELD", "PARTIAL"];

/**
 * NOT_APPLICABLE is available to exactly one step, and only from an input fact.
 *
 * Blueprint §5 allows it ("if this input needs no OCR") and bars it in the same breath: a
 * required step that was never implemented must not be relabelled as one that did not apply.
 * `uncertainty` is the only step whose non-occurrence is a property of the input -- a document
 * the reader was confident about needed no human review. Every other step that did not happen
 * is NOT_RUN (nothing ran it) or HELD (something is deliberately waiting on a human).
 */
export const NOT_APPLICABLE_ALLOWED = new Set(["uncertainty"]);

/**
 * Every file a downloaded package must carry for step 13 to mean anything, taken from the two
 * modules that write it: `lib/collection-download.ts` (REQUIRED_PACKAGE_PATHS, plus the three
 * AI-entry files it adds) and `lib/ai-package-guidance.ts` (README/AGENTS/entrypoint).
 *
 * Duplicated here on purpose: prove.mjs is a dependency-free Node script and cannot import a
 * TypeScript module. `lib/journey-acceptance.test.ts` asserts this list against those two real
 * exports, so the copy cannot drift without a red test.
 */
export const PACKAGE_CONTRACT = [
  "README.md",
  "AGENTS.md",
  "manifest/ai-entrypoint.json",
  "ontology/knowledge.jsonld",
  "ontology/knowledge.ttl",
  "graph/nodes.csv",
  "graph/relationships.csv",
  "rag/documents.jsonl",
  "rag/chunks.jsonl",
  "provenance/activities.jsonl",
  "validation/report.json",
];

/**
 * The 18 steps, in order, with what a real run would call for each.
 *
 * `implemented: false` is a statement about this harness plus the route tree as read on
 * 2026-09-11, not a statement about the product's intent. A step marked false can only ever
 * report NOT_RUN, which is the point: it keeps an unbuilt step visible instead of letting it
 * disappear into NOT_APPLICABLE.
 */
export const JOURNEY_STEPS = [
  {
    n: 1,
    step: "login_permission",
    title: "Login and permission",
    implemented: true,
    plan: {
      method: "header",
      path: "Authorization: Bearer $TAVONEL_API_KEY on every authenticated call",
      proves: "a scoped API-key principal is admitted; --probe fires the same routes with no header and requires 401/403",
      note: "the browser-session login that promotion requires is never exercised here",
    },
  },
  {
    n: 2,
    step: "full_input",
    title: "Full input accepted",
    implemented: true,
    plan: {
      method: "POST / PUT / POST",
      path: "/api/v1/uploads/capability -> <presigned R2 PUT> -> /api/uploads/confirm",
      proves: "the exact bytes named by sha256 were admitted, stored and confirmed",
    },
  },
  {
    n: 3,
    step: "security_processing",
    title: "Security processing (CDR)",
    implemented: true,
    plan: {
      method: "GET",
      path: "/api/v1/documents (polled)",
      proves: "cdrReceiptKey and sanitizedKey exist for this document",
    },
  },
  {
    n: 4,
    step: "real_read",
    title: "Real read (OCR / extraction)",
    implemented: true,
    plan: {
      method: "GET",
      path: "/api/v1/documents (polled)",
      proves: "processingState reaches ocr_ready with hasOcrJson true",
    },
  },
  {
    n: 5,
    step: "uncertainty",
    title: "Uncertainty surfaced, not guessed",
    implemented: true,
    plan: {
      method: "GET",
      path: "/api/v1/documents (polled)",
      proves: "a low-confidence read lands in operator_review with a reason code instead of a confident answer",
    },
  },
  {
    n: 6,
    step: "structuring",
    title: "Structuring into a candidate",
    implemented: true,
    plan: {
      method: "POST / GET",
      path: "/api/compile-jobs -> /api/compile-jobs/{jobId} (polled to a terminal state)",
      proves: "a durable compile settled at ready and named a collectionId",
    },
  },
  {
    n: 7,
    step: "candidate_validation",
    title: "Candidate validation",
    implemented: true,
    plan: {
      method: "GET",
      path: "/api/v1/collections/{id}",
      proves: "the candidate artifact carries validation and reviewReasons; the harness records them verbatim and asserts nothing about their content",
    },
  },
  {
    n: 8,
    step: "human_approval",
    title: "Human approval (promotion)",
    implemented: true,
    plan: {
      method: "browser",
      path: "open /workspace?collection={id}&job={jobId}, sign in, promote, then re-run with --resume <receipt>",
      proves: "a person approved this candidate",
      note: "no API call: POST /api/collections/{id}/promote authorizes with getRequestUser (session), and no /api/v1 promote route exists",
    },
  },
  {
    n: 9,
    step: "active_world",
    title: "Active World",
    implemented: true,
    plan: {
      method: "GET",
      path: "/api/v1/collections/{id}/world",
      proves: "the approved candidate is the active World; 409 ACTIVE_WORLD_NOT_FOUND before promotion",
    },
  },
  {
    n: 10,
    step: "ask",
    title: "Ask against the World",
    implemented: true,
    plan: {
      method: "POST",
      path: "/api/v1/collections/{id}/ask {question}",
      proves: "code GROUNDED_ANSWER, or a recorded abstention",
    },
  },
  {
    n: 11,
    step: "source_locator",
    title: "Source locator checked",
    implemented: true,
    plan: {
      method: "none",
      path: "the returned contextPacket / citations are searched for this file's own token",
      proves: "the answer's evidence points at the document that was uploaded, not at something else the World happens to contain",
    },
  },
  {
    n: 12,
    step: "live_external_consumption",
    title: "Live external consumption (API / MCP)",
    implemented: true,
    plan: {
      method: "POST",
      path: "/api/v1/collections/{id}/search {query, limit}",
      proves: "a consumer outside the browser reads the same World with the same key; public/developer/tavonel-mcp.mjs is the MCP form of the same read",
    },
  },
  {
    n: 13,
    step: "file_consumption",
    title: "File consumption (signed package)",
    implemented: true,
    plan: {
      method: "GET",
      path: "/api/v1/collections/{id}/download, then node public/developer/tavonel-verify-package.mjs --package <zip> --require-signature --json",
      proves: "the archive carries every path in PACKAGE_CONTRACT and its signature verifies",
    },
  },
  {
    n: 14,
    step: "revision_input",
    title: "Revision of a source already inside the World",
    implemented: false,
    plan: {
      method: "none",
      path: "not implemented",
      proves: "nothing yet",
      note: "E2E_SALT makes a new source version, which is new-document ingestion. Revising a document already inside an active World has no harness step because no World has ever been promoted to revise against.",
    },
  },
  {
    n: 15,
    step: "change_approval",
    title: "Change approval",
    implemented: false,
    plan: {
      method: "none",
      path: "not implemented",
      proves: "nothing yet",
      note: "needs an active World plus a second human approval; the only approval route in the tree is the browser-session promote",
    },
  },
  {
    n: 16,
    step: "post_change_use",
    title: "Use after the change",
    implemented: false,
    plan: {
      method: "none",
      path: "not implemented",
      proves: "nothing yet",
      note: "depends on steps 14 and 15",
    },
  },
  {
    n: 17,
    step: "previous_result_preserved",
    title: "Previous result preserved",
    implemented: true,
    plan: {
      method: "none",
      path: "--resume writes <format>_resume_<stamp>.json beside the original receipt",
      proves: "a second measurement never overwrites the first",
    },
  },
  {
    n: 18,
    step: "accounting",
    title: "Time, cost and failure accounting",
    implemented: true,
    plan: {
      method: "none",
      path: "latencyMs per call, startedAt/finishedAt per run, verdict + blockedBy taxonomy",
      proves: "time and failure only. Cost is not measured anywhere in this receipt and is never estimated.",
    },
  },
];

const STEP_IDS = JOURNEY_STEPS.map((s) => s.step);

/**
 * The step status from its three results (blueprint §5: execution, semantic, task).
 *
 * Worst-wins, with NOT_APPLICABLE ignored unless every dimension is NOT_APPLICABLE. A step whose
 * task dimension does not apply (most intermediate steps have no customer deliverable of their
 * own) must not be reported as a step that did not apply.
 */
export function rollUp({ execution, semantic, task }) {
  const dims = [execution, semantic, task];
  for (const d of dims) if (!STATUSES.includes(d)) throw new Error(`unknown status ${d}`);
  if (dims.every((d) => d === "NOT_APPLICABLE")) return "NOT_APPLICABLE";
  const live = dims.filter((d) => d !== "NOT_APPLICABLE");
  if (live.includes("FAIL")) return "FAIL";
  if (live.every((d) => d === "PASS")) return "PASS";
  if (live.includes("PASS") || live.includes("PARTIAL")) return "PARTIAL";
  if (live.includes("HELD")) return "HELD";
  return "NOT_RUN";
}

const NA = (why) => ({ execution: "NOT_APPLICABLE", semantic: "NOT_APPLICABLE", task: "NOT_APPLICABLE", evidence: why });
const nothing = (why) => ({ execution: "NOT_RUN", semantic: "NOT_RUN", task: "NOT_APPLICABLE", evidence: why });

/** Most steps carry no customer deliverable of their own; only 11/12/13/16 finish a job. */
const NO_TASK_OF_ITS_OWN = "intermediate step: no customer deliverable of its own";

/**
 * One receipt -> the three results per step. Everything here is read out of the receipt; nothing
 * is inferred from a step's name and no number is invented.
 */
function derive(receipt) {
  const calls = Array.isArray(receipt.calls) ? receipt.calls : [];
  const last = (step) => [...calls].reverse().find((c) => c.step === step) ?? null;
  const ok = (step) => {
    const c = last(step);
    return Boolean(c && typeof c.status === "number" && c.status >= 200 && c.status < 300);
  };
  const statusOf = (step) => last(step)?.status ?? null;
  const codeOf = (step) => last(step)?.code ?? null;
  const blocked = String(receipt.blockedBy ?? "");
  const row = receipt.documentInventoryRow ?? null;
  const artifact = receipt.collection?.artifact ?? receipt.collection ?? null;
  const out = {};

  // 1. Login / permission.
  const authed = calls.find((c) => c.step !== "R2_PUT" && typeof c.status === "number");
  out.login_permission = authed
    ? {
        execution: authed.status === 401 || authed.status === 403 ? "FAIL" : "PASS",
        semantic: "PARTIAL",
        task: "NOT_APPLICABLE",
        evidence: `first authenticated call ${authed.method} ${authed.path} -> ${authed.status}${authed.code ? ` ${authed.code}` : ""}; API-key principal only, browser-session login not exercised`,
      }
    : nothing("no call recorded");

  // 2. Full input.
  const chain = ["UPLOAD_CAPABILITY", "R2_PUT", "CONFIRM"];
  const attempted = chain.filter((s) => last(s));
  out.full_input = attempted.length
    ? {
        execution: chain.every((s) => ok(s)) ? "PASS" : "FAIL",
        semantic: receipt.sha256 && receipt.bytes ? "PASS" : "NOT_RUN",
        task: "NOT_APPLICABLE",
        evidence: `${attempted.map((s) => `${s}=${statusOf(s)}`).join(" ")}; ${receipt.bytes ?? "?"} B sha256 ${String(receipt.sha256 ?? "absent").slice(0, 16)}...`,
      }
    : nothing("upload chain not attempted");

  // 3. Security processing. The CDR receipt is the artifact that says sanitization ran.
  out.security_processing = row
    ? {
        execution: row.cdrReceiptKey && row.sanitizedKey ? "PASS" : "FAIL",
        semantic: Number(row.sanitizedSize) > 0 ? "PASS" : "NOT_RUN",
        task: "NOT_APPLICABLE",
        evidence: row.cdrReceiptKey
          ? `cdr receipt + sanitized object recorded, sanitizedSize=${row.sanitizedSize}`
          : "document inventory row carries no cdrReceiptKey",
      }
    : nothing("document never appeared in the inventory");

  // 4. Real read. operator_review is a hold, not a read.
  const state = receipt.documentProcessingState ?? row?.processingState ?? null;
  if (state === "ocr_ready") {
    out.real_read = {
      execution: row?.hasOcrJson ? "PASS" : "FAIL",
      // The harness stores ocr.json's size, never its content, so correctness of the read is unjudged.
      semantic: "PARTIAL",
      task: "NOT_APPLICABLE",
      evidence: `processingState=ocr_ready, ocrJsonSize=${row?.ocrJsonSize ?? "?"}; the harness does not assert what the read says`,
    };
  } else if (state === "operator_review") {
    out.real_read = {
      execution: "HELD",
      semantic: "NOT_RUN",
      task: "NOT_APPLICABLE",
      evidence: `processingState=operator_review (${row?.ocrReviewReasonCode ?? "unspecified"}): a human read was substituted for the machine read`,
    };
  } else {
    out.real_read = nothing(`processingState=${state ?? "never terminal"}`);
  }

  // 5. Uncertainty. The one step an input fact can make inapplicable.
  if (state === "operator_review") {
    out.uncertainty = {
      execution: "PASS",
      semantic: "PASS",
      task: "NOT_APPLICABLE",
      evidence: `held for human review with reason ${row?.ocrReviewReasonCode ?? "unspecified"}; a safe hold is a safety result, not a completed job`,
    };
  } else if (state === "ocr_ready") {
    out.uncertainty = NA("the read was confident: this input needed no human review");
  } else {
    out.uncertainty = nothing("never reached a terminal read state");
  }

  // 6. Structuring.
  const compileState = receipt.compileJobState ?? null;
  if (!last("COMPILE_JOB")) {
    out.structuring = nothing("compile never requested");
  } else {
    out.structuring = {
      execution: compileState === "ready" ? "PASS" : "FAIL",
      semantic:
        artifact?.blueprint && artifact?.sourceDocuments && artifact?.directoryPlan && artifact?.ontology && artifact?.package
          ? "PASS"
          : "NOT_RUN",
      task: "NOT_APPLICABLE",
      evidence:
        compileState === "ready"
          ? `compile job ready, collectionId ${receipt.collectionId}`
          : `COMPILE_JOB ${statusOf("COMPILE_JOB")}${codeOf("COMPILE_JOB") ? ` ${codeOf("COMPILE_JOB")}` : ""}, state ${compileState ?? "none"}${blocked ? `, blockedBy ${blocked}` : ""}`,
    };
  }

  // 7. Candidate validation.
  out.candidate_validation = artifact
    ? {
        execution: "validation" in artifact ? "PASS" : "FAIL",
        semantic: "PARTIAL",
        task: "NOT_APPLICABLE",
        evidence: `validation and reviewReasons recorded verbatim (${(artifact.reviewReasons ?? []).length} review reasons); the harness asserts nothing about their content`,
      }
    : nothing("no candidate artifact was read");

  // 8. Human approval. Browser-session only, so for an API-key run this is a hold by design.
  if (receipt.activeWorld) {
    out.human_approval = {
      execution: "PASS",
      semantic: "PASS",
      task: "NOT_APPLICABLE",
      evidence: "an active World exists for this collection, so a person promoted it",
    };
  } else if (receipt.collectionId) {
    out.human_approval = {
      execution: "HELD",
      semantic: "NOT_RUN",
      task: "NOT_APPLICABLE",
      evidence:
        "promotion is browser-session-only: POST /api/collections/{id}/promote authorizes with getRequestUser and no /api/v1 promote route exists. A person must promote, then --resume",
    };
  } else {
    out.human_approval = nothing("no candidate to approve");
  }

  // 9. Active World.
  if (receipt.activeWorld) {
    out.active_world = {
      execution: ok("WORLD") ? "PASS" : "PARTIAL",
      semantic: "PASS",
      task: "NOT_APPLICABLE",
      evidence: `WORLD ${statusOf("WORLD")}, manifestDigest ${receipt.activeWorld.manifestDigest ?? "not recorded"}`,
    };
  } else if (last("WORLD")) {
    out.active_world = {
      execution: "HELD",
      semantic: "NOT_RUN",
      task: "NOT_APPLICABLE",
      evidence: `WORLD ${statusOf("WORLD")} ${codeOf("WORLD") ?? ""}`.trim(),
    };
  } else {
    out.active_world = nothing("world never requested (blocked on step 8)");
  }

  // 10. Ask.
  const ask = receipt.askResponse ?? null;
  if (!last("ASK")) {
    out.ask = nothing("ask never requested (blocked on step 8)");
  } else if (!ok("ASK")) {
    out.ask = {
      execution: "FAIL",
      semantic: "NOT_RUN",
      task: "NOT_APPLICABLE",
      evidence: `ASK ${statusOf("ASK")} ${codeOf("ASK") ?? ""}`.trim(),
    };
  } else if (ask?.code === "GROUNDED_ANSWER") {
    out.ask = {
      execution: "PASS",
      semantic: "PASS",
      task: "NOT_APPLICABLE",
      evidence: "ASK 200 GROUNDED_ANSWER",
    };
  } else {
    out.ask = {
      execution: "PASS",
      // An abstention is a designed refusal: the call worked, the answer was withheld.
      semantic: "HELD",
      task: "NOT_APPLICABLE",
      evidence: `ASK 200 but code=${ask?.code ?? "none"}${blocked ? ` (${blocked})` : ""}`,
    };
  }

  // 11. Source locator. This is the first step with a customer deliverable of its own.
  if (receipt.tokenFoundInEvidence === true) {
    out.source_locator = {
      execution: "PASS",
      semantic: "PASS",
      task: "PASS",
      evidence: `the answer's evidence contains this file's own token ${receipt.uniqueToken}`,
    };
  } else if (receipt.tokenFoundInEvidence === false) {
    out.source_locator = {
      execution: "PASS",
      semantic: "FAIL",
      task: "FAIL",
      evidence: `evidence did not contain ${receipt.uniqueToken}: retrieval ran, but not over this file`,
    };
  } else {
    out.source_locator = nothing("no answer to check evidence on");
  }

  // 12. Live external consumption.
  const consumer = receipt.externalConsumer ?? null;
  if (!consumer) {
    out.live_external_consumption = nothing("external consumer read not attempted (blocked on step 9)");
  } else {
    out.live_external_consumption = {
      execution: consumer.status === 200 ? "PASS" : "FAIL",
      semantic: consumer.tokenFoundInResults === true ? "PASS" : consumer.tokenFoundInResults === false ? "FAIL" : "NOT_RUN",
      task: consumer.status === 200 && consumer.tokenFoundInResults === true ? "PASS" : "NOT_RUN",
      evidence: `${consumer.via} -> ${consumer.status}${consumer.code ? ` ${consumer.code}` : ""}, token in results: ${consumer.tokenFoundInResults ?? "not checked"}`,
    };
  }

  // 13. File consumption.
  const pkg = receipt.filePackage ?? null;
  if (!pkg) {
    out.file_consumption = nothing("package download not attempted (blocked on step 9)");
  } else {
    const missing = Array.isArray(pkg.missingContractPaths) ? pkg.missingContractPaths : null;
    out.file_consumption = {
      execution: pkg.status === 200 && pkg.sha256 ? "PASS" : "FAIL",
      semantic: pkg.verified === true && missing?.length === 0 ? "PASS" : pkg.verified === false || missing?.length ? "FAIL" : "NOT_RUN",
      task: pkg.verified === true && missing?.length === 0 ? "PASS" : "NOT_RUN",
      evidence: `download ${pkg.status}, ${pkg.bytes ?? "?"} B; verifier ${pkg.verifier ?? "not run"}${missing?.length ? `, missing ${missing.join(", ")}` : ""}`,
    };
  }

  // 14-16. Not implemented. NOT_RUN, never NOT_APPLICABLE.
  const salted = typeof receipt.uniqueToken === "string" && /-r\d+$/.test(receipt.uniqueToken);
  out.revision_input = nothing(
    `no revision step exists in this harness${salted ? `; E2E_SALT produced a new source version (${receipt.uniqueToken}), which is new-document ingestion, not a revision` : ""}`,
  );
  out.change_approval = nothing("no change-approval endpoint exists besides the browser-session promote");
  out.post_change_use = nothing("depends on steps 14 and 15");

  // 17. Previous result preserved.
  out.previous_result_preserved =
    receipt.mode === "resume" && receipt.resumedFrom
      ? {
          execution: "PASS",
          semantic: "PASS",
          task: "NOT_APPLICABLE",
          evidence: `written beside ${receipt.resumedFrom}, priorVerdict ${receipt.priorVerdict ?? "not recorded"}`,
        }
      : nothing("this receipt is a first measurement; preservation is only observable on a --resume receipt");

  // 18. Accounting. Time and failure, never cost.
  const timed = calls.filter((c) => typeof c.latencyMs === "number").length;
  const cost = receipt.costAccounting ?? null;
  out.accounting = {
    execution: calls.length && timed === calls.length ? "PASS" : calls.length ? "PARTIAL" : "NOT_RUN",
    semantic: "PARTIAL",
    task: "NOT_APPLICABLE",
    evidence: `${timed}/${calls.length} calls timed, verdict ${receipt.verdict ?? "none"}; cost ${
      cost ? `UNMEASURED (${cost.reason})` : "field absent from this receipt"
    }`,
  };

  return out;
}

/**
 * The journey table for one receipt: 18 rows, always all 18, always in blueprint order.
 *
 * The last guard is the one that matters. If a derivation somehow rolls up to NOT_APPLICABLE for
 * a step that is not allowed one, it is rewritten to NOT_RUN and the reason is appended, because
 * a step nobody built must not read as a step nobody needed.
 */
export function journeyFromReceipt(receipt) {
  const derived = derive(receipt);
  return JOURNEY_STEPS.map(({ n, step, implemented }) => {
    const r = derived[step] ?? nothing("no derivation");
    let status = rollUp(r);
    let evidence = r.evidence;
    if (status === "NOT_APPLICABLE" && !NOT_APPLICABLE_ALLOWED.has(step)) {
      status = "NOT_RUN";
      evidence = `${evidence} [NOT_APPLICABLE is not available to this step; an unimplemented step is NOT_RUN]`;
    }
    if (!implemented && status !== "NOT_RUN") {
      status = "NOT_RUN";
      evidence = `${evidence} [step not implemented in this harness]`;
    }
    return { n, step, status, execution: r.execution, semantic: r.semantic, task: r.task, evidence };
  });
}

/* ---------------------------------------------------------------- validation */

const SCHEMA = JSON.parse(readFileSync(resolve(HERE, "receipt.schema.json"), "utf8"));

/**
 * The subset of JSON Schema these receipts use: type, required, enum, items, properties.
 *
 * ponytail: a 30-line walker instead of a validator dependency. If the schema ever needs oneOf,
 * $ref or conditionals, swap this for ajv rather than growing it.
 */
function checkNode(node, value, path, errors) {
  if (node.type) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const allowed = Array.isArray(node.type) ? node.type : [node.type];
    const match = allowed.some((t) => (t === "integer" ? Number.isInteger(value) : t === actual));
    if (!match) {
      errors.push(`${path}: expected ${allowed.join("|")}, got ${actual}`);
      return;
    }
  }
  if (node.enum && !node.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${node.enum.join(", ")}`);
  if (node.properties && value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of node.required ?? []) if (!(key in value)) errors.push(`${path}: missing required field ${key}`);
    for (const [key, sub] of Object.entries(node.properties)) {
      if (key in value) checkNode(sub, value[key], `${path}.${key}`, errors);
    }
  }
  if (node.items && Array.isArray(value)) value.forEach((v, i) => checkNode(node.items, v, `${path}[${i}]`, errors));
}

/**
 * Is this a journey receipt or the unauthenticated probe? Two artifacts, two shapes, one file.
 */
export function receiptKind(receipt) {
  return String(receipt?.verdict ?? "").startsWith("UNAUTHENTICATED_SURFACE") ? "unauthenticatedProbe" : "journeyReceipt";
}

/**
 * Schema plus the cross-field invariants a schema cannot express. Returns errors rather than
 * throwing so the CLI can print all of them and the test can assert on them.
 */
export function validateReceipt(receipt) {
  const kind = receiptKind(receipt);
  const errors = [];
  checkNode(SCHEMA.$defs[kind], receipt, kind, errors);
  if (kind === "unauthenticatedProbe") return { ok: errors.length === 0, kind, errors };

  // A verdict is a claim about evidence. These three are the ways a receipt can claim more than it holds.
  if (receipt.verdict === "PROVEN_E2E" && receipt.tokenFoundInEvidence !== true) {
    errors.push("verdict PROVEN_E2E but tokenFoundInEvidence is not true");
  }
  if (receipt.verdict === "PROVEN_E2E" && receipt.reachedStep !== "ASK") {
    errors.push(`verdict PROVEN_E2E but reachedStep is ${receipt.reachedStep}`);
  }
  if (receipt.activeWorld && !receipt.collectionId) errors.push("activeWorld recorded without a collectionId");

  for (const [step, reason] of Object.entries(receipt.notApplicable ?? {})) {
    if (!STEP_IDS.includes(step)) errors.push(`notApplicable names ${step}, which is not one of the 18 steps`);
    else if (!NOT_APPLICABLE_ALLOWED.has(step)) {
      errors.push(`notApplicable names ${step}: only ${[...NOT_APPLICABLE_ALLOWED].join(", ")} may be NOT_APPLICABLE (blueprint §5)`);
    } else if (typeof reason !== "string" || !reason.trim()) errors.push(`notApplicable.${step} needs a reason`);
  }
  return { ok: errors.length === 0, kind, errors };
}

/* ---------------------------------------------------------------- rendering */

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

export function renderJourneyTable(rows) {
  const head = `  #  step                        status          execution       semantic        task`;
  const body = rows.map(
    (r) =>
      ` ${pad(r.n, 2)}  ${pad(r.step, 26)}  ${pad(r.status, 14)}  ${pad(r.execution, 14)}  ${pad(r.semantic, 14)}  ${pad(r.task, 14)}\n     ${r.evidence}`,
  );
  const counts = STATUSES.map((s) => `${s}=${rows.filter((r) => r.status === s).length}`).join("  ");
  return [head, ...body, "", `  ${counts}`].join("\n");
}

export function planLines() {
  return JOURNEY_STEPS.map((s) => {
    const parts = [
      ` ${pad(s.n, 2)}  ${pad(s.step, 26)}  ${s.implemented ? "implemented" : "NOT IMPLEMENTED"}`,
      `     ${s.plan.method}  ${s.plan.path}`,
      `     proves: ${s.plan.proves}`,
    ];
    if (s.plan.note) parts.push(`     note: ${s.plan.note}`);
    return parts.join("\n");
  });
}

/* ---------------------------------------------------------------- cli */

function main(argv) {
  if (argv.includes("--plan")) {
    console.log("Full-journey plan. No credential is read and no call is made.\n");
    console.log(planLines().join("\n"));
    console.log(`\n  package contract for step 13:\n${PACKAGE_CONTRACT.map((p) => `    ${p}`).join("\n")}`);
    return 0;
  }
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node acceptance-checker.mjs <receipt.json> [--json] | --plan");
    return 2;
  }
  const receipt = JSON.parse(readFileSync(file, "utf8"));
  const { ok, kind, errors } = validateReceipt(receipt);
  if (!ok) {
    console.error(`${file} is not a valid ${kind}:`);
    for (const e of errors) console.error(`  - ${e}`);
    return 1;
  }
  if (kind === "unauthenticatedProbe") {
    console.log(`${file}\n  ${receipt.verdict} -- guarded routes refused: ${receipt.allGuardedRoutesRefused}`);
    console.log("  this artifact records the unauthenticated surface, not a journey; no journey table applies");
    return receipt.allGuardedRoutesRefused ? 0 : 1;
  }
  const rows = journeyFromReceipt(receipt);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ receipt: file, verdict: receipt.verdict, blockedBy: receipt.blockedBy, journey: rows }, null, 2));
  } else {
    console.log(`${file}\n  verdict ${receipt.verdict}${receipt.blockedBy ? `  blockedBy ${receipt.blockedBy}` : ""}\n`);
    console.log(renderJourneyTable(rows));
  }
  // Exit 0 means "this receipt is an honest record", not "the journey passed". The table says that.
  return 0;
}

// Entry guard copied from scripts/compiled-world/validate.mjs: importing this module must not run it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
