import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRUST_SEQUENCE } from "@/components/trust-next";
import { activationPolicy } from "@/lib/activation-policy";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

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
  ["backup / recovery", "Not yet answered"],
];

describe("/security answers the §17.1 questions", () => {
  const page = read("app/security/page.tsx") + read("lib/evidence-record.ts");

  it.each(SECURITY_ANSWERS)("answers %s", (_question, phrase) => {
    expect(page).toContain(phrase);
  });

  /*
    The one question that must stay unanswered until founder item F-10 lands.

    An unanswered question is only honest while it stays unanswered. The failure this guards is
    the small edit that turns "not yet answered" into a sentence that sounds like an answer --
    durable storage, provider replication, daily snapshots -- none of which is a tested restore
    and all of which a buyer would read as one.
  */
  it("leaves backup and recovery unanswered without reassuring anyone", () => {
    const unanswered = page.match(/const UNANSWERED = \[[\s\S]*?\] as const;/)?.[0] ?? "";
    expect(unanswered).toContain("Backup and recovery");
    expect(unanswered).toContain("Not yet answered");
    for (const comfort of ["replicated", "redundant", "daily", "point-in-time", "durable", "snapshot"]) {
      expect(unanswered.toLowerCase(), `"${comfort}" answers a different question than the one asked`)
        .not.toContain(comfort);
    }
    // And it has to be rendered, not just declared.
    expect(read("app/security/page.tsx")).toContain("UNANSWERED.map");
  });

  it("claims no certification, audit or attestation", () => {
    // §49: never preclaim. These are the words a procurement reader searches for first.
    for (const claim of ["soc 2", "soc2", "iso 27001", "iso27001", "pen test", "penetration test", "attestation", "certified"]) {
      expect(page.toLowerCase(), `"${claim}" is a claim this deployment cannot make`).not.toContain(claim);
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

  it("says which §45 elements are not published, without promising them", () => {
    // The three §45 elements no page answers. Each has to stay named and stay a "no".
    for (const missing of ["Backup and recovery", "Data processing agreement", "Incident response process"]) {
      expect(page).toContain(missing);
    }
    const absent = page.match(/const NOT_PUBLISHED[\s\S]*?\];/)?.[0] ?? "";
    expect(absent).not.toBe("");
    for (const promise of ["coming soon", "will be published", "shortly", "in progress", "roadmap"]) {
      expect(absent.toLowerCase(), `"${promise}" turns a missing answer into a commitment`).not.toContain(promise);
    }
  });

  it("claims no certification, audit or attestation", () => {
    for (const claim of ["soc 2", "soc2", "iso 27001", "iso27001", "pen test", "penetration test", "attestation", "certified", "compliant"]) {
      expect(page.toLowerCase(), `"${claim}" is a claim this deployment cannot make`).not.toContain(claim);
    }
  });
});

/*
  C-13 / K-07. `activationPolicy.cdr.reason` is served verbatim from /api/status and rendered on
  /security, so it is the deployment's own statement about which sanitizer is running.

  What is deployed is the synthetic qualification image. The pypdfium2 service the licensing and
  fail-closed tests were written against has never been deployed, and until a deployed image
  digest can be compared with the one those tests ran on, this string may not imply otherwise.
  The check is written as "pdfium may appear only where the sentence also says it is not
  deployed", because the failure to catch is not a bare word -- it is the confident half-sentence
  somebody adds after a deploy that did not happen.
*/
describe("§37 the CDR row names the build that is actually running", () => {
  const reason = activationPolicy.cdr.reason;

  it("names the deployed synthetic build", () => {
    expect(reason).toContain("tavonel-cdr-synthetic");
    expect(reason.toLowerCase()).toContain("not deployed");
  });

  it("cannot claim the PDFium service before a deployed-digest check exists", () => {
    const claimingSentences = reason
      .split(/(?<=\.)\s+/)
      .filter((sentence) => /pdfium/i.test(sentence))
      .filter((sentence) => !/not deployed/i.test(sentence));
    expect(claimingSentences, "a PDFium claim needs a deployed image digest, and there is none").toEqual([]);
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
