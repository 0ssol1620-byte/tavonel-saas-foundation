import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  The copy purge, as a test rather than as a claim.

  Masterplan section 14 asks that the defensive vocabulary come off the sales surfaces. The
  previous revision of the traceability file recorded that as done and, in the same entry,
  recorded "Test: not automated" -- which by its own status vocabulary disqualified it, since
  `VERIFIED_IMPLEMENTED` is supposed to mean something in this repository fails when the
  requirement stops holding. This file is that something.

  Two things it deliberately does not do.

  It does not ban words. "failed", "not" and "review" are ordinary English and a rule that
  forbids them produces a page nobody can write. What is banned is a small set of *phrases*
  that answer an accusation the reader has not made: a page announcing that it holds no
  certification, or that its own sample is not customer proof, or that a result is not yet
  qualified. The register is the target, not the vocabulary.

  And it does not treat every route as a sales surface. Legal pages have to name their
  subprocessors and say what is and is not covered; noindex research pages are where
  masterplan 13.20 explicitly puts failure records, with their context. Those are listed
  below and exempt. If a page wants the exemption, it has to be noindex or legal -- which is
  the point, because that is a decision someone has to make on purpose.
*/

const SALES_SURFACES = [
  "",
  "benchmarks",
  "product",
  "product/compiled-world",
  "product/document-understanding",
  "product/knowledge-compiler",
  "solutions/[slug]",
  "integrations",
  "pricing",
  "enterprise",
  "security",
  "evidence",
  "explore",
  "developers",
  "docs",
  "api",
  "contact",
  "login",
  "resources",
  "knowledge-compiler",
  "changelog",
  "status",
] as const;

/*
  Exempt, and why. Each of these is either legal text or a noindex research artifact.

  This list is the allowlist in full. Adding a route to it is a deliberate act with a reason
  attached, not a way to make this test pass.
*/
const EXEMPT = {
  privacy: "legal: must state what is and is not done with documents, and name subprocessors",
  terms: "legal",
  refunds: "legal",
  subprocessors: "legal: naming the subprocessor is the entire purpose of the page",
  research: "research index",
  "research/notes": "noindex-adjacent research: 13.20 puts failure records here, with context",
  reproducibility: "noindex: 13.19 files it under Resources",
  // `benchmarks` left this list for SALES_SURFACES when it stopped being a noindex 404.
  customers: "noindex",
  "research/experiments": "noindex",
} as const;

/*
  Phrases, not words. Each one is a sentence fragment that only appears when a page is
  defending itself, and each one was on a public page at some point in this branch's history.
*/
const DEFENSIVE_PHRASES = [
  "built, not proven",
  "not supported",
  "no certification",
  "claims none",
  "not a certification",
  "not a performance claim",
  "not customer proof",
  "does not establish",
  "does not represent",
  "does not prove",
  "when qualified",
  "full-sequence qualification",
  "research frontier",
  "not_yet",
  "coming soon",
  "policy-gated",
  "deterministic product sample",
] as const;

/** Comments explain what was removed and must not themselves count as the thing. */
function strip(source: string) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/** A page plus the components it pulls in, because the copy usually lives in the component. */
function shippedSourceFor(route: string) {
  const pageFile = route === "" ? "app/page.tsx" : `app/${route}/page.tsx`;
  const url = new URL(`../${pageFile}`, import.meta.url);
  if (!existsSync(url)) return null;
  const page = readFileSync(url, "utf8");
  const parts = [page];
  for (const match of page.matchAll(/from "@\/components\/([^"]+)"/g)) {
    for (const extension of [".tsx", ".ts"]) {
      const componentUrl = new URL(`../components/${match[1]}${extension}`, import.meta.url);
      if (existsSync(componentUrl)) {
        parts.push(readFileSync(componentUrl, "utf8"));
        break;
      }
    }
  }
  return strip(parts.join("\n"));
}

describe("public copy purge", () => {
  it("covers every sales surface, so a new page cannot skip the check by not being listed", () => {
    for (const route of SALES_SURFACES) {
      expect(shippedSourceFor(route), `/${route} must exist to be checked`).not.toBeNull();
    }
  });

  it.each(SALES_SURFACES)("keeps defensive phrasing off /%s", (route) => {
    const source = shippedSourceFor(route)!.toLowerCase();
    const found = DEFENSIVE_PHRASES.filter((phrase) => source.includes(phrase));
    expect(found, `/${route} renders defensive phrasing: ${found.join(", ")}`).toEqual([]);
  });

  /*
    Metadata is a sales surface.

    `/explore` shed "deterministic product sample" from the page and kept "Inspect a
    deterministic source-to-world sample" in its description, where a searcher reads it first
    and the visible copy never contradicts it. A purge that stops at the markup is half a purge.
  */
  it.each(SALES_SURFACES)("keeps defensive phrasing out of the metadata for /%s", (route) => {
    const pageFile = route === "" ? "app/page.tsx" : `app/${route}/page.tsx`;
    const source = readFileSync(new URL(`../${pageFile}`, import.meta.url), "utf8");
    const metadata = strip(source).match(/(?:title|description):\s*"([^"]*)"/g) ?? [];
    const text = metadata.join(" ").toLowerCase();
    const found = [...DEFENSIVE_PHRASES, "deterministic"].filter((phrase) => text.includes(phrase));
    expect(found, `/${route} metadata carries: ${found.join(", ")}`).toEqual([]);
  });

  it("exempts only routes that are legal text or actually noindex", () => {
    for (const [route, reason] of Object.entries(EXEMPT)) {
      const url = new URL(`../app/${route}/page.tsx`, import.meta.url);
      if (!existsSync(url)) continue;
      const source = readFileSync(url, "utf8");
      const isLegal = reason.startsWith("legal");
      const isNoindex = /robots:\s*\{[^}]*index:\s*false/.test(source);
      const isResearch = reason.includes("research");
      const isTerminal = /\bnotFound\(\)/.test(source);
      expect(
        isLegal || isNoindex || isResearch || isTerminal,
        `/${route} is exempt for "${reason}" but is neither legal, noindex, research nor terminal`,
      ).toBe(true);
    }
  });

  it("does not let a sales surface quietly claim the exemption", () => {
    for (const route of SALES_SURFACES) {
      expect(Object.keys(EXEMPT), `/${route} is a sales surface and cannot be exempt`)
        .not.toContain(route);
    }
  });
});
