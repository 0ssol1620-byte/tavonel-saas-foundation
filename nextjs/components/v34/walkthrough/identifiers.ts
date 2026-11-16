/**
 * Splits text into runs, marking the standard identifiers in it ("NIST SP 800-53", "Rev. 5",
 * "SA-24", "Release 5.2.0") so a renderer can keep each one on a single line. Rendering only: the
 * source text is returned unchanged, run by run.
 *
 * An identifier is a token with a digit in it (letters and a hyphen may lead it, hyphenated parts
 * may follow), together with the all-capital words and the one capitalised word that name it.
 */
const IDENTIFIER = /((?:\b[A-Z]{2,} )*(?:\b[A-Z][a-z]+\.? )?\b[A-Z]*-?\d[\w.]*(?:-[\w.]+)*)/;

export function identifierRuns(text: string): { text: string; id: boolean }[] {
  return text
    .split(IDENTIFIER)
    .map((part, i) => ({ text: part, id: i % 2 === 1 }))
    .filter((run) => run.text !== "");
}
