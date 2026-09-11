/**
 * Our own record, which used to be scene 07 of the landing page.
 *
 * D1 -- it was the most convincing material on the site and the least useful thing to put in
 * front of someone who had not yet decided what this is. A visitor three scenes into a
 * demonstration does not want a benchmark note and a failed experiment; a visitor who has
 * decided we might be worth trusting wants exactly that, and now has a page of it. The landing
 * page keeps one line and a link, which is the whole claim anyway: we publish what failed.
 *
 * Nothing here is a certification, a customer or a competitor comparison. Two entries are
 * measurements we made, one is an experiment that did not work and is not shipped, and one is
 * an admission about what tests do and do not establish.
 */

/**
 * The document boundary this deployment enforces, in the order it is enforced.
 *
 * "02" used to say "Antivirus", which named a category and asserted nothing checkable. What the
 * CDR sanitizer now enforces is a ClamAV scan it cannot be started without: the malware-scan
 * opt-out was removed, so a service that comes up without a scanner refuses to serve, and a
 * document whose scan does not complete is refused rather than passed through. The adapter
 * measurement is `docs/evidence/receipts/malware_scan_latency_2026-09-06.json`, whose own status
 * is `IMPLEMENTED_NOT_LIVE` -- so this describes the control the sanitizer enforces, and no line
 * here claims a date on which a Cloud Run revision began serving it.
 */
export const BOUNDARY = [
  ["01", "Quarantine", "Browser-direct, tenant-scoped intake. Document bytes never pass through the application or the database."],
  ["02", "Sanitize", "ClamAV scan on the CDR sanitizer, fail-closed: it does not start without a scanner, and a document whose scan cannot clear is refused. Mandatory content disarm, with the sanitization proof kept as evidence."],
  ["03", "Understand", "Only sanitized artifacts reach analysis. A parser gets no tools, no broad credentials, no outbound network."],
  ["04", "Review", "A person decides before anything is promoted. Automated analysis produces a candidate, never a world."],
] as const;

/**
 * What has been measured, and what has only been built.
 *
 * The state on each entry is the point of the list: "measured" is a number we produced with a
 * scoring path we did not touch, "unsupported" is a hypothesis that failed and was not shipped
 * anyway, and "unproven" is code that passes its tests without that proving the threshold in it
 * is right. A page that only carried the first state would be a page of marketing.
 *
 * The two measured entries used to describe their own numbers instead of stating them --
 * "moved a document extraction score substantially", "of a thousand documents offered in one
 * campaign" -- which is the shape a reader can neither check nor date. Both now carry the
 * figure, the denominator, the date, and the filename and sha256 of the receipt the figure came
 * from, copied from the benchmark campaign record rather than restated from memory.
 *
 * Neither is a statement about how this service behaves now. They are research measurements on
 * a named corpus and a named build, and the entries say so, because a research refusal count
 * read as a production failure rate is the exact misreading the campaign record warns about.
 *
 * The receipts are named rather than linked, because they are not published at a URL. Where
 * they live is written on /research/notes, next to the address that will send one.
 */
export const EVIDENCE = [
  ["measured", "Recovery changes the outcome", "On olmOCR-Bench, scored by the benchmark's own evaluator at revision cfa88c1e, the same pipeline scored 80.6 with the recovery lane and 53.7 with only that lane switched off — a gap of 26.9 points, 95% confidence intervals 79.62–81.57 and 52.62–54.93, which do not overlap. Model, evaluator revision, corpus, source manifest, test set and settings were identical; the only difference was whether the documents recovery delivered carried their content. Measured 2026-08-08 over 1,403 documents and 8,413 checks. One category, headers and footers, scores higher without recovery, because a check that a phrase is absent passes trivially on an empty page — the no-recovery figure is generous rather than harsh. Ours, and never placed beside a competitor's number as if reproduced. Receipt: folynta-recovery-accuracy-counterfactual-olmocr-2026-08-08.json, sha256 1f5b6220c1fa569e8e33530d933a16eb7ad6b856c56e22f1744f8fa96efe33e0."],
  ["measured", "Compilation refuses more than it emits, sometimes", "Of a thousand documents offered, 596 compiled and 404 were refused, every one for a link the compiler could not resolve — most often a referenced figure asset that had not been supplied alongside the markdown. A vault with a broken link is not emitted, by design. Measured 2026-08-08, on that corpus and that build: a historical research measurement, not this service's live refusal rate, which is not published. Receipt: folynta-knowledge-compilation-properties-2026-08-08.json, sha256 936b859c484fb54a8bdff3175d89d2fd47d695d48ec93b99fcfd93ac53ee2e25."],
  ["unsupported", "Blind quality detection failed", "We tested whether prediction-only signals could pick the worst documents without ground truth. They could not beat ranking by length alone. Published as unsupported, and not shipped as a feature."],
  ["unproven", "Most thresholds are uncalibrated", "Tests show the code does what its author intended. They do not show a threshold is right. Nothing here presents an uncalibrated threshold as a measured result."],
  /*
    BA-075. This card was titled with a frozen mechanism name -- one of the technologies on the
    disclosure registry's publication freeze -- and it reached a public page through the one
    directory `prohibited-phrases.test.ts` was not walking. The entry itself stays, because it
    is a real published limit on what the landing demonstration establishes. What changes is the
    title: the behaviour, not the name of the mechanism.
  */
  ["unproven", "Rebuilding only what changed", "The landing demonstration follows a dependency path on declared fixture data. That is not a measurement of production impact precision, and it is not a shipped capability."],
] as const;

export const EVIDENCE_STATE: Record<string, string> = {
  measured: "MEASURED",
  unsupported: "NOT SUPPORTED",
  unproven: "BUILT, NOT PROVEN",
  direction: "IN PROGRESS",
};
