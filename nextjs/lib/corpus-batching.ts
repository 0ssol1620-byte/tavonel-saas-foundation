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

/*
  No `node:crypto` in this module, deliberately.

  The workspace imports `judgeCorpusSet` to decide whether the Compile button is enabled, so
  this file is in the client bundle. A `createHash` import here fails the production build --
  webpack cannot resolve a `node:` scheme for the browser -- and the dev server does not, which
  is how it got as far as a build. `corpusIdFor` needs the hash, so it lives in `corpus-id.ts`,
  which only the server imports.
*/

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

/*
  What the customer is told at submission, and whether there is anything left to do about it.

  Enqueueing a corpus can stop half way -- the store treats that as a normal outcome and
  returns how far it got -- and the browser announced the number of parts it had *planned*.
  The sentence lives here, next to the partitioning it describes, so the partial case is a
  tested string rather than an interpolation inside a click handler.
*/
export function describeCorpusStart(start: {
  documentsTotal: number;
  batchCount: number;
  partsEnqueued: number;
  incompleteReason: string | null;
}): { notice: string; resume: boolean } {
  /*
    Fail closed on the count, not on the reason. Fewer parts than planned is the fact that
    matters; a missing reason is a store that did not explain itself, never evidence that the
    run is whole.
  */
  if (start.partsEnqueued >= start.batchCount && start.incompleteReason === null) {
    return {
      notice:
        `Compiling ${start.documentsTotal} sources in ${start.batchCount} parts. `
        + "This runs on our servers; you can close this page.",
      resume: false,
    };
  }
  return {
    notice:
      `${start.partsEnqueued} of ${start.batchCount} parts started`
      + `${start.incompleteReason ? ` (${start.incompleteReason})` : ""}. `
      + "The parts that did not start are not compiling, and no source in them is in a World. "
      + "Resume to start them; the parts already running are not repeated.",
    resume: true,
  };
}

export type CorpusPart = {
  jobId: string;
  batchIndex: number;
  state: string;
  collectionId: string | null;
  documentsTotal: number;
  documentsReady: number;
  errorCode: string | null;
  /*
    How many parts this row says the corpus has. Required, and nullable rather than optional,
    because it is the one thing the summary cannot work out from the rows in front of it: a
    caller that has not looked it up has to say so and be refused, not leave it out and be
    told the corpus is whole.
  */
  batchCount: number | null;
};

export type CorpusProgress = {
  corpusId: string;
  /** How many parts the corpus should have, as its own rows declare it. */
  batchCount: number;
  /** How many of them were actually read. */
  partsPresent: number;
  /** The positions the corpus declared and does not have, in order. */
  missingBatchIndexes: number[];
  documentsTotal: number;
  documentsReady: number;
  partsReady: number;
  partsFailed: number;
  /** Why the corpus cannot be called whole; null when every declared part is present. */
  incompleteCode: "PARTS_MISSING" | "BATCH_COUNT_UNDECLARED" | null;
  /*
    A corpus is only `ready` when every part is. `partial` is a real resting state and not a
    softened failure: some parts compiled, at least one did not, and the Worlds that exist are
    usable. Reporting that as `ready` would hide missing sources behind a green tick, and
    reporting it as `failed` would throw away work the customer can already use.

    `incomplete` outranks all three, because it is the only one that is not about the parts.
    A part that failed is a part that answered; a part that is not there says nothing, and no
    count taken over the parts present can notice it.
  */
  state: "running" | "ready" | "partial" | "failed" | "incomplete";
};

export function summariseCorpus(corpusId: string, parts: readonly CorpusPart[]): CorpusProgress {
  /*
    The declared count, not the row count.

    Taking the largest declared value rather than asserting they agree is the fail-closed
    reading of a disagreement: the corpus is short of the largest number any of its own rows
    claims, whichever row is wrong. A row that declares nothing cannot be checked at all, so
    the summary refuses instead of falling back to the row count -- which is exactly the
    substitution that reported eight parts of eleven as ready.
  */
  const undeclared = parts.some((part) => typeof part.batchCount !== "number");
  const declared = parts.reduce((max, part) => Math.max(max, part.batchCount ?? 0), 0);
  const batchCount = Math.max(declared, parts.length);

  const present = new Set(parts.map((part) => part.batchIndex));
  const missingBatchIndexes = Array.from({ length: batchCount }, (_, index) => index)
    .filter((index) => !present.has(index));

  const partsReady = parts.filter((part) => part.state === "ready").length;
  const partsFailed = parts.filter((part) => part.state === "failed" || part.state === "cancelled").length;
  const settled = partsReady + partsFailed;
  const incompleteCode = missingBatchIndexes.length > 0 ? "PARTS_MISSING"
    : undeclared ? "BATCH_COUNT_UNDECLARED"
      : null;

  return {
    corpusId,
    batchCount,
    partsPresent: parts.length,
    missingBatchIndexes,
    documentsTotal: parts.reduce((sum, part) => sum + part.documentsTotal, 0),
    documentsReady: parts.reduce((sum, part) => sum + part.documentsReady, 0),
    partsReady,
    partsFailed,
    incompleteCode,
    state:
      incompleteCode !== null ? "incomplete"
        : settled < batchCount ? "running"
          : partsFailed === 0 ? "ready"
            : partsReady === 0 ? "failed"
              : "partial",
  };
}
