import { createHash } from "node:crypto";
import { COMPILE_MAX_DOCUMENTS, COMPILE_MIN_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "./compile-limits";

/*
  Compiling more sources than one compile can take.

  Intake accepts a 128-file archive and the compiler takes twelve documents. That gap was the
  product's, not a bug in either half: `COMPILE_MAX_DOCUMENTS` is how many documents one
  compile may carry, and the honest way to raise what a *customer* can compile is not to edit
  that constant. A larger number there means one Core request holding a hundred documents'
  OCR output inside a single function invocation, which is the thing the durable job exists to
  stop doing.

  So a corpus is compiled in parts. The set is partitioned deterministically, each part is an
  ordinary compile job -- the same table, the same worker, the same state machine, the same
  idempotency -- and the parts share a `corpusId` so the workspace can follow them as one run
  and the customer can open each finished part as the World it is.

  What this deliberately does not do:

  - It does not merge the parts into one artifact. A merged World would need a compiler that
    takes two artifacts and produces a third, with its own identity resolution across the seam;
    that does not exist, and faking it by concatenating ontologies would produce duplicate
    entities with no evidence that they are the same thing. Masterplan 6.7's cross-part
    resolution is a Core capability, and the register says so rather than this pretending.
  - It does not reorder by size, page count or anything else the customer did not ask for.
    Sorted by document id, so the same selection always yields the same parts, which is what
    makes each part's idempotency key stable across a retry.
*/

export { CORPUS_MAX_DOCUMENTS };

export const CORPUS_ID_PATTERN = /^corpus-[a-f0-9]{32}$/;

export type CorpusVerdict =
  | { ok: true; count: number; batches: number }
  | { ok: false; code: "DOCUMENT_SET_EMPTY" | "CORPUS_TOO_LARGE"; count: number; message: string };

export function judgeCorpusSet(count: number): CorpusVerdict {
  if (!Number.isSafeInteger(count) || count < COMPILE_MIN_DOCUMENTS) {
    return {
      ok: false,
      code: "DOCUMENT_SET_EMPTY",
      count,
      message: "Select at least one prepared source to compile.",
    };
  }
  if (count > CORPUS_MAX_DOCUMENTS) {
    return {
      ok: false,
      code: "CORPUS_TOO_LARGE",
      count,
      message:
        `A corpus compiles up to ${CORPUS_MAX_DOCUMENTS} sources in one run. ` +
        "Split the selection, or connect a source to work through a larger corpus with us.",
    };
  }
  return { ok: true, count, batches: Math.ceil(count / COMPILE_MAX_DOCUMENTS) };
}

/** True when the selection needs more than one compile, and so is a corpus rather than a job. */
export function needsCorpusCompile(count: number) {
  return count > COMPILE_MAX_DOCUMENTS;
}

/**
 * The corpus's identity is its document set, exactly as a job's is.
 *
 * Same rule, same reason: resubmitting the same selection has to converge on the run that is
 * already going rather than start a second one beside it. Deriving the id from the set rather
 * than from a random value is what lets the parts be enqueued one at a time -- a submission
 * interrupted halfway through re-enqueues into the same corpus and the parts that exist are
 * returned unchanged.
 */
export function corpusIdFor(workspaceKey: string, documentIds: readonly string[]) {
  const canonical = [...new Set(documentIds)].sort().join("\n");
  return `corpus-${createHash("sha256").update(`corpus\n${workspaceKey}\n${canonical}`).digest("hex").slice(0, 32)}`;
}

export type CorpusBatch = {
  index: number;
  count: number;
  documentIds: string[];
};

/**
 * Partition a selection into compile-sized parts.
 *
 * Deduplicated and sorted first. Every part except the last is full: an even split would look
 * tidier and would make the part boundaries move when one document is added, which changes
 * every downstream idempotency key and turns a one-document addition into a full recompile.
 */
export function planCorpusBatches(documentIds: readonly string[]): CorpusBatch[] {
  const ordered = [...new Set(documentIds)].sort();
  const batches: CorpusBatch[] = [];
  for (let start = 0; start < ordered.length; start += COMPILE_MAX_DOCUMENTS) {
    batches.push({
      index: batches.length,
      count: 0,
      documentIds: ordered.slice(start, start + COMPILE_MAX_DOCUMENTS),
    });
  }
  return batches.map((batch) => ({ ...batch, count: batches.length }));
}

export type CorpusPart = {
  jobId: string;
  batchIndex: number;
  state: string;
  collectionId: string | null;
  documentsTotal: number;
  documentsReady: number;
  errorCode: string | null;
};

export type CorpusProgress = {
  corpusId: string;
  batchCount: number;
  documentsTotal: number;
  documentsReady: number;
  partsReady: number;
  partsFailed: number;
  /*
    A corpus is only `ready` when every part is. `partial` is a real resting state and not a
    softened failure: some parts compiled, at least one did not, and the Worlds that exist are
    usable. Reporting that as `ready` would hide missing sources behind a green tick, and
    reporting it as `failed` would throw away work the customer can already use.
  */
  state: "running" | "ready" | "partial" | "failed";
};

export function summariseCorpus(corpusId: string, parts: readonly CorpusPart[]): CorpusProgress {
  const batchCount = parts.length;
  const partsReady = parts.filter((part) => part.state === "ready").length;
  const partsFailed = parts.filter((part) => part.state === "failed" || part.state === "cancelled").length;
  const settled = partsReady + partsFailed;
  return {
    corpusId,
    batchCount,
    documentsTotal: parts.reduce((sum, part) => sum + part.documentsTotal, 0),
    documentsReady: parts.reduce((sum, part) => sum + part.documentsReady, 0),
    partsReady,
    partsFailed,
    state:
      settled < batchCount ? "running"
        : partsFailed === 0 ? "ready"
          : partsReady === 0 ? "failed"
            : "partial",
  };
}
