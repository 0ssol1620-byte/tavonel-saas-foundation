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

/** The document boundary this deployment enforces, in the order it is enforced. */
export const BOUNDARY = [
  ["01", "Quarantine", "Browser-direct, tenant-scoped intake. Document bytes never pass through the application or the database."],
  ["02", "Sanitize", "Antivirus and mandatory content disarm, with the sanitization proof kept as evidence."],
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
 */
export const EVIDENCE = [
  ["measured", "Recovery changes the outcome", "On a public benchmark with an unmodified scoring path, the recovery runtime moved a document extraction score substantially. Our own measurement, published with its confidence interval, and never placed beside a competitor's number as if reproduced."],
  ["measured", "Compilation refuses more than it emits, sometimes", "Of a thousand documents offered in one campaign, four hundred and four were refused, every one for a link the compiler could not resolve. A vault with a broken link is not emitted, by design."],
  ["unsupported", "Blind quality detection failed", "We tested whether prediction-only signals could pick the worst documents without ground truth. They could not beat ranking by length alone. Published as unsupported, and not shipped as a feature."],
  ["unproven", "Most thresholds are uncalibrated", "Tests show the code does what its author intended. They do not show a threshold is right. Nothing here presents an uncalibrated threshold as a measured result."],
  ["unproven", "Selective recompilation", "The landing demonstration follows a dependency path on declared fixture data. That is not a measurement of production impact precision, and it is not a shipped capability."],
] as const;

export const EVIDENCE_STATE: Record<string, string> = {
  measured: "MEASURED",
  unsupported: "NOT SUPPORTED",
  unproven: "BUILT, NOT PROVEN",
  direction: "IN PROGRESS",
};
