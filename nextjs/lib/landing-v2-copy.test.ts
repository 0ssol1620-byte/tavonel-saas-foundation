import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activationPolicy } from "./activation-policy";
import { koTermDrift } from "./ko-terms";
import {
  LANDING_V2_ACTIONS,
  LANDING_V2_COPY,
  LANDING_V2_SCENE_ORDER,
  landingV2Copy,
} from "./landing-v2-copy";
import { ACCESS_CTA, BRAND_LINE, EXPLORE_CTA, SELF_SERVE_CTA } from "./site-navigation";

/*
  The guard over every word the Landing V2 entry pages say.

  Four rules, and the reason each is here rather than left to review:

    1. §20.2's forbidden claims, `LANDING_V2_FORBIDDEN` below.
    2. `lib/brand-copy.test.ts`'s BARRED / OVERCLAIMS / RETIRED_NAMES. The arrays are copied
       below rather than imported, because that file is a test module and exports nothing; a
       phrase added there and not here is a gap, and the comment above each copy says so.
    3. No digit, anywhere. Rule 4 of the lane contract: a figure on the entry pages is read out
       of the compiled World at build time or it does not appear. Keeping the copy module free of
       digits makes that structural instead of editorial -- there is nowhere in it to type one.
    4. Korean is a literal translation spelled with `KO_TERMS`, checked with `koTermDrift`.
*/

/**
 * §20.2: the eight claims the Landing V2 copy may not make, none of which has a receipt here.
 *
 * It lives in this test module rather than in `lib/landing-v2-copy.ts` because two of the eight
 * are also on `lib/prohibited-phrases.test.ts`'s contract list, which sweeps every non-test file
 * under `app/`, `components/` and `lib/`. A runtime module carrying the strings it forbids is a
 * module that sweep matches -- the same reason `RETIRED_NAMES` lives in `lib/brand-copy.test.ts`
 * and not in `lib/site-navigation.ts`. Exported so another guard can read the list rather than
 * write a third copy of it.
 */
export const LANDING_V2_FORBIDDEN: readonly string[] = [
  "best-in-class",
  "unmatched",
  "revolutionary",
  "zero information loss",
  "100% accurate",
  "hallucination-free",
  "fully autonomous",
  "instant at any scale",
];

/** `lib/brand-copy.test.ts` BARRED, copied. A phrase added there belongs here in the same commit. */
export const BARRED = [
  "unlock your data",
  "second brain",
  "100% accurate",
  "never hallucinates",
  "better than rag",
  "ai brain",
  "supports every file",
  "all files",
  "perfect parsing",
  "best ocr",
  "never stale",
  "always current",
  "industry-leading",
  "every file supported",
  "lossless for every format",
  "fully autonomous truth",
];

/** `lib/brand-copy.test.ts` OVERCLAIMS, copied. */
export const OVERCLAIMS = ["generally available", "production-ready", "fully automated ontology"];

/** `lib/brand-copy.test.ts` RETIRED_NAMES, copied. Case-sensitive, as it is there. */
export const RETIRED_NAMES = [
  "Trust center",
  "Technical evidence",
  "Explore a World",
  "Explore the public World",
  "Explore a public sample",
  "ENTER WORLD",
  "Get started",
  "Start with the data path",
  "Start free",
];

/** Keys that hold a machine identifier rather than a sentence a reader meets. */
const NOT_COPY = new Set(["id", "href", "contractHref"]);

/** Every reader-facing string in a copy tree, with the path it sits at. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      NOT_COPY.has(key) ? [] : strings(item, path ? `${path}.${key}` : key));
  }
  return [];
}

const EN = strings(LANDING_V2_COPY.en);
const KO = strings(LANDING_V2_COPY.ko);
const ALL = [...EN.map(([path, text]) => [`en.${path}`, text] as const), ...KO.map(([path, text]) => [`ko.${path}`, text] as const)];

describe("the Landing V2 copy", () => {
  it("covers the nine scenes §9 names, in order, and nothing else", () => {
    expect(LANDING_V2_SCENE_ORDER).toEqual([
      "hero", "proof", "sources", "evidence", "recompile", "why", "use", "trust", "start",
    ]);
    for (const locale of ["en", "ko"] as const) {
      expect(Object.keys(LANDING_V2_COPY[locale])).toEqual([...LANDING_V2_SCENE_ORDER]);
      for (const scene of LANDING_V2_SCENE_ORDER) {
        expect(LANDING_V2_COPY[locale][scene].id, `${locale}.${scene} id`).toBe(scene);
      }
    }
    expect(landingV2Copy()).toBe(LANDING_V2_COPY.en);
    expect(landingV2Copy(true)).toBe(LANDING_V2_COPY.ko);
  });

  it("says none of §20.2's claims, in either language", () => {
    expect(LANDING_V2_FORBIDDEN).toContain("hallucination-free");
    for (const [path, text] of ALL) {
      for (const phrase of LANDING_V2_FORBIDDEN) {
        expect(text.toLowerCase().includes(phrase), `${path} says "${phrase}": ${text}`).toBe(false);
      }
    }
  });

  it("passes the site's own barred, overclaimed and retired vocabulary", () => {
    for (const [path, text] of ALL) {
      for (const phrase of [...BARRED, ...OVERCLAIMS]) {
        expect(text.toLowerCase().includes(phrase), `${path} says "${phrase}": ${text}`).toBe(false);
      }
      for (const name of RETIRED_NAMES) {
        expect(text.includes(name), `${path} uses the retired name "${name}"`).toBe(false);
      }
      // BQ-098: the category noun is capitalised everywhere this site writes it.
      expect(text.includes("knowledge compiler"), `${path} lower-cases the category noun`).toBe(false);
    }
  });

  it("carries no figure at all -- every number on the page is read from the World", () => {
    for (const [path, text] of ALL) {
      expect(/\d/.test(text), `${path} states a figure: ${text}`).toBe(false);
    }
  });

  it("reuses the site's three actions rather than spelling a fourth", () => {
    expect(LANDING_V2_ACTIONS.explore).toBe(EXPLORE_CTA);
    expect(LANDING_V2_ACTIONS.access).toBe(ACCESS_CTA);
    expect(LANDING_V2_ACTIONS.selfServe).toBe(SELF_SERVE_CTA);
    /*
      The headline is `BRAND_LINE.headline`, by reference. The nav lane owns that string and
      changing it is a founder call; a landing that typed its own copy of it would be a second
      claim the moment the two drifted. `toBe` rather than `toEqual`: the point is the identity.
    */
    expect(LANDING_V2_COPY.en.hero.headline).toBe(BRAND_LINE.headline);
    const source = readFileSync(join(import.meta.dirname, "landing-v2-copy.ts"), "utf8");
    expect(source.includes(BRAND_LINE.headline), "the headline is typed into the copy module").toBe(false);
  });

  it("states the deployment gate in the deployment's own words (D5)", () => {
    expect(LANDING_V2_COPY.en.start.microtext).toBe(activationPolicy.customerData.reason);
    /*
      ROUND3-P2: this used to pin trust proof #3 to `activationPolicy.candidatePromotion.reason`.
      That string is the gate on promoting a candidate World to the active one; the proof above it
      claims a per-object hold on unverified knowledge, which is a different mechanism -- the note
      stated one thing and cited another. The proof's own guard now lives in
      `landing-v2-trust.test.ts`, with the rest of the four; what this case is named for is the
      DEPLOYMENT gate, and that is `start.microtext`.
    */
    expect(LANDING_V2_COPY.ko.start.microtext.length).toBeGreaterThan(0);
  });

  it("derives the intake line instead of typing a format list (§10.1)", () => {
    for (const locale of ["en", "ko"] as const) {
      const formats = LANDING_V2_COPY[locale].hero.microProofFormats;
      expect(formats).toMatch(/^PDF, /);
      // The three the upload route refuses, and the one that is an archive rather than a format.
      for (const absent of [".csv", ".txt", ".html", "CSV", "TXT", "HTML"]) {
        expect(formats.includes(absent), `the intake line offers ${absent}`).toBe(false);
      }
      expect(LANDING_V2_COPY[locale].hero.microProofConnected.length).toBeGreaterThan(0);
    }
  });

  it("links only to routes this site has -- and never to /architecture (rule 7)", () => {
    const hrefs = [
      ...LANDING_V2_COPY.en.trust.links.map((link) => link.href),
      ...LANDING_V2_COPY.en.use.inbound.map((entry) => entry.href),
      ...LANDING_V2_COPY.en.use.outbound.map((entry) => entry.href),
      LANDING_V2_COPY.en.recompile.contractHref,
    ];
    expect(hrefs).toContain("/security");
    expect(hrefs).toContain("/product/continuous-knowledge");
    for (const href of hrefs) {
      expect(href.startsWith("/"), `${href} is not an internal route`).toBe(true);
      expect(href).not.toBe("/architecture");
    }
  });

  it("describes the comparison scene as a comparison, never as a selective rebuild (rule 7)", () => {
    const recompile = LANDING_V2_COPY.en.recompile;
    expect(recompile.support.toLowerCase()).toContain("complete compile");
    expect(recompile.contractNote.toLowerCase()).toContain("selective rebuild");
    // An arrival is not a revision: nothing in the 2025 Form 10-K was reissued.
    expect(recompile.headline.toLowerCase()).toContain("arrive");
    expect(recompile.arrivalsLabel.toLowerCase()).toContain("arrived");
  });

  /*
    Scene 08 counts its proofs in words, so the page has to carry that many of them.

    "Four things this deployment does, each written down where it can be checked." was a true
    sentence about the scene P2 will ship and a false one about the scene that is deployed, where
    the P0 skeleton renders a heading, a paragraph and one link and nothing else. The four §18
    proofs are four label/note pairs and need no visual, so they are rendered from this round on
    -- and this holds the word against the list in both languages, so neither half moves alone.

    The list moved with the P1/P2 integration: Scene 08 is now a whole `<section>` of its own
    under `components/landing-v2/scenes/`, so that is the file the rendering half is read from.
    `lib/landing-v2-trust.test.ts` counts the four in the rendered markup.
  */
  it("renders as many trust proofs as Scene 08 says it does (§18)", () => {
    for (const locale of ["en", "ko"] as const) {
      expect(LANDING_V2_COPY[locale].trust.proofs, `${locale} trust proofs`).toHaveLength(4);
    }
    expect(LANDING_V2_COPY.en.trust.support.toLowerCase().startsWith("four")).toBe(true);
    const page = readFileSync(
      join(import.meta.dirname, "..", "components", "landing-v2", "scenes", "trust.tsx"),
      "utf8",
    );
    expect(page, "Scene 08 announces four proofs and renders none").toContain("copy.proofs.map");
  });

  it("frames §16 as different layers, not as a competitor being worse", () => {
    const why = LANDING_V2_COPY.en.why;
    expect(why.stages.map((stage) => stage.id)).toEqual(["read", "structure", "bind", "maintain"]);
    expect(why.layers.map((layer) => layer.id)).toEqual(["parser", "retrieval", "graph", "compiler"]);
    for (const layer of why.layers) {
      for (const slur of ["worse", "inferior", "cannot", "fails", "limited", "only"]) {
        expect(layer.responsibility.toLowerCase().includes(slur), `${layer.id} calls a layer ${slur}`).toBe(false);
      }
    }
    expect(why.support.toLowerCase()).toContain("different");
  });

  it("writes Korean as a literal translation with the site's own spellings (D12)", () => {
    /*
      The four values that stay in English on purpose: the derived format sentence, a product
      noun the reader also meets in the product, a protocol name, and four vendor product names.
      Everything else must carry Hangul, or it is an English string that was never translated.
    */
    const englishByDesign = new Set([
      LANDING_V2_COPY.en.hero.microProofFormats,
      "Trust Center",
      "API",
      "Google Drive, Dropbox, OneDrive, SharePoint",
    ]);
    for (const [path, text] of KO) {
      const drift = koTermDrift(text);
      expect(drift.map((entry) => entry.wrong), `ko.${path}: ${text}`).toEqual([]);
      expect(/[가-힣]/.test(text) || englishByDesign.has(text), `ko.${path} is not translated: ${text}`).toBe(true);
    }
    // Every English scene has a Korean counterpart at the same path.
    expect(KO.map(([path]) => path)).toEqual(EN.map(([path]) => path));
  });
});
