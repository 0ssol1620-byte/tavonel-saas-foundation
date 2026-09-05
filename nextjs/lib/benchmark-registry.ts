/**
 * The Knowledge Compilation Benchmark: its metric taxonomy, its receipt contract, and the
 * validator that decides whether a record may be shown as a result.
 *
 * Why this is code and not a page of prose.
 *
 * `/benchmarks` returned 404 on purpose for months, because the alternative on offer was a table
 * of numbers nobody could check. The page is worth having anyway -- the protocol is the part that
 * is hard to copy and the part a reader can hold us to -- but only if the page and the rule are
 * the same object. So the eight metric families and the receipt fields below are read by the page
 * *and* by `validateBenchmarkReceipt`. A family that is drawn on the page is a family a metric may
 * declare; a field the page promises is a field a record cannot omit. They cannot drift, because
 * there is only one of each.
 *
 * Three rules are enforced rather than asserted:
 *
 *   1. Every hash is a hash. Six digest fields pin the corpus, the prompt, the configuration, the
 *      raw predictions, the compiled world and the run receipt. A record carrying a description
 *      where a digest belongs is rejected, not rendered with an empty cell.
 *   2. Every rate carries its denominator. The record carries the population it was measured over,
 *      and so does each individual metric -- a run over 1,797 failed documents and a run over the
 *      whole corpus produce different meanings for the same percentage.
 *   3. A quotation is never a result. A competitor's published score may be recorded here as
 *      theirs, with its source; `validateBenchmarkReceipt(record, "result")` refuses it. Only a
 *      run executed under our own frozen configuration is a result.
 *
 * There are no records on this branch. That is a fact about the deployment, not a placeholder:
 * `benchmark-registry.records.json` holds an empty array, the page renders no table, and the first
 * row will arrive with a receipt or not at all.
 */

import registry from "./benchmark-registry.records.json";

/* ------------------------------------------------------------------ taxonomy */

/**
 * The eight families, in compile order: what was read, what it was bound to, who it is about,
 * what was built, when it is true, what a change invalidated, what may be answered, and what it
 * cost. Blueprint section 37.
 *
 * `metrics` is the taxonomy of measurable things in each family, not a list of results. A metric
 * name outside its family's list is still accepted -- the taxonomy names what we know how to
 * measure today and a new measurement should not have to wait for this file -- but the *family*
 * is closed, because a metric that belongs to no family is a number with nowhere to be compared.
 */
export const BENCHMARK_FAMILIES = [
  {
    id: "document_reading",
    label: "Document reading",
    definition:
      "What the reader recovered from the page, and what it invented or dropped: text, layout, tables, formulas, reading order, and the coordinates every later stage binds to.",
    metrics: ["text accuracy", "layout", "table", "formula", "reading order", "bbox", "hallucination / omission", "latency", "VRAM", "cost"],
  },
  {
    id: "evidence",
    label: "Evidence",
    definition:
      "Whether each compiled statement is bound to the source region that actually supports it, and how much of the world is bound at all.",
    metrics: ["evidence binding precision", "evidence coverage", "source citation exactness", "bbox correctness"],
  },
  {
    id: "identity",
    label: "Identity",
    definition:
      "Whether two mentions of one thing became one object, and at what cost in wrong merges, wrong splits, and cases left open for a person.",
    metrics: ["entity resolution precision", "false merge", "false split", "unresolved rate"],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    definition:
      "Whether the objects, claims and relations built on top of the read are correct, valid against the schema, and honest about the places sources disagree.",
    metrics: ["claim correctness", "relation correctness", "ontology validity", "conflict detection"],
  },
  {
    id: "temporal",
    label: "Temporal",
    definition:
      "Whether the world knows which revision it is holding: what has been superseded, what has gone stale, and what a past answer stood on at the time.",
    metrics: ["stale knowledge rate", "supersession correctness", "point-in-time accuracy"],
  },
  {
    id: "recompilation",
    label: "Recompilation",
    definition:
      "Whether a source change was traced to exactly the parts it invalidated — no wider, and crucially no narrower — and what that saved against rebuilding everything.",
    metrics: ["affected set precision", "affected set recall", "work avoided", "cost avoided", "selective vs full equivalence", "publish refusal correctness"],
  },
  {
    id: "ask",
    label: "Ask",
    definition:
      "Whether an answer stands on cited source, points at the right region, and declines when the world cannot support it.",
    metrics: ["grounded answer precision", "citation precision", "abstention correctness", "stale answer prevention"],
  },
  {
    id: "operations",
    label: "Operations",
    definition:
      "What it costs and how long it takes for a change in a source to reach a world an agent is allowed to read.",
    metrics: ["source change → active world p50 / p95", "cost / 1,000 pages", "cost / changed semantic unit"],
  },
] as const;

export type BenchmarkFamily = (typeof BENCHMARK_FAMILIES)[number]["id"];

const FAMILY_IDS: readonly string[] = BENCHMARK_FAMILIES.map((family) => family.id);

/**
 * The North Star, as a definition. Blueprint section 39.
 *
 * It carries no value here and will not until a run produces one with a receipt. A north-star
 * metric printed without its denominator is the exact failure this whole file exists to prevent.
 */
export const NORTH_STAR = {
  name: "Verified Fresh Knowledge Coverage",
  definition:
    "The share of knowledge in an Active World that carries source evidence, passes validation, and agrees with the latest revision of the source it came from.",
  supporting: [
    "Evidence Coverage",
    "Stale Knowledge Rate",
    "Recompile Avoidance",
    "Equivalence Pass Rate",
    "Identity Review Rate",
    "Conflict Rate",
    "Source change → Active World p95",
    "Grounded Ask Precision",
    "Correct Abstention Rate",
  ],
} as const;

/* ------------------------------------------------------------------ receipt */

/** The population a figure was measured over. A rate without one is not a result. */
export type BenchmarkDenominator = { population: string; count: number };

export type BenchmarkMetric = {
  family: BenchmarkFamily;
  name: string;
  value: number;
  unit: string;
  denominator: BenchmarkDenominator;
};

/** Something the run got wrong, published with the run rather than after someone asks. */
export type BenchmarkFailure = { label: string; detail: string };

/**
 * `same_condition` is a run we executed under our own frozen configuration.
 * `quoted` is somebody else's published number, recorded as theirs and never restated as ours.
 */
export type BenchmarkComparisonBasis = "same_condition" | "quoted";

export type BenchmarkReceipt = {
  datasetName: string;
  datasetVersion: string;
  corpusDigest: string;
  denominator: BenchmarkDenominator;
  modelId: string;
  modelRevision: string;
  inputMode: string;
  promptDigest: string;
  configDigest: string;
  compilerVersion: string;
  hardware: string;
  gpu: string;
  runtime: string;
  priceSnapshot: string;
  rawResultDigest: string;
  worldDigest: string;
  runReceiptDigest: string;
  date: string;
  metrics: BenchmarkMetric[];
  comparisonBasis: BenchmarkComparisonBasis;
  publishedFailures: BenchmarkFailure[];
  /** Required when `comparisonBasis` is `quoted`: whose number it is and where they published it. */
  quotedSource?: string;
};

type ReceiptFieldKind = "text" | "digest" | "date" | "denominator" | "metrics" | "basis" | "failures";

/**
 * Every field of a receipt, what it pins, and how it is checked. Blueprint section 38.
 *
 * The page renders `label` and `pins`; the validator switches on `kind`. One list, so the promise
 * on the public page and the rule in the build are the same fourteen lines.
 */
export const RECEIPT_FIELDS: readonly {
  key: Exclude<keyof BenchmarkReceipt, "quotedSource">;
  label: string;
  pins: string;
  kind: ReceiptFieldKind;
}[] = [
  { key: "datasetName", label: "Dataset", pins: "Which corpus was read.", kind: "text" },
  { key: "datasetVersion", label: "Dataset version", pins: "Which cut of it, because corpora are edited.", kind: "text" },
  { key: "corpusDigest", label: "Corpus digest", pins: "sha256 over the corpus, so “the same dataset” is a checkable statement rather than a claim.", kind: "digest" },
  { key: "denominator", label: "Denominator", pins: "The population every rate in the record was measured over, and how many members it has.", kind: "denominator" },
  { key: "modelId", label: "Model id", pins: "The exact model, never the vendor or the family name.", kind: "text" },
  { key: "modelRevision", label: "Model revision", pins: "The revision served on the day. Two runs of “the same model” are not the same run.", kind: "text" },
  { key: "inputMode", label: "Input mode", pins: "What the model was actually given: the page image, extracted text, or both.", kind: "text" },
  { key: "promptDigest", label: "Prompt digest", pins: "sha256 of the prompt, frozen before the run started.", kind: "digest" },
  { key: "configDigest", label: "Config digest", pins: "sha256 of the run configuration: schema, decoding, retries, thresholds.", kind: "digest" },
  { key: "compilerVersion", label: "Compiler version", pins: "The TAVONEL build that compiled the world the metrics were read from.", kind: "text" },
  { key: "hardware", label: "Hardware", pins: "The machine. Latency and cost are properties of a machine, not of a model.", kind: "text" },
  { key: "gpu", label: "GPU", pins: "The accelerator, or “none” for a CPU run. The field is answered, never left blank.", kind: "text" },
  { key: "runtime", label: "Runtime", pins: "The serving runtime and its version.", kind: "text" },
  { key: "priceSnapshot", label: "Price snapshot", pins: "The prices in force on the day, because every cost figure expires.", kind: "text" },
  { key: "rawResultDigest", label: "Raw result digest", pins: "sha256 of the unaggregated predictions, so an average can be recomputed by someone else.", kind: "digest" },
  { key: "worldDigest", label: "World digest", pins: "sha256 of the compiled world the metrics were read from.", kind: "digest" },
  { key: "runReceiptDigest", label: "Run receipt digest", pins: "sha256 of the receipt that ties all of the above to one execution.", kind: "digest" },
  { key: "date", label: "Date", pins: "The day the run happened, as YYYY-MM-DD.", kind: "date" },
  { key: "metrics", label: "Metrics", pins: "Every figure, with its family, its unit, and its own denominator.", kind: "metrics" },
  { key: "comparisonBasis", label: "Comparison basis", pins: "same_condition for a run we executed; quoted for someone else’s published score, which stays theirs.", kind: "basis" },
  { key: "publishedFailures", label: "Published failures", pins: "What the run got wrong, published with it.", kind: "failures" },
];

/* ------------------------------------------------------------------ validation */

/** The canonical digest form used everywhere on this site: `sha256:` and 64 lowercase hex. */
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How the record is about to be used.
 *
 * `result` means the page will show it as something TAVONEL measured, and a quoted score cannot
 * be that. `quotation` means it will be shown as somebody else's number, attributed.
 */
export type ReceiptPresentation = "result" | "quotation";

export type BenchmarkValidation =
  | { ok: true; receipt: BenchmarkReceipt }
  | { ok: false; problems: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textProblem(value: unknown, label: string): string | null {
  if (typeof value !== "string" || value.trim() === "") return `${label} is missing`;
  return null;
}

function denominatorProblems(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label} is missing`];
  const problems: string[] = [];
  const population = value.population;
  if (typeof population !== "string" || population.trim() === "") {
    problems.push(`${label} does not name the population it was measured over`);
  }
  const count = value.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) {
    problems.push(`${label} has no positive integer count`);
  }
  return problems;
}

function metricProblems(value: unknown): string[] {
  if (!Array.isArray(value)) return ["metrics is missing"];
  if (value.length === 0) return ["metrics is empty, so the record reports nothing"];
  const problems: string[] = [];
  value.forEach((entry, index) => {
    const at = `metrics[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${at} is not a metric`);
      return;
    }
    const family = entry.family;
    if (typeof family !== "string" || !FAMILY_IDS.includes(family)) {
      problems.push(`${at} declares family "${String(family)}", which is not one of the eight families`);
    }
    const name = textProblem(entry.name, `${at}.name`);
    if (name) problems.push(name);
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
      problems.push(`${at}.value is not a finite number`);
    }
    const unit = textProblem(entry.unit, `${at}.unit`);
    if (unit) problems.push(unit);
    problems.push(...denominatorProblems(entry.denominator, `${at}.denominator`));
  });
  return problems;
}

function failureProblems(value: unknown): string[] {
  /*
    An empty array is allowed and a missing field is not.

    "Publish what failed" is a rule about disclosure, not a quota: a run can genuinely have
    nothing to report, and inventing a weakness to fill the field would be its own dishonesty.
    What is refused is the record that never considered the question.
  */
  if (!Array.isArray(value)) return ["publishedFailures is missing"];
  const problems: string[] = [];
  value.forEach((entry, index) => {
    const at = `publishedFailures[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${at} is not a failure record`);
      return;
    }
    const label = textProblem(entry.label, `${at}.label`);
    if (label) problems.push(label);
    const detail = textProblem(entry.detail, `${at}.detail`);
    if (detail) problems.push(detail);
  });
  return problems;
}

/**
 * Decide whether a candidate may be published in the given role.
 *
 * Returns every problem it finds rather than the first, because a half-filled record is normally
 * half-filled in several places and fixing them one build at a time is how a record gets published
 * with the last hole still in it.
 */
export function validateBenchmarkReceipt(
  candidate: unknown,
  presentation: ReceiptPresentation = "result",
): BenchmarkValidation {
  if (!isRecord(candidate)) return { ok: false, problems: ["the record is not an object"] };

  const problems: string[] = [];
  for (const field of RECEIPT_FIELDS) {
    const value = candidate[field.key];
    switch (field.kind) {
      case "text": {
        const problem = textProblem(value, field.key);
        if (problem) problems.push(problem);
        break;
      }
      case "digest": {
        if (typeof value !== "string" || !DIGEST.test(value)) {
          problems.push(`${field.key} is not a sha256 digest`);
        }
        break;
      }
      case "date": {
        if (typeof value !== "string" || !ISO_DATE.test(value)) {
          problems.push("date is not an ISO calendar date");
        }
        break;
      }
      case "denominator":
        problems.push(...denominatorProblems(value, "denominator"));
        break;
      case "metrics":
        problems.push(...metricProblems(value));
        break;
      case "failures":
        problems.push(...failureProblems(value));
        break;
      case "basis": {
        if (value !== "same_condition" && value !== "quoted") {
          problems.push("comparisonBasis is neither same_condition nor quoted");
        }
        break;
      }
    }
  }

  if (candidate.comparisonBasis === "quoted") {
    if (presentation === "result") {
      problems.push("a quoted score is somebody else's measurement and cannot be presented as a result");
    }
    const source = textProblem(candidate.quotedSource, "quotedSource");
    if (source) problems.push("a quoted score must name whose it is and where they published it");
  }
  if (candidate.comparisonBasis === "same_condition" && presentation === "quotation") {
    problems.push("a run we executed is a result, not a quotation");
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, receipt: candidate as unknown as BenchmarkReceipt };
}

/* ------------------------------------------------------------------ registry */

/**
 * The records this deployment may show as results.
 *
 * It throws rather than filtering. A record that was committed to the registry and does not
 * validate is a mistake someone made on purpose-looking data, and dropping it silently would
 * leave a page that renders correctly while the repository believes it published a row. The
 * page is statically rendered, so the failure lands in the build, before anyone reads it.
 */
export function qualifiedBenchmarkRecords(): BenchmarkReceipt[] {
  return readBenchmarkRecords(registry.records);
}

/** The half of `qualifiedBenchmarkRecords` that does not depend on the committed file. */
export function readBenchmarkRecords(records: unknown[]): BenchmarkReceipt[] {
  return records.map((record, index) => {
    const validation = validateBenchmarkReceipt(record, "result");
    if (!validation.ok) {
      throw new Error(
        `benchmark-registry.records.json[${index}] cannot be published: ${validation.problems.join("; ")}`,
      );
    }
    return validation.receipt;
  });
}
