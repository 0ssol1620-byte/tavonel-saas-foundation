/**
 * The corpus size contract, declared once.
 *
 * Two limits used to be written independently in five places and they did not match. Intake
 * accepted 128 files; the compile route and the compiler both rejected anything outside 2..12.
 * A customer could therefore upload 128 sources, wait through sanitization and OCR on all of
 * them, and only then be told the set was unqualified — after the expensive part had run. The
 * one-document case failed the same way for the opposite reason: a single file uploaded and
 * read fine, then produced no world at all, because the compiler demanded at least two.
 *
 * Both are now one exported pair, and the failure is moved to selection time.
 *
 * COMPILE_MIN_DOCUMENTS is 1. A single document is a legitimate first world and is how most
 * people will try the product; refusing it was a compiler implementation detail, not a
 * product decision.
 *
 * COMPILE_MAX_DOCUMENTS stays at the pilot ceiling. Raising it is not a constant edit — the
 * synchronous compile route runs inside a 60-second request, so a larger corpus needs the
 * durable job orchestration that replaces it, not a bigger number here.
 */

export const COMPILE_MIN_DOCUMENTS = 1;
export const COMPILE_MAX_DOCUMENTS = 12;

export type CompileSetVerdict =
  | { ok: true; count: number }
  | { ok: false; code: "DOCUMENT_SET_EMPTY" | "DOCUMENT_SET_TOO_LARGE"; count: number; message: string };

/**
 * Judge a selection against the contract and say, in customer language, what is wrong.
 * Callers on both sides of the network boundary use this so the API and the UI cannot drift.
 */
export function judgeCompileSet(count: number): CompileSetVerdict {
  if (!Number.isSafeInteger(count) || count < COMPILE_MIN_DOCUMENTS) {
    return {
      ok: false,
      code: "DOCUMENT_SET_EMPTY",
      count,
      message: "Select at least one prepared source to compile.",
    };
  }
  if (count > COMPILE_MAX_DOCUMENTS) {
    return {
      ok: false,
      code: "DOCUMENT_SET_TOO_LARGE",
      count,
      message:
        `This evaluation compiles up to ${COMPILE_MAX_DOCUMENTS} sources at a time. ` +
        "Remove some, or connect a source to work through a larger corpus with us.",
    };
  }
  return { ok: true, count };
}

/** The limits sentence shown before a customer picks files, not after they fail. */
export const COMPILE_LIMITS_NOTICE =
  `Up to ${COMPILE_MAX_DOCUMENTS} sources per compile in this evaluation. ` +
  "ZIP archives up to 25 MB. Larger corpus? Connect a source or talk to us.";
