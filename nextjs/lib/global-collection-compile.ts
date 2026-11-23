import { CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { planCorpusBatches } from "./corpus-batching";
import { CORE_CLIENT_TIMEOUT_MS } from "./execution-budget";
import { MAX_COLLECTION_JSON_BYTES } from "./r2-objects";

/**
 * Private qualification path; neither flag nor a schema maximum is release evidence.
 *
 * Untied from `TAVONEL_CORE_V2_REVISION_COMPILE` (WO-BIG-2, ADR 0011 §4 C). A global World is keyed
 * by its document set (`compile-job-store.ts` derives its corpus id from the selection), so it is an
 * initial compile every time and never grows by revision; ADR 0011 §5 A keeps revision for updating
 * a World, not for growing one. Requiring the revision flag tied two rollouts together and gated
 * nothing this path needs. What still gates it: its own flag and a pinned Core release.
 */
export function globalCollectionCompileEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.TAVONEL_GLOBAL_COLLECTION_COMPILE === "1"
    && /^sha256:[a-f0-9]{64}$/.test(env.TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256 ?? "");
}

/** Below Core V2's 4.5 MB request bound (`CORE_V2_MAX_REQUEST_BYTES`), leaving room for the envelope. */
export const GLOBAL_COLLECTION_MAX_BYTES = 4 * 1024 * 1024;
export const GLOBAL_COLLECTION_MAX_REGIONS = 10_000;
export const GLOBAL_COLLECTION_KEY_PREFIX = "global-corpus/";
/** Core's output budget as the deployment sets it (Core reads the same name). Unset here = unknown, never a default. */
export const CORE_OUTPUT_BUDGET_ENV = "TAVONEL_CORE_OUTPUT_BUDGET_BYTES";

export type OneWorldBound =
  | "documents" | "regions" | "input_bytes" | "core_output_bytes" | "stored_candidate_bytes" | "core_wall_clock_ms";
export type OneWorldCheck = { bound: OneWorldBound; figure: number | null; limit: number | null; status: "fits" | "over" | "unknown" };
/** Internal: `checks` carries limits and must never reach a public DTO; `sentence` is the customer's. */
export type OneWorldVerdict = { verdict: "fits" | "does_not_fit" | "unknown"; checks: OneWorldCheck[]; sentence: string };
/**
 * What is known about a selection before compiling it. `bytes` is the document's compile input
 * measured as the compile-time judge measures it: `Buffer.byteLength(JSON.stringify(document))`.
 * `measured` holds figures an earlier whole compile of exactly this selection produced; absent = unknown.
 */
export type OneWorldSelection = {
  documents: readonly { documentId: string; pages: number; regions: number; bytes: number }[];
  measured?: { coreOutputBytes?: number; storedCandidateBytes?: number; coreMs?: number };
};
type SelectedDocument = OneWorldSelection["documents"][number];

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const check = (bound: OneWorldBound, figure: number | null, limit: number | null): OneWorldCheck => ({
  bound, figure, limit,
  status: figure === null || limit === null ? "unknown" : figure <= limit ? "fits" : "over",
});

function inputChecks(documents: number, regions: number | null, bytes: number | null) {
  return [
    check("documents", documents, CORPUS_MAX_DOCUMENTS),
    check("regions", regions, GLOBAL_COLLECTION_MAX_REGIONS),
    check("input_bytes", bytes, GLOBAL_COLLECTION_MAX_BYTES),
  ];
}
const allFit = (checks: readonly OneWorldCheck[]) => checks.every((item) => item.status === "fits");

/** The compile-time judge, on documents already read. Same bounds as the selection-time verdict below. */
export function judgeGlobalCollectionInput(documents: readonly { documentId: string; regions?: readonly unknown[] }[]) {
  return documents.length > 0
    && new Set(documents.map((document) => document.documentId)).size === documents.length
    && allFit(inputChecks(
      documents.length,
      documents.reduce((sum, document) => sum + (document.regions?.length ?? 0), 0),
      Buffer.byteLength(JSON.stringify(documents), "utf8"),
    ));
}

function coreOutputBudget(env: NodeJS.ProcessEnv) {
  const raw = env[CORE_OUTPUT_BUDGET_ENV] ?? "";
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const value = Number(raw);
  // Core's budget never exceeds what this side stores; a larger value is a misconfiguration, not a bound.
  return Number.isSafeInteger(value) && value <= MAX_COLLECTION_JSON_BYTES ? value : null;
}

const sum = (items: readonly SelectedDocument[], key: "pages" | "regions" | "bytes") =>
  items.reduce((total, d) => total + d[key], 0);
// JSON.stringify of an array adds "[", "]" and n-1 commas to its members' bytes.
const arrayBytes = (items: readonly SelectedDocument[]) => sum(items, "bytes") + items.length + 1;

/**
 * "Does this selection fit one World?", before anything is compiled (ADR 0011 §4 C, §6 WO-BIG-2).
 *
 * Each bound is judged on its own; a figure or a bound that is not known is `unknown`, and an
 * `unknown` anywhere means no promise. Input figures (documents, regions, bytes) are known at
 * selection time; Core output, stored candidate and wall clock are known only from a whole compile
 * of the same selection, so without one the verdict is `unknown`, never `fits`.
 */
export function judgeOneWorldSelection(
  documentIds: readonly string[],
  selection: OneWorldSelection | undefined,
  env: NodeJS.ProcessEnv = process.env,
): OneWorldVerdict {
  const selected = [...new Set(documentIds)].sort();
  const documents: readonly SelectedDocument[] = Array.isArray(selection?.documents) ? selection.documents : [];
  // Figures count only when they describe exactly the selected documents, each once.
  const wellFormed = selected.length > 0 && documents.length === selected.length
    && documents.every((d) => d !== null && typeof d === "object" && typeof d.documentId === "string"
      && isCount(d.pages) && isCount(d.regions) && isCount(d.bytes) && d.bytes >= 2)
    && documents.map((d) => d.documentId).sort().every((id, index) => id === selected[index]);
  const measured = selection?.measured ?? {};
  const figure = (value: unknown) => isCount(value) ? value : null;
  const checks = [
    ...(wellFormed
      ? inputChecks(selected.length, sum(documents, "regions"), arrayBytes(documents))
      : inputChecks(selected.length, null, null).map((item) => ({ ...item, status: "unknown" as const }))),
    check("core_output_bytes", figure(measured.coreOutputBytes), coreOutputBudget(env)),
    check("stored_candidate_bytes", figure(measured.storedCandidateBytes), MAX_COLLECTION_JSON_BYTES),
    check("core_wall_clock_ms", figure(measured.coreMs), CORE_CLIENT_TIMEOUT_MS),
  ];
  const over = checks.filter((item) => item.status === "over").map((item) => item.bound);
  const verdict = over.length > 0 ? "does_not_fit" : allFit(checks) ? "fits" : "unknown";

  // Customer units only: documents and pages. No bound, figure or limit appears in the sentence.
  const pages = wellFormed ? ` (${sum(documents, "pages")} pages)` : "";
  const these = `${selected.length} documents${pages}`;
  const partCount = planCorpusBatches(selected).length;
  const parts = `They are compiled as ${partCount} separate Worlds that are not merged.`;
  let sentence: string;
  if (verdict === "fits") {
    sentence = `These ${these} fit one World.`;
  } else if (verdict === "unknown") {
    sentence = `Whether these ${these} fit one World is not known yet. ${parts}`;
  } else if (over.includes("documents") || over.includes("regions") || over.includes("input_bytes")) {
    // Leave the heaviest documents out until the input fits, and say how many and how many pages.
    const share = (d: SelectedDocument) => Math.max(d.regions / GLOBAL_COLLECTION_MAX_REGIONS, d.bytes / GLOBAL_COLLECTION_MAX_BYTES);
    const kept = [...documents].sort((a, b) => share(b) - share(a));
    const left: SelectedDocument[] = [];
    while (kept.length > 0 && !allFit(inputChecks(kept.length, sum(kept, "regions"), arrayBytes(kept)))) left.push(kept.shift()!);
    sentence = `These ${these} are more than one World can be compiled from: ${left.length} documents ` +
      `(${sum(left, "pages")} pages) too many. ${parts}`;
  } else if (over.includes("core_wall_clock_ms")) {
    sentence = `These ${these} take longer to compile than one World is given. ${parts}`;
  } else {
    sentence = `These ${these} compile to more than one World can hold. ${parts}`;
  }
  return { verdict, checks, sentence };
}
