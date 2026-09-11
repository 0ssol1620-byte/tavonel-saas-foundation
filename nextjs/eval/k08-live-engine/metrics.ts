/**
 * K08 metrics: the arithmetic behind the comparison table, separated from the run so it can be
 * tested without importing the Explore corpus (which compiles five Worlds at import and costs
 * minutes). Named `metrics.ts` to match `ask-eval/metrics.ts`, so the one cross-lane request this
 * lane already makes -- adding `eval/**\/metrics.test.ts` to the root vitest include -- covers it
 * with no second ask.
 *
 * `duplicateLabelRate` produces a number that reaches a report (the 13.4% / 16.6% rows in
 * `K08_live_engine_comparison.md`), so it carries its denominator and its population like every
 * other rate in this lane, and returns `null` rather than 0 when nothing was labelled.
 */

/** The field separator inside a grouping key. See `groupingKey` for why it is not a space. */
export const LABEL_KEY_SEPARATOR = "\0";

/**
 * Group two nodes together only when their kind AND their normalised label both match.
 *
 * The separator is a NUL character, not a space, because a space is a legal character inside both
 * a kind and a label: `{kind: "entity segment", label: "revenue"}` and
 * `{kind: "entity", label: "segment revenue"}` would collide on a space-joined key and be counted
 * as a duplicate pair they are not. NUL cannot appear in either field, so the key is unambiguous.
 * `run_core_v2.py` builds the same key the same way (`f"{kind}\0{label}"`) so the Python and
 * TypeScript columns of the comparison are the same measurement.
 *
 * Normalisation is whitespace + case only. Anything cleverer would be a judgement about sameness,
 * which is the identity module's job, not a metric's.
 */
export function groupingKey(kind: string, label: string): string {
  const normalised = label.replace(/\s+/g, " ").trim().toLocaleLowerCase("und");
  return `${kind}${LABEL_KEY_SEPARATOR}${normalised}`;
}

export type DuplicateLabelRate = {
  labelledNodes: number;
  distinctLabels: number;
  nodesSharingALabel: number;
  rate: number | null;
  population: string;
};

/**
 * Duplicate-label rate: the share of labelled nodes whose (kind, normalised label) pair is not
 * unique.
 *
 * The audit asks for it because a node count is not a fact count -- the same sentence appearing in
 * five filings is five nodes and one fact. Nodes with no label, or a whitespace-only label, are
 * outside the denominator entirely: nothing can be said about whether they duplicate anything.
 */
export function duplicateLabelRate(nodes: Array<{ kind: string; label?: string }>): DuplicateLabelRate {
  const groups = new Map<string, number>();
  let labelled = 0;
  for (const node of nodes) {
    if (typeof node.label !== "string" || node.label.trim() === "") continue;
    labelled += 1;
    const key = groupingKey(node.kind, node.label);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const duplicated = [...groups.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  return {
    labelledNodes: labelled,
    distinctLabels: groups.size,
    nodesSharingALabel: duplicated,
    rate: labelled === 0 ? null : duplicated / labelled,
    population: "nodes carrying a non-empty label",
  };
}
