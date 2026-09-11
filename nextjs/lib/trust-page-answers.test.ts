import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRUST_SEQUENCE } from "@/components/trust-next";
import { activationPolicy } from "@/lib/activation-policy";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

/*
  The comments in these files say what a sentence used to claim and why it stopped. That makes
  them full of the exact strings these checks forbid -- a comment reading "RPO and RTO are not
  set" contains "RPO" -- so anything asserting what the page does not say reads the stripped
  source. Anything asserting what the page does say may read either.
*/
const withoutComments = (source: string) =>
  source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

/*
  UX §17.1 lists the thirteen questions a customer asks a security page. `brand-copy.test.ts`
  already holds that the five trust pages form one chain; this holds that the first page in that
  chain answers the questions, because a funnel whose first step is silent about half of them
  sends the reader on to evidence they were not yet asking for.

  Each row is the question and the phrase the page answers it with. A phrase rather than a
  keyword: "encryption" appears in a dozen sentences that answer something else, and the point of
  the check is that *this* question has an answer, not that the word is somewhere on the page.
*/
const SECURITY_ANSWERS: Array<[string, string]> = [
  ["where data goes", "Tenant-scoped quarantine holds the bytes"],
  // The two statements a procurement reader looks for before reading any control on the page.
  ["data residency", "No data residency is guaranteed"],
  ["third-party audit", "no such review has been commissioned"],
  ["who can access it", "Access is a workspace membership checked server-side"],
  ["tenant isolation", "Workspace identity is derived server-side"],
  ["retention / deletion", "can be deleted on request"],
  ["malware / CDR", "Mandatory content disarm"],
  ["encryption", "encrypted at rest by the storage provider"],
  ["credential handling", "credentials are server-side secrets"],
  ["audit", "append-only audit row"],
  ["ACLs", "there are no roles, no SSO and no seat model"],
  ["provider isolation", "no tools, no broad credentials, no outbound network"],
  ["model data policy", "No third-party model API receives your documents"],
  ["training on customer data", "not used to train shared models"],
  ["recovery objectives", "Not yet answered"],
  // CA O01. The drill is a separate question from the objective, and both have to be here.
  ["tested restore", "One restore has been performed and checked"],
  // CA S08. Malware scanning and instruction injection are two questions; this is the second.
  ["instructions inside a document", "No model writes prose from your documents"],
  // CA I03. Source-level enforcement exists; its grain is the workspace, and that is the claim.
  ["source-level access", "The grain of that decision is the workspace, not the person"],
];

describe("/security answers the §17.1 questions", () => {
  const page = read("app/security/page.tsx") + read("lib/evidence-record.ts");

  it.each(SECURITY_ANSWERS)("answers %s", (_question, phrase) => {
    expect(page).toContain(phrase);
  });

  /*
    CA O01. The unanswered row narrowed, and this is the test that had to change with it.

    It used to require the title "Backup and recovery", which asserted three absences at once:
    no objective, no retention period, no tested restore. The third stopped being true on
    2026-09-10, so the row is now about the objectives alone. Keeping the old title would have
    kept a claim the deployment can no longer make honestly, in the opposite direction from the
    usual failure: a stated absence that is no longer absent.

    The comfort-word ban stays exactly as it was, and matters more now than before. One drill
    gives the page something friendly to say, which is precisely when a small edit turns
    "not yet answered" into durable storage, provider replication and daily snapshots -- none of
    which is a recovery objective, and all of which a buyer would read as one.
  */
  it("leaves the recovery objectives unanswered without reassuring anyone", () => {
    const unanswered = page.match(/const UNANSWERED = \[[\s\S]*?\] as const;/)?.[0] ?? "";
    expect(unanswered).toContain("Recovery objectives");
    expect(unanswered).toContain("Not yet answered");
    expect(unanswered).toContain("no recovery point objective");
    expect(unanswered).toContain("no recovery time objective");
    for (const comfort of ["replicated", "redundant", "daily", "point-in-time", "durable", "snapshot"]) {
      expect(unanswered.toLowerCase(), `"${comfort}" answers a different question than the one asked`)
        .not.toContain(comfort);
    }
    // And it has to be rendered, not just declared.
    expect(read("app/security/page.tsx")).toContain("UNANSWERED.map");
  });

  /*
    CA O01's other half, and its failure path.

    A drill is only evidence while it carries what it did not cover. The failure this guards is
    the edit that keeps the reassuring clause -- a restore was performed -- and drops the scope,
    leaving a reader to assume their documents were part of it. They were not: the bytes live in
    object storage and the drill was a database restore.
  */
  it("states the restore drill with its date, its parity count and its scope", () => {
    const controls = page.match(/const CONTROLS = \[[\s\S]*?\] as const;/)?.[0] ?? "";
    expect(controls).toContain("2026-09-10");
    expect(controls).toContain("2026-09-08 16:33:31 UTC");
    expect(controls).toContain("all 431 matched");
    expect(
      controls,
      'a drill that does not name what it left out reads as a recovery programme',
    ).toContain("It did not cover the document bytes in object storage");
    // And it must not become a commitment: the objective words belong in UNANSWERED only.
    const copy = withoutComments(controls);
    for (const commitment of ["recovery point objective", "recovery time objective", "RPO", "RTO"]) {
      expect(
        copy,
        `"${commitment}" in a control row turns one drill into a promise`,
      ).not.toContain(commitment);
    }
  });

  /*
    CA S08's failure path. The statement is only true while no generator is wired, so the page
    has to carry the gate as well as the fact -- otherwise the day an adapter lands, the page
    keeps asserting a safety property that stopped holding and nobody has to notice.
  */
  it("names the gate that has to run before a generator answers a request", () => {
    const controls = page.match(/const CONTROLS = \[[\s\S]*?\] as const;/)?.[0] ?? "";
    expect(controls).toContain("No model writes prose from your documents");
    expect(controls).toContain("the injection classes are re-run against a real generator");
    expect(
      controls,
      'the claim has to be dated to this deployment, not to the product',
    ).toContain("what is wired today");
  });

  /*
    §49: never preclaim. This was a substring ban over the whole page, and it moved to the shape
    `/trust` already uses, for the reason `/trust` already recorded: a rule that cannot tell a
    claim from its denial makes the honest sentence unwriteable, and an absence nobody is allowed
    to name is an absence the reader discovers after the pilot.

    So the three artefact names are allowed in the unanswered block, which is the only place on
    this page where naming one is a "no", and the words that would assert the claim -- certified,
    attestation, compliant, audited by -- stay banned outright.
  */
  it("names SOC 2, ISO 27001 and a penetration test only as things that do not exist", () => {
    const source = read("app/security/page.tsx");
    const absent = source.match(/const UNANSWERED = \[[\s\S]*?\] as const;/)?.[0] ?? "";
    expect(absent).not.toBe("");
    const elsewhere = withoutComments(source.replace(absent, " ")).toLowerCase();
    for (const artefact of ["soc 2", "soc2", "iso 27001", "iso27001", "pen test", "penetration test"]) {
      expect(elsewhere, `"${artefact}" outside the unanswered block reads as a claim`).not.toContain(artefact);
    }
    const row = absent.slice(absent.indexOf("Third-party certification"));
    expect(row).toContain("No SOC 2 report");
    expect(row).toContain("no ISO 27001 certificate");
    expect(row).toContain("no independent penetration-test report exists");
    expect(row, "a badge is the marketing decoration this row exists to refuse").toContain("no badge");
    expect(
      row,
      'none commissioned and one under way are the two answers a buyer is choosing between',
    ).toContain("no such review has been commissioned");
  });

  /*
    The roadmap sentence, and its failure path.

    One sentence of sequencing is authorised on this page and on `/trust` -- a delegated decision,
    2026-09-11 (orchestrator, under the founder's delegation), FD-12 in
    `docs/policy/DECISION_LOG_2026-09-11.md`, and reversible by the founder: an external
    penetration test after the first paying customer, and no SOC 2 timing. It is publishable
    because it contains no date and nothing scheduled. The edit this guards against is the one
    that adds a quarter, a month or an "under way" and turns an order of events into a commitment
    nobody has funded -- so the ban list is checked against the rendered copy of the block.

    What the sentence may not carry is the paperwork. The pin on "That sequencing is a delegated
    decision pending the founder's confirmation (decision log, FD-12)" is inverted rather than
    deleted: the decision log's "Public wording of delegated values" section says a public page
    states the commitment and nothing about the process, and the founder's merge of the pull
    request carrying that log is the confirmation. The provenance is the comment above the block.
  */
  it("sequences the external test without dating it", () => {
    const absent = withoutComments(
      read("app/security/page.tsx").match(/const UNANSWERED = \[[\s\S]*?\] as const;/)?.[0] ?? "",
    );
    expect(absent).toContain("An external penetration test is planned after the first paying customer");
    expect(absent).toContain("SOC 2 timing is not set");
    expect(absent, "the sequencing sentence carries no process label on a public page").not.toContain(
      "delegated decision pending the founder's confirmation",
    );
    expect(absent, "and no log id either").not.toContain("FD-12");
    expect(read("app/security/page.tsx"), "the provenance stays in the source, pointing at the log")
      .toContain("docs/policy/DECISION_LOG_2026-09-11.md");
    for (const schedule of ["q1", "q2", "q3", "q4", "under way", "underway", "by the end of", "this year", "next year", "in progress", "scheduled for"]) {
      expect(absent.toLowerCase(), `"${schedule}" turns a sequence into a date`).not.toContain(schedule);
    }
    expect(absent, "a year in this block is a date nobody has committed to").not.toMatch(/\b20\d\d\b/);
  });

  it("claims no certification, audit or attestation", () => {
    const copy = withoutComments(page).toLowerCase();
    for (const claim of ["attestation", "certified", "compliant", "audited by", "independently audited"]) {
      expect(copy, `"${claim}" is a claim this deployment cannot make`).not.toContain(claim);
    }
  });
});

describe("§17 trust chain", () => {
  it("runs Security → Evidence → Benchmarks → Reproducibility → Research, in that order", () => {
    expect(TRUST_SEQUENCE.slice(0, 5).map((step) => step.href)).toEqual([
      "/security", "/evidence", "/benchmarks", "/reproducibility", "/research",
    ]);
  });

  /*
    E-21. The category guide is not a step in the funnel, it is the page a reader arrives on
    before the funnel, and it used to end without offering either of the two pages that answer
    what it provokes. Held here rather than in a page test because the chain is the thing being
    protected: the guide is where a cold reader joins it.
  */
  it("hands the category guide's reader on to evidence and to benchmarks", () => {
    const guide = read("app/knowledge-compiler/page.tsx");
    expect(guide).toContain('href: "/evidence"');
    expect(guide).toContain('href: "/benchmarks"');
  });
});

/*
  T-13. `/trust` was a 308 to `/security` for as long as there was one security page, and a
  procurement reader was handed one of six URLs with no way to find the other five.

  These hold the index together in the only two ways that matter. A destination that stops being
  linked silently stops being reachable -- the page still renders, so nothing else fails -- and a
  Trust Center is the exact surface where "certified" gets written by someone who means "careful".
*/
describe("/trust indexes the six published surfaces", () => {
  const page = read("app/trust/page.tsx");

  it.each([
    "/security",
    "/subprocessors",
    "/status",
    "/privacy",
    "/terms",
    "/.well-known/security.txt",
  ])("links %s", (href) => {
    expect(page).toContain(href);
  });

  /*
    CA S09 / O01. This used to require the row "Backup and recovery", and that row was renamed
    to "Recovery objectives" because one of the three things it asserted was absent -- a tested
    restore -- stopped being absent on 2026-09-10. Requiring the old title would have required
    the old, now half-false claim. The objectives are the part still missing, so that is what
    the row has to name.

    Two more rows left this list on 2026-09-11 and the list shrank to two. The DPA and the
    incident procedure are published now, which means the assertion that has to exist is the
    opposite one: they must NOT be in the not-published block, or the page would be denying
    something it also links. Both directions are checked here, because "the string is somewhere on
    the page" was never the interesting half -- the row it is in is.
  */
  it("says which elements are not published, without promising them", () => {
    const absent = page.match(/const NOT_PUBLISHED[\s\S]*?\];/)?.[0] ?? "";
    expect(absent).not.toBe("");
    for (const missing of ["Recovery objectives", "Third-party certification and audit"]) {
      expect(absent, `${missing} is the honest absence this block exists for`).toContain(missing);
    }
    for (const published of ["Data processing agreement", "Incident response", "Data residency"]) {
      expect(
        absent,
        `${published} is published now -- a page that links it and lists it as absent contradicts itself`,
      ).not.toContain(published);
    }
    for (const promise of ["coming soon", "will be published", "shortly", "in progress", "roadmap"]) {
      expect(absent.toLowerCase(), `"${promise}" turns a missing answer into a commitment`).not.toContain(promise);
    }
    // The one authorised sequencing sentence carries no date, on this page as on /security.
    expect(absent).toContain("An external penetration test is planned after the first paying customer");
    expect(absent).toContain("SOC 2 timing is not set");
    for (const schedule of ["q1", "q2", "q3", "q4", "under way", "underway", "by the end of", "scheduled for"]) {
      expect(absent.toLowerCase(), `"${schedule}" turns a sequence into a date`).not.toContain(schedule);
    }
  });

  /*
    P1. The DPA is served as a file, and this is the pair of facts that makes publishing an
    unsigned contract safe: the reader gets the URL and the label together, and the numbers on the
    page are the numbers in the document.

    The failure path is the edit that keeps the link and loses the label. A reader who sees the URL
    without "draft ... not a signed agreement" has been handed a contract, so the label is asserted
    inside the anchor rather than merely somewhere on the page.

    The label names the document's status in the customer's words: it is a draft, it is under
    review, and it is not a signed agreement. The pins that used to require "delegated decision
    pending the founder's confirmation and legal review" here, on the incident row and on the
    certification row are inverted rather than deleted -- the "Public wording of delegated values"
    section of `docs/policy/DECISION_LOG_2026-09-11.md` (FD-06/07, FD-12) says the process
    vocabulary stays in the log, the page states the commitment, and the founder's merge of the
    pull request carrying that log is the confirmation. What may never happen in either regime is
    the page attributing a delegated decision to the founder, so that ban stays exactly as it was,
    and the provenance has to remain findable in the source.
  */
  it("links the DPA with its draft label in the same tile", () => {
    expect(page).toContain('const DPA_URL = "/policy/TAVONEL_DPA_v1_2026-09-11.md"');
    expect(page).toContain("Draft v1 (2026-09-11)");
    expect(page).toContain("under review");
    expect(page).toContain("not a signed agreement");
    expect(page, "no copy here may present a delegated decision as the founder's own").not.toMatch(
      /founder decided|decided by the founder/,
    );
    const tile = page.slice(page.indexOf("href={DPA_URL}"));
    expect(tile.slice(0, 600), "the label has to travel with the link").toContain("{DPA_LABEL}");
    // Block comments and whole-line `//` comments both. Not a blanket "//" strip: a URL in the
    // copy carries one, and eating the rest of that line would hide real text from the ban below.
    const copy = withoutComments(page)
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    for (const process of [
      "delegated decision pending the founder's confirmation",
      "pending the founder's confirmation",
      "FD-06/07",
      "FD-12",
    ]) {
      expect(copy, `"${process}" is process vocabulary and belongs in the log, not on the page`)
        .not.toContain(process);
    }
    expect(page, "the provenance stays in the source, pointing at the log row").toContain(
      "docs/policy/DECISION_LOG_2026-09-11.md",
    );
    for (const commitment of [
      "within 72 hours",
      "30 days in advance",
      "right to object",
      "within 30 days of a verified request",
    ]) {
      expect(page, `the page must state the same "${commitment}" the document commits to`).toContain(commitment);
    }
  });

  it("serves a DPA whose commitments match the ones the page advertises", () => {
    const document = read("public/policy/TAVONEL_DPA_v1_2026-09-11.md");
    expect(document).toContain(
      "**Draft v1 (2026-09-11) — under review; not a signed agreement.**",
    );
    /*
      The served document is a public artefact, so the same rule applies to it: the status is the
      customer's to read, the paperwork is not. The old pin required the decision-log path in the
      served text; it is inverted, and the path is asserted in the HTML comment at the top of the
      file instead -- which is where a reviewer of the repository, not a customer, will look.
    */
    const served = document.replace(/<!--[\s\S]*?-->/g, " ");
    for (const process of ["delegated decision", "pending the founder", "FD-06/07"]) {
      expect(served, `"${process}" is process vocabulary, not contract text`).not.toContain(process);
    }
    expect(document, "the provenance stays in the file, as a comment").toContain(
      "docs/policy/DECISION_LOG_2026-09-11.md",
    );
    expect(document).toContain("without undue delay and no later than 72 hours after becoming aware");
    expect(document).toContain("30 days in advance of that sub-processor beginning to process");
    expect(document).toContain("right to object");
    expect(document).toContain("completed within 30 days of the verified request");
    // The clauses that are not drafted have to say so in place rather than be quietly absent.
    expect(document).toContain("Not drafted — pending legal review");
    expect(document, "the deletion clause must not promise a provider's backup expiry").toContain(
      "publishes no day count for it",
    );
  });

  /*
    P1's other half. The customer-facing incident summary leads with the absence of an on-call
    rotation, because that is the fact a buyer would otherwise learn during an incident -- and
    because a 72-hour window read without it looks like a staffed process.
  */
  it("summarises incident response with the on-call absence before the window", () => {
    const published = page.match(/const PUBLISHED[\s\S]*?\n\];/)?.[0] ?? "";
    expect(published).toContain("Incident response");
    const row = published.slice(published.indexOf('["Incident response"'));
    const summary = row.slice(0, row.indexOf("],") + 1);
    expect(summary).toContain("There is no on-call rotation");
    expect(summary).toContain("72 hours");
    expect(
      summary.indexOf("no on-call rotation") < summary.indexOf("72 hours"),
      "the window read without the staffing reads as a staffed process",
    ).toBe(true);
    expect(summary, "no tabletop has been run and the summary may not imply one").toContain(
      "No tabletop exercise has been run yet",
    );
    // The procedure itself stays internal; the page must not claim to publish it.
    expect(summary.toLowerCase()).not.toContain("severity");
  });

  /*
    S09's failure path, and the reason this is not simply a substring ban any more.

    The previous check forbade "soc 2", "iso 27001" and "penetration test" anywhere on the
    page, which is a rule that cannot tell a claim from its denial: the honest sentence the
    audit asks for -- that none of the three exists -- is unwriteable under it, and an absence
    nobody is allowed to name is an absence the reader has to discover later.

    So the three artefact names are now allowed only inside the not-published list, which is
    the only place on the page where naming one is a "no". The words that assert the claim --
    certified, compliant, attestation, audited by -- stay banned outright, and the row has to
    keep saying that nothing has been commissioned, because "none exists yet" and "one is
    under way" are the two different answers a buyer is choosing between.
  */
  it("names SOC 2, ISO 27001 and a penetration test only as things that do not exist", () => {
    const absent = page.match(/const NOT_PUBLISHED[\s\S]*?\];/)?.[0] ?? "";
    const elsewhere = withoutComments(page.replace(absent, " ")).toLowerCase();
    for (const artefact of ["soc 2", "soc2", "iso 27001", "iso27001", "pen test", "penetration test"]) {
      expect(
        elsewhere,
        `"${artefact}" outside the not-published list reads as a claim`,
      ).not.toContain(artefact);
    }
    const row = absent.slice(absent.indexOf("Third-party certification"));
    expect(row).toContain("No SOC 2 report");
    expect(row).toContain("no ISO 27001 certificate");
    expect(row).toContain("no independent penetration-test report exists");
    expect(row, "a badge is the marketing decoration this row exists to refuse").toContain("no badge");
    expect(
      row,
      'none commissioned and one under way are the two answers a buyer is choosing between',
    ).toContain("no such review has been commissioned");
  });

  it("claims no certification, audit or attestation", () => {
    for (const claim of ["attestation", "certified", "compliant", "audited by", "independently audited"]) {
      expect(page.toLowerCase(), `"${claim}" is a claim this deployment cannot make`).not.toContain(claim);
    }
  });

});

/* C-13 / K-07. This string is public runtime copy, so it names the controls on the active path. */
describe("§37 the CDR row names the build that is actually running", () => {
  const reason = activationPolicy.cdr.reason;

  it("names the deployed private sanitizer path", () => {
    expect(reason).not.toContain("tavonel-cdr-synthetic");
    expect(reason).toContain("IAM-only");
    expect(reason).toContain("PDFium");
    expect(reason).toContain("ClamAV");
  });

  it("states the transport and artifact boundaries", () => {
    expect(reason).toContain("short-lived workload identity");
    expect(reason).toContain("refuses redirects");
    expect(reason).toContain("digest-bound immutable PDFs");
  });
});

describe("§77 /status scope", () => {
  const page = read("app/status/page.tsx");

  it("says what its rows are, so 'operational' cannot be read as a probe", () => {
    expect(page).toContain("not an uptime probe");
    expect(page).toContain("configured and its gate is open");
  });

  it("never claims all systems are operational", () => {
    // The one sentence §77 names. It is a summary nothing on this page is entitled to compute.
    expect(page.toLowerCase()).not.toContain("all systems");
  });
});

/*
  CA B04 / B07. Five hub pages, five different questions, and until this campaign nothing on any
  of them said which question it answered -- so a reader who wanted one of the five read parts of
  three and left with a worse answer than any single page gave.

  Held as data rather than as five hand-written assertions, because the failure mode is one page
  quietly losing its line in an unrelated edit, and a list is the only version of this check that
  notices. The role line has to name the other pages too: a page that says what it is for and
  nothing about its neighbours still leaves the reader to guess where the next question goes.
*/
const HUBS: Array<[string, string]> = [
  ["app/trust/page.tsx", "what is published about security and"],
  ["app/evidence/page.tsx", "how a compiled result stays bound to the"],
  ["app/benchmarks/page.tsx", "what a knowledge-compilation result has to"],
  ["app/research/page.tsx", "which problems are still open"],
  ["app/research/notes/page.tsx", "what has actually been measured"],
];

describe("CA B04 the five hubs each say which question they answer", () => {
  it.each(HUBS)("%s states its own role", (surface, role) => {
    expect(read(surface)).toContain(role);
  });

  it.each(HUBS)("%s points at the neighbouring hubs by name", (surface) => {
    const source = read(surface);
    const named = ["/evidence", "/benchmarks", "/reproducibility", "/research", "/trust"]
      .filter((href) => !surface.includes(href.slice(1) + "/page"))
      .filter((href) => source.includes(href));
    expect(named.length, `${surface} names none of its siblings`).toBeGreaterThanOrEqual(3);
  });

  /*
    /reproducibility renders through the shared registry component, so its only prose slot is the
    summary prop. Checked separately rather than bent into the list above.
  */
  it("reproducibility states its role in the summary the registry renders", () => {
    const source = read("app/reproducibility/page.tsx");
    expect(source).toContain("can you rerun the same input and get the same bytes");
    expect(source).toContain("/research/notes");
  });
});

/*
  CA B07. The audit is right that the trust case is architecture rather than customer outcomes,
  and the fix is not a case study -- there are no consented customers, so writing one would be the
  fabrication the constitution forbids. The fix is a label where a reader looks for the case, so
  the absence reads as a state rather than as an oversight.

  The failure path is the more important half: the day a customer result does appear, it must not
  appear as a logo wall with no consent behind it. So the same test that requires the label also
  requires that no page has quietly grown a fabricated one.
*/
const CASE_SURFACES = [
  "app/evidence/page.tsx",
  "app/benchmarks/page.tsx",
  "app/reproducibility/page.tsx",
] as const;

describe("CA B07 customer cases are labelled absent, not implied", () => {
  it.each(CASE_SURFACES)("%s says customer results need written consent and there are none", (surface) => {
    const source = read(surface);
    expect(source).toContain("only with written consent");
    expect(
      source.toLowerCase(),
      'a page that names consent has to say whether it has any',
    ).toMatch(/no customer has given it|none has been given/);
  });

  it.each(CASE_SURFACES)("%s invents no customer, logo or before-and-after figure", (surface) => {
    const copy = withoutComments(read(surface)).toLowerCase();
    for (const invention of ["case study", "testimonial", "trusted by", "customers like", "hours saved", "logo wall"]) {
      expect(copy, `"${invention}" needs a consented customer behind it`).not.toContain(invention);
    }
  });
});

/*
  CA E02 / E05. The two measured entries described their own numbers instead of stating them, so
  a reader could not check either one: "moved a document extraction score substantially" is not a
  figure, and "in one campaign" is not a date.

  Every string below was copied from the campaign receipt named in the same entry, and the point
  of the test is that they stay copied. The failure path is the edit that rounds 80.6 to 81, drops
  the confidence interval, or -- the one the audit actually warns about -- lets the 404 refusals
  read as this service's current failure rate by removing the word that dates them.
*/
describe("CA E02/E05 the measured entries carry their figures and their receipts", () => {
  const record = read("lib/evidence-record.ts");

  it("states the recovery delta with both confidence intervals", () => {
    expect(record).toContain("80.6 with the recovery lane and 53.7");
    expect(record).toContain("26.9 points");
    expect(record).toContain("79.62\u201381.57");
    expect(record).toContain("52.62\u201354.93");
    expect(record, "a delta without its denominator is not a measurement").toContain("1,403 documents and 8,413 checks");
    expect(record).toContain("folynta-recovery-accuracy-counterfactual-olmocr-2026-08-08.json");
    expect(record).toContain("1f5b6220c1fa569e8e33530d933a16eb7ad6b856c56e22f1744f8fa96efe33e0");
  });

  it("dates the refusal count and says it is not a live rate", () => {
    expect(record).toContain("596 compiled and 404 were refused");
    expect(record).toContain("Measured 2026-08-08");
    expect(
      record,
      'the audit warns specifically against reading 404 of 1,000 as a current failure rate',
    ).toContain("not this service's live refusal rate");
    expect(record).toContain("folynta-knowledge-compilation-properties-2026-08-08.json");
    expect(record).toContain("936b859c484fb54a8bdff3175d89d2fd47d695d48ec93b99fcfd93ac53ee2e25");
  });

  it("keeps the vague wording from coming back", () => {
    // The comment above the list quotes the old wording in order to explain it, so the check
    // reads the copy rather than the explanation of the copy.
    const copy = withoutComments(record);
    for (const vague of [
      "moved a document extraction score substantially",
      "published with its confidence interval",
      "in one campaign",
    ]) {
      expect(copy, `"${vague}" describes a number instead of stating it`).not.toContain(vague);
    }
  });

  /*
    A named receipt a reader cannot reach is half an answer, so the page that renders these
    entries has to say where the files are and how to ask for one.
  */
  /*
    BA-073 / BA-074, 2026-09-11. The same requirement, pinned to a sentence a buyer can read.

    The paragraph this used to check published an internal repository path, the internal words
    "campaign" and "claims pack", the admission that our own evidence is not reachable at a URL,
    and then asked the reader to email for an attachment. Two of its facts were worth keeping --
    a receipt is bound by sha256, and we will send one -- and those are the two a reader can act
    on.

    So the check is stricter in both directions than the three substrings it replaces: the
    actionable facts are still required, and the internal vocabulary is asserted absent.
    `withoutComments` matters, because the page explains in a comment which words it stopped
    printing.
  */
  it("says on the page that a receipt is hash-bound and how to get one", () => {
    const notes = withoutComments(read("app/research/notes/page.tsx"));
    expect(notes).toContain("bound by sha256");
    expect(notes).toContain("Request any receipt named here");
    expect(notes).toContain("check the hash");
    expect(notes).toContain("hello@tavonel.com");
    // BA-089: the missing space that rendered as "Askhello@tavonel.com".
    expect(notes, "a JSX element after a word needs its space").not.toMatch(/[a-z]\s*\n?\s*<a href="mailto/);
    for (const internal of ["docs/evidence/artifacts/", "claims pack", "campaign", "not published at a public URL"]) {
      expect(notes, `"${internal}" is internal vocabulary on a public page`).not.toContain(internal);
    }
  });

  /*
    BA-073 / BA-092. The receipt is a field now, and the page renders its public half.

    The filename stays in `lib/evidence-record.ts` -- the two assertions above describe why, and
    renaming an artifact would break the reproducibility its hash exists for -- but the retired
    internal campaign name may not reach the page, and a 64-character digest may not be typeset
    as body prose. Both are asserted on the page rather than on the record.
  */
  it("renders a receipt identifier and a shortened digest, not an internal filename", () => {
    const notes = withoutComments(read("app/research/notes/page.tsx"));
    expect(notes).toContain("Receipt {entry.receipt.id}");
    expect(notes).toContain("shortDigest(entry.receipt.digest)");
    // The whole value stays one hover or one copy away, so nothing is withheld.
    expect(notes).toContain("title={`sha256 ${entry.receipt.digest}`}");
    expect(notes.toLowerCase(), "the internal campaign name may not be rendered").not.toContain("folynta");
    expect(notes, "a receipt file name may not be rendered").not.toContain(".json");
  });
});

/*
  CA S04. The privacy notice said data remains until deletion and that backup remnants expire on
  the provider schedule, which is true and answers none of what a buyer asks: which parts happen
  when you act, which parts a person does, and where no number exists.

  Each assertion here corresponds to something read out of the code -- the token delete that runs
  before the revoke, the suspension that lands on the next request, the absence of any object or
  workspace delete route, and the deletion-receipt gate nothing calls. The failure path is the
  edit that supplies a comfortable day count: a published retention period that no run has ever
  measured is the unsupported claim this repository stops the line for.
*/
describe("CA S04 the privacy notice states deletion mechanics and no invented number", () => {
  const page = read("app/privacy/page.tsx");

  it("names what happens immediately, and that it fails rather than reporting success", () => {
    expect(page).toContain("deletes the stored provider refresh token immediately");
    expect(page).toContain("the disconnect returns an error rather than reporting success");
    expect(page).toContain("with no wait for a background reindex");
  });

  it("says a person carries out the rest, because no self-service path exists", () => {
    expect(page).toContain("There is no self-service action that deletes a workspace");
    expect(page).toContain("privacy@tavonel.com");
  });

  it("says where a number is missing instead of supplying one", () => {
    expect(page).toContain("We publish no completion time for that");
    expect(page).toContain("we publish no day count for it");
    expect(page).toContain("have no published retention period");
  });

  it("promises no deletion receipt, because no route issues one", () => {
    expect(page).toContain("no part of the running service issues one today");
  });

  it("invents no retention period in days", () => {
    const copy = withoutComments(page);
    const numbers = copy.match(/\b\d+\s*(?:calendar )?(?:days?|weeks?|months?|years?)\b/gi) ?? [];
    const invented = numbers.filter((match) => !/180 days/.test(match));
    expect(
      invented,
      `a retention period in days has to come from a measured run: ${invented.join(", ")}`,
    ).toEqual([]);
  });
});

/*
  CA I04. Both private-source rows were labelled Customer-run, which is the honest label and not
  yet an answer. The two facts a customer is most likely to be surprised by are that one run is
  one sync, and that the agent never retries -- so those are the two this test refuses to let a
  later edit soften into something that sounds managed.
*/
describe("CA I04 /integrations states how the customer-run agent actually behaves", () => {
  const page = read("app/integrations/page.tsx");

  it.each([
    ["one run is one sync", "One invocation performs one sync and exits"],
    ["no internal schedule", "has no internal timer"],
    ["no retry", "There is no retry inside the agent"],
    ["cursor written last", "written only after we have committed the batch"],
    ["update channel", "/developer/channel.json"],
    ["who is responsible", "are yours, because the agent runs inside your network"],
    ["read-only", "the agent never writes to your source"],
  ])("states %s", (_question, phrase) => {
    expect(page).toContain(phrase);
  });

  it("does not describe the agent as managed, monitored or self-updating", () => {
    const copy = withoutComments(page).toLowerCase();
    // "There is no self-update" is the page stating the absence, so the banned form is the
    // positive one: a sentence claiming the agent keeps itself current, retries, or is watched.
    for (const overclaim of ["updates itself", "automatically retries", "always in sync", "we monitor"]) {
      expect(copy, `"${overclaim}" is not what the script does`).not.toContain(overclaim);
    }
  });
});

/*
  The one number about /trust that is typed on another page.

  `/pricing`'s purchase-friction row for "Can an enterprise security review approve it?" quotes a
  count of what the trust index publishes. It said ten of thirteen with three absences, which was
  already wrong when it was written and became wronger when the 2026-09-11 lanes answered the DPA
  and residency questions. A count on a buyer surface that no test reads is a count that drifts,
  so both sentences are held to the same number here -- and to the arrays they describe, which are
  what a reader who counts the rows will find.
*/
describe("the security-review count reconciles across the two pages that state it", () => {
  const trust = withoutComments(read("app/trust/page.tsx"));
  const pricing = withoutComments(read("components/pricing-page-client.tsx"));
  const rows = (source: string, start: string, end: string) =>
    (source.slice(source.indexOf(start), end ? source.indexOf(end) : undefined).match(/^ {2}\[/gm) ?? []).length;

  it("says twelve answered and one unanswered on both pages", () => {
    expect(trust, "/trust's lede").toContain("Twelve of them are");
    expect(trust, "/trust names the one absence").toContain("One is not answered");
    expect(pricing, "/pricing quotes the same count").toContain("Twelve of the thirteen things such a review asks are published");
    expect(pricing, "/pricing quotes the same absence").toContain("this deployment sets no recovery objective");
    expect(pricing, "the superseded count must not come back").not.toContain("Ten of the thirteen");
  });

  it("matches the rows a reader would count on the page", () => {
    // Thirteen published = §45's twelve answered plus the residency row the checklist never asks;
    // two not published = the recovery objective and the external audit.
    expect(rows(read("app/trust/page.tsx"), "const PUBLISHED", "const NOT_PUBLISHED")).toBe(13);
    expect(rows(read("app/trust/page.tsx"), "const NOT_PUBLISHED", "export default")).toBe(2);
  });
});
