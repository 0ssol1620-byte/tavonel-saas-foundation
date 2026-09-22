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
 * BA-073 / BA-092: the receipt is a field, not a sentence.
 *
 * Both halves of the old shape were wrong for a public page. The filename ends in the internal
 * campaign name, which is not the public brand -- a reader who searched it found a company that
 * had renamed itself and left the old name in its evidence. And a 64-character digest typeset as
 * body prose wrapped mid-string inside the card, which read like console output pasted into a
 * paragraph.
 *
 * The filename and the digest stay here in full, because they are what makes a request for a
 * receipt answerable and because renaming an artifact breaks reproducibility -- the constitution
 * is explicit that artifact filenames and hashes keep their campaign names. What changes is what
 * is *rendered*: `/research/notes` prints the public identifier, the human description, the date
 * and a shortened digest, and the file is named only in the reply to someone who asks for it.
 */
export type EvidenceReceipt = {
  /** The identifier a reader can quote back to us. */
  readonly id: string;
  /** What the receipt is of, in words. */
  readonly of: string;
  readonly date: string;
  readonly digest: string;
  /** The artifact under `docs/evidence/artifacts/`. Not rendered; quoted when one is sent. */
  readonly file: string;
  /*
    G2-011. Where a reader fetches the bytes the digest is of.

    The published copy is byte-identical to the artifact named in `file` -- that is what makes
    the digest checkable, and `research-receipts.test.ts` hashes the file under `public/`
    against `digest` on every run, so a receipt that drifts fails the build rather than the
    reader.

    It is published under a public name rather than the internal one. The constitution's rule is
    that the artifact in the evidence repository keeps its campaign filename, and it does; a
    sha256 is of bytes and not of a name, so a copy served at a readable URL verifies identically
    while keeping a retired brand out of a public link.
  */
  readonly url: string;
};

export type EvidenceEntry = {
  readonly state: "measured" | "unsupported" | "unproven";
  readonly title: string;
  /*
    G2-045. One line of plain language, before the paragraph a researcher came for.

    R-01 assumed its reader knew olmOCR-Bench, what a recovery lane is, and how to read
    non-overlapping confidence intervals. Nothing is simplified and no figure moves: the takeaway
    says what the finding means for the person deciding whether to buy, and it may not introduce
    a number that is not on the receipt.
  */
  readonly takeaway: string;
  readonly body: string;
  readonly receipt?: EvidenceReceipt;
};

export const EVIDENCE: readonly EvidenceEntry[] = [
  {
    state: "measured",
    title: "Recovery changes the outcome",
    takeaway: "What this means for you: on a page that is hard to read, the recovery step is the difference between getting the document's content and getting an empty page.",
    body: "On olmOCR-Bench, scored by the benchmark's own evaluator at revision cfa88c1e, the same pipeline scored 80.6 with the recovery lane and 53.7 with only that lane switched off — a gap of 26.9 points, 95% confidence intervals 79.62–81.57 and 52.62–54.93, which do not overlap. Model, evaluator revision, corpus, source manifest, test set and settings were identical; the only difference was whether the documents recovery delivered carried their content. Measured 2026-08-08 over 1,403 documents and 8,413 checks. One category, headers and footers, scores higher without recovery, because a check that a phrase is absent passes trivially on an empty page — the no-recovery figure is generous rather than harsh.",
    receipt: {
      id: "R-01",
      of: "recovery counterfactual on olmOCR-Bench",
      date: "2026-08-08",
      digest: "1f5b6220c1fa569e8e33530d933a16eb7ad6b856c56e22f1744f8fa96efe33e0",
      file: "folynta-recovery-accuracy-counterfactual-olmocr-2026-08-08.json",
      url: "/research/receipts/R-01-recovery-counterfactual-olmocr-2026-08-08.json",
    },
  },
  {
    state: "measured",
    title: "Compilation refuses more than it emits, sometimes",
    takeaway: "What this means for you: when a document points at something that was not supplied with it, the compiler refuses that document rather than emitting a world with a dead link in it.",
    body: "Of a thousand documents offered, 596 compiled and 404 were refused, every one for a link the compiler could not resolve — most often a referenced figure asset that had not been supplied alongside the markdown. A vault with a broken link is not emitted, by design. Measured 2026-08-08, on that corpus and that build: a historical research measurement, not this service's live refusal rate, which is not published.",
    receipt: {
      id: "R-02",
      of: "knowledge-compilation properties on a thousand-document corpus",
      date: "2026-08-08",
      digest: "936b859c484fb54a8bdff3175d89d2fd47d695d48ec93b99fcfd93ac53ee2e25",
      file: "folynta-knowledge-compilation-properties-2026-08-08.json",
      url: "/research/receipts/R-02-knowledge-compilation-properties-2026-08-08.json",
    },
  },
  {
    state: "unsupported",
    title: "Blind quality detection failed",
    takeaway: "What this means for you: nothing here ranks your documents by a quality score, because the score we tested did not beat sorting by length.",
    body: "We tested whether prediction-only signals could pick the worst documents without ground truth. They could not beat ranking by length alone. Published as unsupported, and not shipped as a feature.",
  },
  {
    state: "unproven",
    title: "Thresholds are set by judgement, not calibration",
    takeaway: "What this means for you: the cut-offs that decide when the system refuses or merges are set by judgement rather than by a measurement, so ask before you depend on one.",
    body: "Tests show the code does what its author intended. They do not show a threshold is right. No threshold here is presented as a measured result.",
  },
  /*
    BA-075. This card was titled with a frozen mechanism name -- one of the technologies on the
    disclosure registry's publication freeze -- and it reached a public page through the one
    directory `prohibited-phrases.test.ts` was not walking. The entry itself stays, because it
    is a real published limit on what the landing demonstration establishes. What changes is the
    title: the behaviour, not the name of the mechanism.
  */
  {
    state: "unproven",
    title: "Rebuilding only what changed",
    takeaway: "What this means for you: the landing-page demonstration runs on sample data, and it is not a capability TAVONEL gives you today.",
    body: "The landing demonstration follows a dependency path on declared sample data. It is not a shipped capability.",
  },
];

/**
 * The badge each state prints.
 *
 * BA-091: `unproven` used to print "BUILT, NOT PROVEN", which is the public rendering of the
 * internal status word `IMPLEMENTED_NOT_PROVEN`. A badge brands a card rather than describing a
 * finding, so two of five entries were stamped with a negative state word by a page whose
 * subject is findings. "OPEN" is the finding those two actually support, and the card bodies keep
 * saying exactly what is and is not established -- which is where that belongs.
 *
 * MEASURED and NOT SUPPORTED stay: they are real result states a researcher expects to read.
 */
export const EVIDENCE_STATE: Record<string, string> = {
  measured: "MEASURED",
  unsupported: "NOT SUPPORTED",
  unproven: "OPEN",
  direction: "IN PROGRESS",
};

/*
  G2-011 removed the only caller. `/research/notes` prints the whole 64 characters beside the
  link that fetches the bytes they are of, because a shortened digest is enough to recognise a
  file and never enough to verify one.
*/
