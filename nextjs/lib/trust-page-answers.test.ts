import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRUST_SEQUENCE } from "@/components/trust-next";

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
