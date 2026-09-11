import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "./billing-catalog";
import { CLAIM_STATE } from "./claim-state";
import { readCapabilities } from "./capabilities";
import { CONTRACT_STATE, clause } from "./compiler-contract";
import { monthlyTotalUsd } from "../components/pricing-page-client";
import { PROCESSING_UNIT_USD, STANDARD_UNITS_PER_PAGE } from "./usage-pricing";
import { CAPABILITY_MANIFEST } from "../../shared/capabilityManifest";

/**
 * Present-tense product claims, checked against the registries that already know the answer.
 *
 * `public-copy-purge.test.ts` bans a register -- the defensive sentence a page writes when it is
 * answering an accusation. This file bans the opposite failure, which audit M08 names: a sales
 * page asserting in the present tense something the code next door records as unbuilt. Three of
 * those were live at once.
 *
 *   M01  /product/document-understanding: "Tables keep their cell structure instead of collapsing
 *        into a paragraph", against a capability manifest whose every row preserves the page, the
 *        paragraph text and a bounding box and carries `no_table_or_formula_extraction`.
 *   M02  /product/compiled-world: "the same thing named in two documents is one thing in the
 *        world", against a Compiler Contract clause whose state is `direction` and whose body
 *        says the compiler is required to leave identity unresolved for a person.
 *   M03  the next card down: "what supports, supersedes, depends on or contradicts what", against
 *        a contract that names the emitted edges and a compiler that emits none of those four.
 *
 * The rule this file follows, and the reason it is not a fourth registry: every assertion reads
 * an existing module -- `shared/capabilityManifest.ts`, `lib/compiler-contract.ts`,
 * `lib/billing-catalog.ts`, `lib/capabilities.ts`, `lib/claim-state.ts` -- and fails when a page
 * disagrees with it. A claim becomes sayable by shipping the thing, which flips the registry,
 * which is what these tests read. M08's completion bar asks for exactly that CI check.
 */

const root = new URL("../", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, root), "utf8");

/** Comments explain what was removed and must not themselves count as the thing removed. */
function strip(source: string) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/*
  The surfaces a buyer reads, plus the two libraries whose strings render on them.

  `app/solutions/[slug]/page.tsx` is one file holding five pages; `lib/docs-content.ts` is the
  whole of /docs. Both are included as files rather than as routes for that reason.
*/
const CLAIM_SURFACES = [
  "app/page.tsx",
  "components/home-page-client.tsx",
  "components/pricing-page-client.tsx",
  "app/pricing/page.tsx",
  "app/product/page.tsx",
  "app/product/compiled-world/page.tsx",
  "app/product/document-understanding/page.tsx",
  "app/solutions/[slug]/page.tsx",
  "app/explore/page.tsx",
  "components/explore/explore-stage.tsx",
  "lib/docs-content.ts",
] as const;

/*
  Phrases, not words, for the reason `public-copy-purge.test.ts` gives: banning "table" or
  "supersedes" produces a site that cannot describe its own roadmap. Each entry below is a
  sentence fragment that only occurs when a page is claiming the unbuilt thing in the present
  tense, and every one of them was on a public page in this branch's history.
*/
const OVERCLAIM_PHRASES = [
  // M01. The manifest preserves a paragraph and a box; no cell survives anything here.
  "cell structure",
  "keep their cell",
  "cells are preserved",
  // M02. Content-derived keys are real. Merging two strings for one thing is not.
  "is one thing in the world",
  "become one object",
  "merged into one object",
  "automatically merg",
  /*
    The same claim in the vocabulary the Core lane is building it in (core-identity CROSS-LANE
    to L1). Neither engine resolves an alias today: clause 02 is still `direction`, and the one
    surface that stages it says in its own first line that it is a staged example rather than a
    compiler run. `/docs` still needs to be able to *name* identity resolution to say it is what
    joining two corpora would require, so the banned forms are the ones that assert it happens.
  */
  "resolves aliases",
  "alias matching",
  "aliases are matched",
  "entity resolution is",
  /*
    M03. Four predicates the compiler has never emitted, banned as the tuple a sales page writes
    when it is claiming them. The prose form is what is banned, not the predicate names: /docs
    has to be able to name `supports` and `depends_on` in order to say a query for them comes
    back empty, and it does that with the underscored identifiers this does not match.
  */
  "supports, supersedes, depends on",
  "supersedes, depends on or",
  "depends on or contradicts",
  // Sold capability with nothing behind it. `plan-entitlement.test.ts` guards the plan cards;
  // this guards the prose around them, where the same claim comes back as a sentence.
  "up to 5 seats",
  "per seat",
  "single sign-on",
  " sso",
  "scim",
  "role-based access",
  "when qualified",
] as const;

describe("product claims sync", () => {
  it("checks every surface it names, so a page cannot pass by not existing", () => {
    for (const surface of CLAIM_SURFACES) {
      expect(existsSync(new URL(surface, root)), `${surface} must exist to be checked`).toBe(true);
    }
  });

  it.each(CLAIM_SURFACES)("makes no unbuilt present-tense claim in %s", (surface) => {
    const source = strip(read(surface)).toLowerCase();
    const found = OVERCLAIM_PHRASES.filter((phrase) => source.includes(phrase));
    expect(found, `${surface} claims: ${found.join(", ")}`).toEqual([]);
  });

  /*
    The failure path of the test above, asserted rather than assumed.

    A phrase list is only a guard if a banned phrase actually trips it. This runs the same filter
    over the exact sentence M01 shipped, and requires a hit -- so a future refactor that breaks
    `strip` or the lowercasing fails here instead of passing everything silently.
  */
  it("trips on the sentence audit M01 found, so the guard is known to work", () => {
    const removed = "Tables keep their cell structure instead of collapsing into a paragraph.";
    const found = OVERCLAIM_PHRASES.filter((phrase) => removed.toLowerCase().includes(phrase));
    expect(found).toContain("cell structure");
  });

  it("trips on the sentence audit M03 found", () => {
    const removed = "Typed edges between objects: what supports, supersedes, depends on or contradicts what.";
    const found = OVERCLAIM_PHRASES.filter((phrase) => removed.toLowerCase().includes(phrase));
    expect(found.length, "M03's RELATIONS sentence must be caught").toBeGreaterThan(0);
  });

  /*
    Hard-coding beats drift only until someone edits one copy. These two pages must read the
    registry rather than restate it, so the check is on the import and not only on the wording.
  */
  it("derives the document-understanding read claim from the capability manifest", () => {
    const page = read("app/product/document-understanding/page.tsx");
    expect(page, "the READ card must import the manifest, not restate it")
      .toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/capabilityManifest"/);
    expect(page).toContain("CAPABILITY_MANIFEST.entries");
    // The claim is only sayable while the manifest says it. Named here so a manifest change that
    // makes the copy false is a failing test rather than a silent public claim.
    const pdf = CAPABILITY_MANIFEST.entries.find((entry) => entry.mime === "application/pdf")!;
    expect(pdf.preserved).toEqual(["page", "paragraph_text", "bbox1000"]);
    expect(pdf.knownLimitations as readonly string[]).toContain("no_table_or_formula_extraction");
    expect(pdf.knownLimitations as readonly string[]).toContain("no_native_structure_reader_yet");
    /*
      Both derived sentences degrade loudly, not into malformed copy. A manifest that narrowed to
      one accepted Office/ODF format would make `slice(0, -1).join(", ")` print
      " and DOCX are converted ...", and an empty one " and undefined ...", on a public page.
      Asserted at source because the page throws at module scope: the same reason the M05 case
      reads the initialiser rather than rendering the component.
    */
    expect(page, "an empty Office list must throw rather than print ' and undefined'")
      .toContain("if (OFFICE.length === 0)");
    expect(page, "the conversion sentence must agree with the count the manifest gives it")
      .toContain("OFFICE.length > 1");
  });

  it("derives the compiled-world identity and relation claims from the compiler contract", () => {
    const page = read("app/product/compiled-world/page.tsx");
    expect(page, "the OBJECTS and RELATIONS cards must import their clause")
      .toContain('from "@/lib/compiler-contract"');
    expect(page).toContain('clause("stable-semantic-identity")');
    expect(page).toContain('clause("typed-dependencies")');
    expect(page, "the card prints the registry's state word, not a word chosen in the markup")
      .toContain("CONTRACT_STATE[part.clause.state].label");
  });

  /*
    The copy and the clause state, tied together in both directions.

    While identity merge is `direction`, the card has to say it is not automatic. The day the
    clause flips to `demonstrated` this test fails, which is the point: the sentence is re-derived
    in the commit that ships the capability, not left standing as a truth that has changed.
  */
  it("keeps the identity card honest for whichever state the clause holds", () => {
    const card = strip(read("app/product/compiled-world/page.tsx")).toLowerCase();
    if (clause("stable-semantic-identity").state === "direction") {
      expect(card, "identity merge is a direction; the card must say it is not automatic")
        .toContain("are not merged automatically");
    } else {
      expect(card, "the clause ships; this card's sentence must be re-derived").toBe("re-derive me");
    }
  });

  it("names only relation predicates some engine emits", () => {
    const card = strip(read("app/product/compiled-world/page.tsx"));
    /*
      `lib/core-runtime-v2.ts` projects three relation types into a live candidate since audit
      R3-K09: the claim-to-evidence edge, the claim-to-entity `mentions` relation and the
      `contradicts` candidate built from a validation_record. The TypeScript fallback engine
      emits a different set, whose two heuristics have a *document* as their subject -- which is
      why `mentions` and `mentions_entity` are not the same claim and are not written as one.
    */
    const live = read("lib/core-runtime-v2.ts");
    expect(live, "the live projection emits supported_by").toContain('type: "supported_by" as const');
    expect(live, "the live relation allowlist is the Core's own predicate")
      .toContain('const CORE_RELATION_PREDICATES = new Set(["mentions"])');
    expect(live, "a validation_record becomes a contradicts edge").toContain('type: "contradicts"');
    for (const predicate of ["supported_by", "mentions_entity", "discusses_topic"]) {
      expect(read("lib/collection-compiler.ts"), `the fallback engine emits ${predicate}`)
        .toContain(predicate);
    }
    for (const predicate of ["supported_by", "mentions", "contradicts"]) {
      expect(card, `the card names the emitted predicate ${predicate}`).toContain(predicate);
    }
    // A contradiction is a candidate a person resolves; the card may not say it is resolved.
    expect(card, "the contradiction limit travels with the predicate").toContain("candidate and sent to review");
  });

  /*
    Audit M05. The badge state, checked at the initialiser rather than in a browser.

    `/login` is a client component whose `commercialMode` was initialised to "pilot", so a live
    deployment served the words PRIVATE PILOT in its own first paint and removed them a moment
    later. The fix is the initial value, so that is what this reads.
  */
  it("never paints the pilot badge before /api/status has confirmed the mode", () => {
    const page = read("app/login/page.tsx");
    expect(page, "an unconfirmed commercial mode is null, not pilot")
      .toContain('useState<"pilot" | "live" | null>(null)');
    expect(strip(page), "the old initialiser must not come back")
      .not.toContain('useState<"pilot" | "live">("pilot")');
    expect(page, "the badge still renders only for a confirmed pilot")
      .toContain('commercialMode === "pilot" ?');
    expect(strip(page), "a malformed status body must not default the badge to pilot")
      .not.toMatch(/setCommercialMode\([^)]*\?\s*"live"\s*:\s*"pilot"\)/);
  });

  /*
    Audit M04. The two gates a buyer meets after paying, disclosed on the page where they pay,
    in the policy's own words rather than a paraphrase of them.
  */
  it("discloses the customer-data and promotion gates at the point of purchase", () => {
    const page = read("app/pricing/page.tsx");
    expect(page, "the gate text comes from the object /api/status serves")
      .toContain('from "@/lib/activation-policy"');
    expect(page).toContain("activationPolicy.customerData.reason");
    expect(page).toContain("activationPolicy.candidatePromotion.reason");
    expect(read("components/pricing-page-client.tsx"), "and the page renders it")
      .toContain("data-purchase-gate");
  });

  /*
    Audit P05. The capability table's levels are the levels the routes enforce.

    The table is rendered from `billingProductDecision`, so the Yes/No cannot drift. What can
    drift is the level written on each row, so each named route is grepped for the level it
    demands -- a route that tightens its gate fails here rather than leaving the table promising
    the old one.
  */
  it("states a plan capability at the level the route enforcing it demands", () => {
    const page = read("app/pricing/page.tsx");
    const rows = [...page.matchAll(/route: "([^"]+)", level: "(observer|studio)"/g)];
    expect(rows.length, "the capability table is still declared on the pricing page")
      .toBeGreaterThanOrEqual(5);
    for (const [, route, level] of rows) {
      const source = read(route!);
      if (level === "studio") {
        expect(source, `${route} is advertised as Team-only and does not require it`)
          .toMatch(/(?:authorizeFoundationProduct|authorizeFoundationRequest|requireFoundationSession)\([^)]*"studio"/s);
      } else {
        expect(source, `${route} is advertised at the entry plan and requires a Team subscription`)
          .not.toMatch(/(?:authorizeFoundationRequest|requireFoundationSession)\([^)]*"studio"/);
      }
    }
    expect(page, "the cells are decided by the function the API calls")
      .toContain("billingProductDecision(account(code), row.level).ok");
  });

  /*
    Audit P03. The scenario table is arithmetic over two constants, recomputed here.

    A table of dollar figures on a pricing page goes stale the day a rate moves, and nobody
    notices until a customer does. This recomputes every cell from `STANDARD_UNITS_PER_PAGE`,
    `PROCESSING_UNIT_USD` and the catalog's `includedPages` -- the same inputs the reservation
    code charges against -- so a rate change fails the test instead of misquoting a buyer.
  */
  it("computes the pricing scenarios from the constants the reservation code charges against", () => {
    const perPage = STANDARD_UNITS_PER_PAGE * PROCESSING_UNIT_USD;
    const developer = BILLING_OFFERS.observer_access;
    const team = BILLING_OFFERS.studio_access;

    expect(monthlyTotalUsd(developer, developer.includedPages)).toBe(developer.priceUsd);
    expect(monthlyTotalUsd(developer, developer.includedPages * 2))
      .toBeCloseTo(developer.priceUsd + developer.includedPages * perPage, 10);
    expect(monthlyTotalUsd(team, team.includedPages)).toBe(team.priceUsd);
    // A volume under the included pages is the subscription and nothing else.
    expect(monthlyTotalUsd(team, 1)).toBe(team.priceUsd);
    // Failure path: a volume past the included pages must cost more than the subscription.
    expect(monthlyTotalUsd(developer, developer.includedPages + 1))
      .toBeGreaterThan(developer.priceUsd);

    const pricing = read("components/pricing-page-client.tsx");
    expect(pricing, "the volumes are derived from the catalog, not typed")
      .toContain("BILLING_OFFERS.observer_access.includedPages");
    expect(pricing, "no scenario dollar figure is written into the page")
      .not.toMatch(/\$\d+\.\d\d/);
  });

  /*
    Audit P06 and P08: two facts a buyer could only find by reading SQL, and a link.
  */
  it("states the cancellation balance behaviour and points Enterprise at the trust index", () => {
    const pricing = read("components/pricing-page-client.tsx");
    expect(pricing, "P06: what happens to a balance on cancellation")
      .toContain("nothing in the billing code removes a balance you already hold");
    expect(pricing, "P06: and that it is only spendable while a plan is active")
      .toContain("only be spent while a plan is active");
    expect(pricing, "P03: whether Ask and search consume pages")
      .toContain("What does not consume pages");
    expect(pricing, "P08: the Enterprise card reaches the trust index")
      .toContain('href: "/trust" as Route');
  });

  /*
    ST04. One status vocabulary, or a failing test.

    Three near-identical sets of state words exist on purpose -- `claim-state.ts` for a result,
    `capabilities.ts` for a live deployment row, `compiler-contract.ts` for a contract clause --
    and the risk is not that there are three, it is the fourth invented in the markup. So this
    collects the registered words and fails any *other* status-shaped badge appearing on a buyer
    surface: BETA, GA, ALPHA, PREVIEW, ROADMAP, PLANNED, COMING and friends have no definition
    anywhere in this repository and no page may introduce one.
  */
  const REGISTERED = new Set([
    ...Object.values(CLAIM_STATE).map((state) => state.label.toUpperCase()),
    ...Object.values(CONTRACT_STATE).map((state) => state.label.toUpperCase()),
    ...readCapabilities(null, false).map((capability) => capability.state.toUpperCase()),
  ]);

  const UNREGISTERED_STATUS_WORDS = [
    "BETA", "ALPHA", "GA", "GENERALLY AVAILABLE", "PREVIEW", "EARLY ACCESS", "ROADMAP",
    "PLANNED", "COMING", "IN PROGRESS", "WIP", "TBD", "DEPRECATED", "LEGACY", "EXPERIMENTAL",
  ];

  it("registers the status words the product already uses", () => {
    /*
      The four stages a reader has to be able to tell apart, each with a word already defined in
      the code: shipped against evidence, shown on a declared path, an open research question,
      and not built. There is no fifth, and inventing one on a page is what this guards.
    */
    expect(REGISTERED).toContain(CLAIM_STATE.qualified.label);        // shipped, with a receipt
    expect(REGISTERED).toContain(CLAIM_STATE.demonstrated.label);     // partial: shown, not proven
    expect(REGISTERED).toContain(CLAIM_STATE.research.label);         // experimental
    expect(REGISTERED).toContain(CONTRACT_STATE.direction.label);     // direction, not built
    for (const word of UNREGISTERED_STATUS_WORDS) {
      expect(REGISTERED, `"${word}" is not a status this product defines`).not.toContain(word);
    }
  });

  it.each(CLAIM_SURFACES)("introduces no unregistered status word on %s", (surface) => {
    const source = strip(read(surface));
    /*
      Rendered text only, and only where a status would sit: the contents of a JSX text node or a
      quoted string. Matching the whole file would catch `data-state`, an import path or a CSS
      class, none of which a reader sees.
    */
    const rendered = [
      ...[...source.matchAll(/>([^<>{}]{2,200})</g)].map((match) => match[1]!),
      ...[...source.matchAll(/"([^"\n]{2,200})"/g)].map((match) => match[1]!),
    ].join(" \n ");
    const found = UNREGISTERED_STATUS_WORDS.filter((word) =>
      new RegExp(`(^|[^A-Za-z])${word}([^A-Za-z]|$)`).test(rendered));
    expect(found, `${surface} renders an unregistered status word: ${found.join(", ")}`).toEqual([]);
  });
});
