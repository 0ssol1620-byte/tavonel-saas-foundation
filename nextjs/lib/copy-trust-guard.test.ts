import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  The hedge guard, and what it is NOT a second copy of.

  `lib/public-copy-purge.test.ts` already bars the *defensive claim* register -- "not customer
  proof", "no certification", "not a performance claim" -- the phrases a page reaches for when it
  is answering an accusation. This file bars the neighbouring register: the *hedge*, where a page
  is not defending a claim but weakening its own verb. "We cannot", "not yet", "best effort",
  "may fail" and "unproven" are what a sentence says when the writer is more worried about being
  wrong than about being understood, and a buyer reads them as a product that is unsure of itself.

  Both are needed and neither subsumes the other: a page can be free of defensive claims and still
  say "this deployment does not yet ..." in its hero, which is what this campaign found.

  The rule it encodes is `shared/intakeCeiling.ts` and `shared/capabilityManifest.ts`'s placement
  principle, applied to prose: a limit is disclosed where the customer meets it -- the capability
  table, the refusal sentence, the pricing detail, the contract clause -- and nowhere else. So the
  allowlist below is not a list of files that may hedge. It is the list of surfaces where a limit
  IS the answer the reader came for, and every entry names which limit it carries.

  What this file deliberately does not do, for the same reason the purge does not do it: it bans
  phrases, never words. "not", "fail", "cannot" and "review" are ordinary English, and a rule that
  forbids them produces copy nobody can write.
*/

const ROOT = new URL("../", import.meta.url);

/*
  The copy sources a first impression is assembled from.

  Modules rather than routes, because the sentences a reader meets on `/`, `/ko` and the workspace
  onboarding live in a typed record, not in the page that renders it -- which is exactly how
  `activationPolicy.customerData.reason` came to state an internal precondition on seven surfaces
  at once. `page.tsx` files are walked so a new marketing route is covered without being listed.
*/
const COPY_MODULES = [
  "lib/landing-v2-copy.ts",
  "lib/landing-v2-hero-copy.ts",
  "lib/activation-policy.ts",
  "lib/site-navigation.ts",
  "lib/explore-story.ts",
  "lib/billing-catalog.ts",
  "lib/proof-copy.ts",
  "components/pricing-page-client.tsx",
  "components/workspace-getting-started.tsx",
  "components/public-site-chrome.tsx",
] as const;

/** The marketing routes named in the campaign brief, each as the file that carries its copy. */
const MARKETING_PAGES = [
  "app/page.tsx",
  "app/ko/page.tsx",
  "app/product/page.tsx",
  "app/knowledge-compiler/page.tsx",
  "app/explore/page.tsx",
  "app/pricing/page.tsx",
  "app/enterprise/page.tsx",
  "app/solutions/page.tsx",
  "app/integrations/page.tsx",
  "app/developers/page.tsx",
] as const;

/*
  Where a limit is the answer, and which limit each one carries.

  A surface earns a place here by being the page the customer is on *because* they want the limit:
  the support-tier table, the format refusal, the contract clause list, the legal text, the
  machine-readable error catalogue. Adding a route is a deliberate act with the reason attached --
  which is the point, because "it failed the test" is not a reason.
*/
const DISCLOSURE_SURFACES: Record<string, string> = {
  "app/sources/page.tsx": "the support-tier table: what a tier costs to earn, and which formats are refused",
  "app/trust/page.tsx": "the trust index: the draft DPA label and what a qualified review provides",
  "app/security/page.tsx": "the control rows, including the fail-closed refusals",
  "app/status/page.tsx": "the probe table, where an unprobed dependency has to say so",
  "app/benchmarks/page.tsx": "the protocol: what a result must carry before it may be published",
  "app/reproducibility/page.tsx": "the frozen fixtures and what rerunning them does and does not settle",
  "app/research/page.tsx": "13.20 puts the open problems and the failed experiments here",
  "app/research/notes/page.tsx": "13.20 puts the failure records here, with their context",
  "app/product/continuous-knowledge/page.tsx": "the eight contract clauses and the state each one holds here",
  "app/product/document-understanding/page.tsx": "what the read recovers, derived from the capability manifest",
  "app/privacy/page.tsx": "legal: what is collected, what is not, and what deletion does step by step",
  "app/terms/page.tsx": "legal: the agreement, including the limitations it states",
  "app/refunds/page.tsx": "legal: the refund bright line and what falls outside it",
  "app/subprocessors/page.tsx": "legal: naming the processor and its region is the page",
  "app/contact/page.tsx": "the FAQ that publishes the held-for-review mechanism",
  "lib/docs-content.ts": "the documentation: ceilings, rate limits, error classes and the export contract",
  "lib/api-error-codes.ts": "the error catalogue, which is a machine contract before it is copy",
  "lib/compiler-contract.ts": "the eight clauses and their states",
  "lib/workspace-failure-copy.ts": "the sentence a customer reads when a request was refused",
  "lib/evidence-record.ts": "the published campaign record, including the hypothesis that failed",
  "lib/changelog.ts": "a dated record of what shipped, which is history rather than a promise",
  "lib/operations.ts": "the draft-document label that travels with the document",
};

/*
  The hedges, drawn from the 2026-09-22 audit. Each one was on a marketing surface in this repo's
  history, or is the phrase that surface would reach for next.

  "IMPLEMENTED_NOT_PROVEN" is the repository's own status vocabulary (`docs/audit/`). It is a
  correct word internally and an unreadable confession on a page a buyer is judging, which is why
  it is barred out here rather than renamed in there.
*/
const HEDGES = [
  "we cannot",
  "we can't",
  "we are unable",
  "not yet",
  "does not yet",
  "no guarantee",
  "cannot promise",
  "may fail",
  "might fail",
  "unproven",
  "implemented_not_proven",
  "best effort",
  "best-effort",
  "remains qualified",
  "still required",
  "coming soon",
  "at this time",
  "for the time being",
  "we hope to",
  "we plan to",
  "on our roadmap",
  "published roadmap",
] as const;

/** Comments explain what was removed and must not themselves count as the thing (as the purge). */
function prose(relative: string) {
  const url = new URL(relative, ROOT);
  if (!existsSync(url)) return null;
  return readFileSync(url, "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

const GUARDED = [...COPY_MODULES, ...MARKETING_PAGES];

describe("copy trust guard", () => {
  it("checks a file that exists, so a renamed module cannot silently drop out", () => {
    for (const file of GUARDED) {
      expect(prose(file), `${file} is guarded and must exist`).not.toBeNull();
    }
  });

  it.each(GUARDED)("keeps the hedge register off %s", (file) => {
    const source = prose(file)!.toLowerCase();
    const found = HEDGES.filter((hedge) => source.includes(hedge));
    expect(found, `${file} hedges: ${found.join(", ")}`).toEqual([]);
  });

  /*
    The allowlist is an allowlist, not an escape hatch.

    A disclosure surface may carry the register; it may not carry it *instead of* being a
    disclosure surface. So every entry has to name a real file and a reason, and no file may be on
    both lists -- which is what stops a hedging hero from being "fixed" by listing it below.
  */
  it("allows the register only where a limit is the answer, and says which limit", () => {
    for (const [file, why] of Object.entries(DISCLOSURE_SURFACES)) {
      expect(prose(file), `${file} is allowlisted and must exist`).not.toBeNull();
      expect(why.length, `${file} is allowlisted with no reason`).toBeGreaterThan(8);
      expect(GUARDED, `${file} cannot be both a first-impression surface and a disclosure one`)
        .not.toContain(file);
    }
  });

  /*
    The one hedge that is never a disclosure, anywhere.

    A limit belongs where the customer meets it; the repository's internal status vocabulary
    belongs nowhere a customer is. `docs/audit/V4_MIGRATION_MATRIX.md` is where that word lives.
  */
  it("never publishes the internal status vocabulary, allowlisted or not", () => {
    for (const file of [...GUARDED, ...Object.keys(DISCLOSURE_SURFACES)]) {
      expect(prose(file)!.toLowerCase(), `${file} publishes an internal status label`)
        .not.toContain("implemented_not_proven");
    }
  });

  /*
    "in this deployment" and its Korean twin, which are the same mistake in operations clothing.

    Not a hedge -- the sentence around it is usually a firm statement -- so the register above
    never looked, and the disclosure allowlist exempted the surfaces it survived on longest. But a
    buyer does not know what a deployment is, cannot tell how many there are, and reads it as
    "somewhere else this works differently". `e2e/explore.spec.ts`, `e2e/benchmarks.spec.ts` and
    `lib/explore-story.test.ts` each already barred it from one surface; this is the same rule with
    no surface left out.

    It walks the tree instead of reading a list, because a list is exactly what let the phrase
    survive on `app/evidence/page.tsx` and `components/world-recompile-timeline.tsx` through two
    passes: both render it, and neither was on anybody's list.

    `../shared` is in the walk because it is not under `nextjs/` and was therefore outside the
    first tree scan too. `PROCESSING_CEILING_SENTENCE` in `shared/intakeCeiling.ts` opened with
    the phrase and is rendered on every /docs page and in the upload capability response -- one
    string, twenty-odd surfaces, invisible to a scan that stops at the app directory. The Korean half carries a second
    rule with it -- `/ko` had drifted to "이 배포판이 하는 일" while the English section already said
    "Read what TAVONEL does", which breaks D12 as well as naming the deployment.
  */
  const BANNED_VOCABULARY = ["this deployment", "이 배포판"] as const;

  function sources(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) found.push(...sources(path));
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
    }
    return found;
  }

  it("never calls the product a deployment, on any surface", () => {
    const offenders: string[] = [];
    for (const file of [...sources("app"), ...sources("components"), ...sources("lib"), ...sources("../shared")]) {
      // JSX wraps prose across lines, and the browser collapses that back to one space.
      // `.../document-understanding` read "this\n                deployment" and went out
      // three times because the check looked for a single space.
      const source = prose(file)!.toLowerCase().replace(/\s+/g, " ");
      for (const phrase of BANNED_VOCABULARY) {
        if (source.includes(phrase)) offenders.push(`${file}: "${phrase}"`);
      }
    }
    expect(offenders, `operations vocabulary on a customer surface: ${offenders.join("; ")}`)
      .toEqual([]);
  });
});
