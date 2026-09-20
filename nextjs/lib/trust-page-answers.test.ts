import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRUST_SEQUENCE } from "@/components/trust-next";
import { activationPolicy } from "@/lib/activation-policy";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const publicTrustContract = read("lib/public-trust-contract.ts");

/*
  The comments in these files say what a sentence used to claim and why it stopped. That makes
  them full of the exact strings these checks forbid -- a comment reading "RPO and RTO are not
  set" contains "RPO" -- so anything asserting what the page does not say reads the stripped
  source. Anything asserting what the page does say may read either.
*/
const withoutComments = (source: string) =>
  source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

const SECURITY_ANSWERS: Array<[string, string]> = [
  ["where data goes", "workspace-scoped intake boundary"],
  ["who can access it", "workspace membership are resolved server-side"],
  ["tenant isolation", "Data access is scoped to the authenticated workspace"],
  ["retention / deletion", "follow the applicable workspace policy and legal-hold state"],
  ["encryption in transit", "Traffic is encrypted in transit"],
  ["encryption at rest", "stored objects are encrypted at rest"],
  ["credential handling", "service credentials remain on trusted server boundaries"],
  ["audit", "sensitive administration events are recorded"],
  ["source access", "suspended, deleted or cannot be verified is refused"],
  ["training on customer data", "not used to train shared models"],
  ["human activation", "cannot silently replace the active World"],
  ["failure semantics", "protected action is refused rather than treated as successful"],
  ["controlled review", "architecture, control evidence and questionnaire responses"],
];

describe("/security publishes customer-relevant controls without the internal review inventory", () => {
  const page = read("app/security/page.tsx") + read("lib/security-claims.ts");

  it.each(SECURITY_ANSWERS)("answers %s", (_question, phrase) => {
    expect(page).toContain(phrase);
  });

  it("keeps topology, providers and implementation gaps out of the public page", () => {
    const copy = withoutComments(read("app/security/page.tsx"));
    for (const internal of [
      "ProcessingRegionTable", "TrustDisclosures", "activationPolicy", "RunPod", "Cloud Run",
      "ClamAV", "generator seam", "injection classes", "authorization_revision", "RPO", "SOC 2",
    ]) {
      expect(copy, `"${internal}" belongs in controlled review or the maintained Trust record`)
        .not.toContain(internal);
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
  it("routes deployment-specific evidence through a qualified review", () => {
    const copy = withoutComments(page);
    for (const material of ["Deployment-specific architecture", "control evidence", "assurance scope", "questionnaire responses"]) {
      expect(copy).toContain(material);
    }
    expect(copy).toContain("qualified review");
    expect(copy).not.toContain("NOT_PUBLISHED");
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
    expect(page, "internal decision history does not belong in customer-facing source").not.toContain(
      "docs/policy/DECISION_LOG_2026-09-11.md",
    );
    for (const commitment of [
      "breach-notification",
      "sub-processor change",
      "verified-request deletion right",
    ]) {
      expect(page, `the page must state the same "${commitment}" the document commits to`).toContain(commitment);
    }
    expect(page).not.toContain("deletion completed within 30 days");
  });

  it("serves a DPA whose commitments match the ones the page advertises", () => {
    const document = read("public/policy/TAVONEL_DPA_v1_2026-09-11.md");
    expect(document).toContain(
      "**Draft v1 (2026-09-11) — under review; not a signed agreement.**",
    );
    /*
      BA-147. The served document is a public artefact and the rule now applies to all of it,
      comments included. The provenance used to be pinned *in* the file, as an HTML comment -- and
      because the file is served raw, the third line of our data processing agreement was a comment
      naming one of our test files and an internal repository path. A reviewer of the repository
      finds the provenance where the page that links the document keeps it (asserted above, on
      app/trust/page.tsx); a customer reading the contract finds contract text.

      So the ban widened instead of moving: no repository path, no test filename, and none of the
      process vocabulary, anywhere in the file.
    */
    for (const process of ["delegated decision", "pending the founder", "FD-06/07"]) {
      expect(document, `"${process}" is process vocabulary, not contract text`).not.toContain(process);
    }
    expect(document, "a served contract names no repository path").not.toMatch(/docs\/[a-z]/i);
    expect(document, "and no test file of ours").not.toContain(".test.ts");
    expect(document).toContain("without undue delay and no later than 72 hours after becoming aware");
    expect(document).toContain("30 days in advance of that sub-processor beginning to process");
    expect(document).toContain("right to object");
    expect(document).toContain("No fixed operational completion period is committed in this draft");
    expect(document).toContain("applicable legal hold or retention duty");
    expect(document).toContain("provider's lifecycle");
    expect(document).not.toContain("completed within 30 days of the verified request");
    /*
      BA-170. The clauses that are not settled still have to say so where a reader looks for them.
      They said it four times as "Not drafted — pending legal review", which reads as a document
      somebody abandoned; they now say it as clauses and are collected in one annex. Both halves
      are pinned -- the in-place marker on each of the four, and the annex that lists them -- so
      neither can be dropped without a red test, which is tighter than the one substring was.
    */
    expect(document).toContain("## Annex A — clauses completed at signature");
    /*
      G2-018 and G2-019 (SD-07), 2026-09-16 — edited from the commerce-legal lane, which owns the
      copy this case pins and not this file. Listed as a cross-lane note in that lane's report.

      Three of the four clauses this case pinned as open are settled in Draft v1, so the markers
      it looked for are gone by design rather than by accident: governing law and jurisdiction in
      §1 (Republic of Korea, Seoul Central District Court, the same as /terms), the transfer
      mechanism in §10 (the Standard Contractual Clauses, the UK Addendum for a transfer from the
      United Kingdom, and the module mapping), and the liability cap in §13 at the fees of the
      preceding twelve months, which is the cap /terms states.

      The shape of the guard does not change, and the shape is what matters: a clause still open
      is listed in Annex A *and* marked in place in the body, and a clause now settled is pinned
      to the words that settle it. An edit that quietly reopens one, or that states a different
      cap here than on /terms, fails here instead of shipping two contracts.
    */
    for (const clause of ["§9 Recovery objectives", "§10 Transfer annexes", "§13 Signature"]) {
      expect(document, `${clause} has to be listed in the annex`).toContain(clause);
    }
    for (const inPlace of [
      "Recovery objectives and a drill cadence: to be specified in the executed version",
      "The signature blocks and the parties' registered details are completed in the",
    ]) {
      expect(document, `"${inPlace}" is the marker in place; the annex is not a substitute for it`)
        .toContain(inPlace);
    }
    for (const settled of [
      "| Governing law | The Republic of Korea, with the Seoul Central District Court",
      "**Transfer mechanism: the Standard Contractual Clauses.**",
      "limited to the fees paid to TAVONEL in the twelve months immediately before the event",
    ]) {
      expect(document, `"${settled}" is a Draft v1 term and may not be quietly reopened`)
        .toContain(settled);
    }
    expect(
      read("app/terms/page.tsx"),
      "the cap in the DPA and the cap on /terms are one number, not two",
    ).toContain("fees you paid to TAVONEL in the twelve months");
    expect(document, "the party block may not deny what the live operator disclosure publishes")
      .not.toContain("is not published in the pilot deployment");
    expect(document, "and the document may not publish our project plan as a checklist")
      .not.toContain("What has to happen before this is a signable document");
    expect(document, "the deletion clause must not promise a provider's backup expiry").toContain(
      "publishes no day count",
    );
  });

  it("keeps incident staffing and internal response mechanics out of the public index", () => {
    const copy = withoutComments(`${page}\n${publicTrustContract}`).toLowerCase();
    for (const internal of ["one person", "headcount", "on-call rotation", "triage tier", "tabletop exercise"]) {
      expect(copy).not.toContain(internal);
    }
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
  it("does not expose a certification or audit gap inventory", () => {
    const copy = withoutComments(`${page}\n${publicTrustContract}`).toLowerCase();
    for (const inventory of ["soc 2", "iso 27001", "penetration test", "penetration-test"]) {
      expect(copy).not.toContain(inventory);
    }
    expect(copy).not.toMatch(/\b(?:rpo|rto)\b/);
    expect(copy).toContain("assurance scope");
  });

  it("claims no certification, audit or attestation", () => {
    for (const claim of ["attestation", "certified", "compliant", "audited by", "independently audited"]) {
      expect(page.toLowerCase(), `"${claim}" is a claim this deployment cannot make`).not.toContain(claim);
    }
  });

});

describe("§37 the CDR row states the customer boundary without exposing operations", () => {
  const reason = activationPolicy.cdr.reason;

  it("keeps the protections a customer can evaluate", () => {
    expect(reason).toContain("tenant-scoped quarantine");
    expect(reason).toContain("sanitized");
    expect(reason).toContain("Downstream processing reads only");
    expect(reason).toContain("immutable PDF");
    expect(reason).toContain("content digest");
  });

  it("keeps private implementation and transport detail out of public runtime copy", () => {
    for (const detail of ["IAM-only", "PDFium", "ClamAV", "Google Cloud Run", "asia-northeast3", "workload identity", "redirects", "Worker"]) {
      expect(reason, `${detail} belongs in private operational evidence`).not.toContain(detail);
    }
  });
});

describe("§77 /status scope", () => {
  const page = read("app/status/page.tsx");

  /*
    BA-136. §77's requirement is that a reader cannot take "operational" on this page for a
    request that succeeded. The page used to meet it with three negations before saying what it
    was -- "not an uptime probe", "not that a request has just succeeded" -- and it now meets it
    by stating both halves positively: what the word means, and which section answers the other
    question. Both halves are pinned, so the distinction cannot be dropped by editing one line.
  */
  it("says what its rows are, so 'operational' cannot be read as a probe", () => {
    expect(page).toContain("configured and its gate is open");
    expect(page).toContain("the separate question the scheduled checks answer");
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

/*
  BA-072, 2026-09-11. The label stays. Where it is said, and how many times, changes.

  B07 was right that an absence nothing names reads as an oversight. What it produced was the
  identical sentence -- ending on "no customer has given it" -- printed on all three surfaces
  above, so three pages volunteered to a reader who had not asked, and to no legal requirement,
  that we have no customers. /reproducibility ended its *hero paragraph* on it.

  The consent policy is a policy, so it is stated once, on /trust, as one: customer names,
  figures and logos appear on this site only with that customer's written sign-off on the exact
  wording. No sentence anywhere states the current count.

  The failure path is the half that matters and it is unchanged in force: the day a customer
  result does appear it must not appear as a logo wall with no consent behind it. That check
  still runs on all three surfaces, and a new one holds the policy to its single home -- so
  deleting it from /trust fails here, and restoring it to the other three fails here too.
*/
describe("CA B07 customer cases are labelled absent, not implied", () => {
  it("states the consent policy once, on /trust, with no count of customers", () => {
    const trust = read("app/trust/page.tsx");
    expect(trust).toContain("only with");
    expect(trust.toLowerCase()).toContain("written sign-off");
    // Stripped: the paragraph's own comment quotes the sentence it replaced, on purpose.
    expect(
      withoutComments(trust).toLowerCase(),
      "the policy says what the rule is, not how many have met it",
    ).not.toMatch(/no customer has given it|none has been given/);
  });

  it.each(CASE_SURFACES)("%s neither repeats the consent policy nor counts our customers", (surface) => {
    const copy = withoutComments(read(surface)).toLowerCase();
    expect(copy, "the consent policy has one home, and it is /trust")
      .not.toContain("only with written consent");
    expect(copy, "a public page does not publish the number of customers we have")
      .not.toMatch(/no customer has given it|none has been given/);
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
  /*
    G2-011. "Request any receipt named here at hello@tavonel.com" was the whole verification
    path, and it was not one: a digest you cannot check against a file you cannot fetch verifies
    nothing. The receipts are published now, so what this asserts inverts -- the page has to say
    how to check a hash, and it may no longer route a reader to an inbox to get one.
  */
  it("says on the page that a receipt is hash-bound and how to check one", () => {
    const notes = withoutComments(read("app/research/notes/page.tsx"));
    expect(notes).toContain("bound by sha256");
    expect(notes).toContain("published here");
    expect(notes).toContain("hash it yourself");
    expect(notes, "an email request is not a verification path").not.toContain("mailto:");
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
  it("renders the whole digest and the file it is of, never the internal filename", () => {
    const notes = withoutComments(read("app/research/notes/page.tsx"));
    expect(notes).toContain("Receipt {entry.receipt.id}");
    // BA-092's shortened digest was enough to recognise a file and never enough to verify one.
    expect(notes, "the published digest is the whole value").toContain("<code>{entry.receipt.digest}</code>");
    expect(notes).toContain("href={entry.receipt.url}");
    expect(notes.toLowerCase(), "the internal campaign name may not be rendered").not.toContain("folynta");
  });

  /*
    The check that makes a published digest worth printing.

    Every receipt the page cites is hashed here against the file served under `public/`. A copy
    that drifts from the artifact it was taken from, a digest edited to match a new file, and a
    citation whose receipt was never published all fail on this run rather than on a reader's.

    The internal filename stays in the record and is asserted absent from the page; what is
    asserted present is that the public URL resolves to bytes whose sha256 is the printed one.
  */
  it("serves every cited receipt, and its bytes hash to the digest the page prints", () => {
    const record = read("lib/evidence-record.ts");
    const receipts = [...record.matchAll(/digest: "([0-9a-f]{64})",\s+file: "([^"]+)",\s+url: "([^"]+)",/g)];
    expect(receipts.length, "both measured entries carry a published receipt").toBe(2);
    for (const [, digest, file, url] of receipts) {
      expect(url, "a receipt is served from one directory").toMatch(/^\/research\/receipts\/[\w.-]+\.json$/);
      expect(url.toLowerCase(), "a retired campaign name may not reach a public URL").not.toContain("folynta");
      const bytes = readFileSync(resolve(import.meta.dirname, "..", "public", url.slice(1)));
      expect(createHash("sha256").update(bytes).digest("hex"), `${file} is published at ${url}`).toBe(digest);
    }
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

  it("provides a verified-request path without inventing an operational workflow", () => {
    expect(page).toContain("Everything else begins with a verified request");
    expect(page).toContain("privacy@tavonel.com");
  });

  /*
    BA-153. This case used to require "We publish no completion time for that" on /privacy, and
    that sentence cancelled the deletion term of the served DPA: §7 commits to completion within
    30 days, the document's own precedence rule says /privacy wins where the two differ, and a
    reviewer comparing them found our priority rule voiding our own clause.

    So /privacy publishes the DPA's number, and the number is not free-floating: the case below
    reads it out of the served document. Where a number genuinely does not exist -- the provider
    backup tail, and the operational logs -- the page still says so, and those two assertions are
    unchanged.
  */
  it("publishes no unsupported deletion completion period", () => {
    expect(page).toContain("No fixed operational completion period is published");
    expect(page).toContain("applicable legal hold or retention duty");
    expect(page).toContain("provider-backup lifecycle");
    expect(page).not.toContain("deletion request is completed within 30 days");
    expect(read("public/policy/TAVONEL_DPA_v1_2026-09-11.md"))
      .not.toContain("completed within 30 days of the verified request");
    expect(page, "the part with no number still says it has none").toContain("we publish no day count for it");
    expect(page).toContain("have no published retention period");
  });

  /*
    BA-163. The old pin required "no part of the running service issues one today", which arrived
    at the end of four sentences explaining an internal receipt contract, its four preconditions
    and our own meaning of the word "receipt" -- to a reader of a privacy notice, who asked for
    none of it. The promise that is refused is the same one; it is now one sentence, and the
    internal mechanism may not come back.
  */
  it("promises no deletion certificate, and explains no internal mechanism to refuse one", () => {
    expect(page).toContain("A signed deletion certificate is not issued today");
    expect(page).toContain("We confirm the scope and outcome in writing");
    const copy = withoutComments(page);
    for (const internal of ["receipt contract", "audit digest", "storage listing is empty"]) {
      expect(copy, `"${internal}" is an internal mechanism, not a privacy statement`)
        .not.toContain(internal);
    }
  });

  it("invents no retention period in days", () => {
    const copy = withoutComments(page);
    const numbers = copy.match(/\b\d+\s*(?:calendar )?(?:days?|weeks?|months?|years?)\b/gi) ?? [];
    // 180 days is the analytics cookie lifetime, set in code. Every other day count on this page
    // would be an unsupported retention or deletion period.
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
  What /trust and /pricing both say about the security review, held to each other.

  This used to reconcile a *count*. `/pricing` said "ten of the thirteen things such a review
  asks", then "twelve of the thirteen", and /trust's lede did the same arithmetic -- and the count
  drifted every time the index gained an answer, because it was ours: §45's internal list of
  thirteen, quoted on two public pages as though it were a standard a reviewer would recognise.

  BA-164 removed the number from both pages, so the thing to reconcile is what is actually
  checkable: the two answers the index says are not published, which are the two rows a reader
  counts in `NOT_PUBLISHED`. That is a tighter pin than the number was -- the number could be
  right while the rows were wrong -- and the ban below stops either page from reaching for the
  thirteen again.
*/
describe("the security-review answer reconciles across the two pages that state it", () => {
  const trust = withoutComments(read("app/trust/page.tsx"));
  const pricing = withoutComments(read("components/pricing-page-client.tsx"));

  it("uses the same qualified-review boundary on Trust and Pricing", () => {
    for (const material of ["architecture", "control evidence", "assurance scope", "questionnaire responses"]) {
      expect(trust.toLowerCase()).toContain(material.toLowerCase());
      expect(pricing.toLowerCase()).toContain(material.toLowerCase());
    }
  });

  it("quotes no checklist total on either page", () => {
    for (const [name, copy] of [["/trust", trust], ["/pricing", pricing]] as const) {
      expect(copy, `${name} may not quote an internal checklist size as a public fact`)
        .not.toMatch(/\b(?:ten|twelve|thirteen) of (?:them|the thirteen)\b/i);
      expect(copy, `${name} may not assert a universal thirteen-question review`)
        .not.toMatch(/same thirteen things/i);
    }
  });

  it("publishes no exact review-gap inventory on either page", () => {
    for (const copy of [trust, pricing]) {
      for (const gap of ["SOC 2", "ISO 27001", "penetration test", "no outside audit", "recovery objective"]) {
        expect(copy).not.toContain(gap);
      }
    }
  });
});

/*
  G2-004 / G2-023 / G2-028. One disclosure list, rendered on all three pages a buyer can land on.

  The failure this guards is not a wrong sentence, it is a page quietly carrying the shorter
  version of the list. `/trust` published every absence; `/enterprise`, which is where an
  enterprise reviewer actually arrives and converts, published none of them and said nothing
  about deployment options, SSO, an SLA, an MSA, a questionnaire or a VPAT -- while `/contact`
  offered air-gapped deployment and four data regions as selectable requirements.

  So the check is structural: the module is the only place the wording lives, all three pages
  render it, and the rules that make it publishable (three status words, no date in a plan, no
  claim vocabulary anywhere) are asserted on the module rather than on any one page.
*/
describe("public trust disclosures and the enterprise procurement summary", () => {
  const module_ = publicTrustContract;
  const rows = (source: string) => (source.match(/^ {4}subject: "/gm) ?? []).length;

  it.each(["app/trust/page.tsx"])(
    "%s renders the shared list rather than its own copy",
    (page) => {
      const source = read(page);
      expect(source, "the disclosures come from one module").toContain("@/components/trust-disclosures");
      expect(source).toContain("<TrustDisclosures");
      // The wording may not be retyped on the page: a second copy is a copy that goes stale.
      expect(withoutComments(source)).not.toContain("planned after the first paying customer");
    },
  );

  it("routes enterprise buyers to maintained trust records without repeating the review inventory", () => {
    const source = withoutComments(read("app/enterprise/page.tsx"));
    expect(source).not.toContain("<TrustDisclosures");
    for (const material of ["not enabled by purchasing a plan", 'href={"/trust" as Route}',
      'href={"/security" as Route}', "qualified review", "draft for review"]) {
      expect(source).toContain(material);
    }
    for (const internal of ["exactly one member", "SAML", "SCIM", "SOC 2", "ISO 27001",
      "penetration-test", "No uptime percentage", "RunPod", "Cloud Run", "431 catalog objects"]) {
      expect(source).not.toContain(internal);
    }
  });

  it("publishes the maintained policy and review destinations", () => {
    for (const subject of [
      "Security controls",
      "Privacy notice",
      "Subprocessors",
      "Data processing agreement",
      "Responsible disclosure",
      "Qualified security review",
    ]) {
      expect(module_, `${subject} is a public trust destination`).toContain(`subject: "${subject}"`);
    }
  });

  it("keeps the row count even, so no absence is promoted to a full-width card", () => {
    // `.status-list > :last-child:nth-child(odd)` stretches a trailing odd card across the
    // section. The largest object on an enterprise page should not be whichever absence sorts
    // last, which is the same defect BA-151 fixed one section down /security.
    expect(rows(module_) % 2).toBe(0);
  });

  it("uses public-resource states and never a roadmap state", () => {
    const statuses = [...module_.matchAll(/^ {4}status: "([a-z_]+)",$/gm)].map((match) => match[1]);
    expect(statuses.length).toBe(rows(module_));
    for (const status of statuses) {
      expect(["published", "available_on_request"]).toContain(status);
    }
  });

  it("does not publish a certification, audit, or staffing inventory", () => {
    const copy = withoutComments(module_).toLowerCase();
    for (const detail of ["soc 2", "iso 27001", "penetration test", "penetration-test", "on-call", "one person"]) {
      expect(copy, `"${detail}" belongs in qualified review`).not.toContain(detail);
    }
    expect(copy).not.toMatch(/\b(?:rpo|rto)\b/);
  });

  it("publishes no internal audit trigger or drill internals", () => {
    const copy = withoutComments(module_);
    expect(copy).toContain("provided through an appropriate qualified review");
    for (const internal of ["first paying customer", "planned alongside", "2026-09-10", "431 catalog", "temporary project"]) {
      expect(copy.toLowerCase(), `"${internal}" belongs outside unrestricted public copy`).not.toContain(internal);
    }
  });

  it("carries no process vocabulary onto a public page", () => {
    const copy = withoutComments(module_);
    for (const internal of ["SD-0", "SD-1", "delegated decision", "the founder decided", "FD-12"]) {
      expect(copy, `"${internal}" is internal vocabulary on a public page`).not.toContain(internal);
    }
  });
});

describe("the public trust contract keeps topology in the maintained legal records", () => {
  it("links privacy and subprocessors without repeating provider topology", () => {
    const copy = withoutComments(publicTrustContract);
    expect(copy).toContain('href: "/privacy"');
    expect(copy).toContain('href: "/subprocessors"');
    for (const topology of ["Vercel", "Supabase", "Cloudflare R2", "Cloud Run", "RunPod", "icn1", "asia-northeast3"]) {
      expect(copy).not.toContain(topology);
    }
  });
});

/*
  G2-012 / SD-04. A page called Benchmarks with nothing to compare.

  The protocol was the honest thing to publish and it is not the thing a reader arrived for:
  "Verify and compare" led to rules for comparison and no measured result anywhere on the site.
  What may fill that gap is fixed -- the two research findings already published with their
  denominators and their receipts -- and what may not is an internal comparison measured under
  conditions this protocol does not pin.

  So the block is derived from the same record /research/notes renders, and the guard is that a
  score cannot be typed into it. A figure that arrives as a literal on this page is a figure with
  no receipt behind it, which is the one thing this page exists to refuse.
*/
describe("G2-012 /benchmarks says what exists today", () => {
  const page = read("app/benchmarks/page.tsx");
  const block = withoutComments(
    page.slice(page.indexOf("What exists today"), page.indexOf("The eight metric families")),
  );

  it("links the published receipts rather than describing them", () => {
    expect(page).toContain('import { EVIDENCE } from "@/lib/evidence-record"');
    expect(block).toContain("entry.receipt!.url");
    expect(block).toContain("Download the receipt");
  });

  it("says the results table is empty because nothing has qualified", () => {
    expect(block).toContain("No run has yet qualified under the protocol above");
  });

  it("publishes no figure that is not on a receipt", () => {
    expect(block, "a score typed onto this page has no receipt behind it").not.toMatch(/\b\d+\.\d+\b/);
    expect(block.toLowerCase(), "an internal comparison is not a published result").not.toContain("arena");
  });
});

/*
  G2-043. The step after /research was /pricing, so the page that lists seven unsolved problems
  asked the reader to buy. /research/notes answers what /research raises and was reachable only
  from one inline link in a lede.

  It is an override rather than a sixth entry in TRUST_SEQUENCE: the sequence is the §17 order of
  the five hub pages and notes is a leaf of one of them. `brand-copy.test.ts` pairs every href in
  that file with an action, which is why the override names its destination `to`.
*/
describe("G2-043 the research page's next step is its results", () => {
  const component = read("components/trust-next.tsx");

  it("sends /research to /research/notes", () => {
    expect(component).toContain('"/research": {');
    expect(component).toContain('to: "/research/notes" as Route');
    expect(component).toContain('"/research": "Read what was measured"');
  });

  it("leaves the five-hub order alone", () => {
    expect(TRUST_SEQUENCE.map((step) => step.href)).toEqual([
      "/security", "/evidence", "/benchmarks", "/reproducibility", "/research", "/pricing",
    ]);
  });

  it("ends the chain at the price question rather than looping", () => {
    expect(read("app/research/notes/page.tsx")).toContain("Understand what it costs");
  });
});

/*
  G2-013. What separates a status page from a status claim.

  Three things were missing and one of them may not be supplied. There was no incident record --
  not even an empty one with a date on it, which is the difference between a record and a
  reassurance. There was no way to be told without coming back to look. And the page is served by
  the deployment it reports on, which it did not say.

  What may not be supplied is an uptime percentage. The probe history is twenty stored runs of a
  check that does not carry a document through the pipeline; a 30- or 90-day figure computed from
  it would describe the prober rather than the service, and it would be the unsupported number
  this repository stops the line for.
*/
describe("G2-013 /status carries a record, not a reassurance", () => {
  const page = read("app/status/page.tsx");

  it("bounds the empty incident history by a date it derives", () => {
    expect(page).toContain("No incident has been recorded since");
    expect(page, "the date is derived from the changelog, not typed").toContain("RECORD_STARTS");
    expect(page).toContain("CHANGELOG.reduce");
    expect(page, "an empty record has to promise what happens when it is not empty")
      .toContain("published here with what");
  });

  it("offers a subscribe path that exists", () => {
    expect(page).toContain("/changelog/feed.xml");
    expect(page, "workspace incidents offer a direct update path")
      .toContain("email support@tavonel.com for direct updates");
  });

  it("gives an outage path that remains useful when the page cannot load", () => {
    expect(page).toContain("If this page is unavailable");
    expect(page).toContain("support@tavonel.com");
  });

  it("publishes no uptime percentage", () => {
    const copy = withoutComments(page);
    expect(copy, "an uptime figure here would describe the prober, not the service")
      .not.toMatch(/\d+(?:\.\d+)?\s*%/);
    expect(copy.toLowerCase()).not.toContain("uptime");
  });
});

/*
  G2-036. Six tiers defined, two occupied, and nothing on the page saying which.

  The two "Verified" tiers are the ones a buyer reads for, and they described capability no
  format in this deployment has. Counted from the rendered rows rather than declared, so a format
  that reaches a tier removes its own notice.
*/
describe("G2-036 /sources marks the tiers no format occupies", () => {
  const table = read("components/source-capability-table.tsx");

  it("counts occupancy from the rows it is rendering", () => {
    expect(table).toContain("all.filter((entry) => entry.tier === CAPABILITY_TIER_LABEL[status])");
    expect(table).toContain("No format has reached this tier yet.");
  });
});
