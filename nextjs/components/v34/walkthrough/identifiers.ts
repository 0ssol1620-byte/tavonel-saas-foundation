/**
 * Splits text into runs, marking the standard identifiers in it ("NIST SP 800-53", "Rev. 5",
 * "SA-24", "Release 5.2.0") so a renderer can keep each one on a single line. Rendering only: the
 * source text is returned unchanged, run by run.
 *
 * An identifier is a token with a digit in it (letters and a hyphen may lead it, hyphenated parts
 * may follow), together with the all-capital words and the one capitalised word that name it. A
 * period that ends the token ends the sentence, not the identifier, and so does a hyphen left
 * dangling before it ("800-."): both are trimmed in code rather than by a lookbehind, which Safari
 * before 16.4 cannot parse (the whole module would fail to load).
 */
const IDENTIFIER = /(?:\b[A-Z]{2,} )*(?:\b[A-Z][a-z]+\.? )?\b[A-Z]*-?\d[\w.]*(?:-[\w.]+)*/g;

export function identifierRuns(text: string): { text: string; id: boolean }[] {
  const runs: { text: string; id: boolean }[] = [];
  let at = 0;
  for (const match of text.matchAll(IDENTIFIER)) {
    const id = match[0].replace(/[.-]+$/, "");
    if (match.index > at) runs.push({ text: text.slice(at, match.index), id: false });
    runs.push({ text: id, id: true });
    at = match.index + id.length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), id: false });
  return runs;
}
