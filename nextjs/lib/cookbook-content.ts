import { BILLING_OFFERS } from "./billing-catalog";
import { DOCS_SECTIONS } from "./docs-content";
import { CAPABILITY_MANIFEST, describeAcceptedFormats } from "../../shared/capabilityManifest";
import { PROCESSING_CEILING_SENTENCE } from "../../shared/intakeCeiling";

/*
  The cookbooks, as data -- and as six drafts rather than six published cases.

  WG-045/058-063. The blueprint asks for one standard shape per cookbook: problem, real input,
  prerequisites, the screen, the code, the output, the check against the source, the use outside
  this product, the measured effect, where it stops, the next action, and the run information.
  Twelve sections, in that order, for every one of them.

  The part that matters more than the shape: none of these six has been run. No corpus has been
  cleared for publication, no promote has happened on this build, and no consumer has read a
  package produced by one of these workflows. So every section whose content is a property of a
  run is `locked` and renders as a note saying it has not been run, with the reason. There is no
  screenshot, no timing, no cost, no answer text and no success title anywhere in this file,
  because inventing one is the specific failure the blueprint's own section 9 names: "JSON에 비어
  있는 예시 값을 채워 예쁜 성공 output을 만들지 않는다."

  What the ready sections are allowed to say, they read out of the code that enforces it:

    `billing-catalog.ts`        which plan can activate a World, and how it is sold
    `capabilityManifest.ts`     what the reader preserves and what it does not
    `intakeCeiling.ts`          the size and page ceiling a source has to be under
    `docs-content.ts`           where the runnable code is published

  Nothing here restates the trial's file and page allowance or a price: /pricing owns those, and
  a second copy on a content page is a disagreement waiting to happen. This file links instead.
*/

/*
  The six slugs and the recipe version live in `lib/cookbook-slugs.ts` and are re-exported here.

  They used to be declared in this file, which made `lib/recipe-intent.ts` -- and through it the
  two client sign-in routes -- depend on `docs-content.ts` and the capability manifest for a
  six-string array. The list still has one owner; it is one file lighter. Every importer of this
  module is unchanged, and `lib/recipe-intent.test.ts` still asserts the three names resolve to
  the same six strings in the same order.
*/
export { COOKBOOK_SLUGS, RECIPE_VERSION } from "./cookbook-slugs";
export type { CookbookSlug } from "./cookbook-slugs";
import { RECIPE_VERSION, type CookbookSlug } from "./cookbook-slugs";

/*
  The three demonstrations of the blueprint's section 4, as ids rather than as prose, so the
  Resources hub and the keyword map can group by workflow without a fourth list of names.
*/
export type CookbookWorkflowId = "j1-grounded-work" | "j2-external-consumption" | "j3-revision-reuse";

export const SECTION_ORDER = [
  "outcome",
  "input",
  "prerequisites",
  "ui",
  "code",
  "output",
  "provenance",
  "external",
  "effect",
  "limits",
  "next",
  "meta",
] as const;

export type SectionKey = (typeof SECTION_ORDER)[number];

/** Customer-facing headings. The internal vocabulary stays in the section keys (WG-059). */
export const SECTION_LABEL: Record<SectionKey, string> = {
  outcome: "What this is for",
  input: "The actual input",
  prerequisites: "Before you start",
  ui: "Following it on screen",
  code: "Running it in code",
  output: "What the run produced",
  provenance: "Checking it against the source",
  external: "Using the result outside TAVONEL",
  effect: "Measured effect",
  limits: "Where this stops",
  next: "Next action",
  meta: "Run and revision information",
};

/*
  A section is either ready or it is locked, and a locked one carries no body at all.

  The empty body is the guard, not a convention: a locked section with prose in it is how a
  placeholder result gets written "temporarily", and the renderer would have to be trusted not to
  print it. `cookbook-content.test.ts` fails if a locked section carries any body, so there is
  nothing to print.
*/
export type CookbookSection =
  | {
      readonly key: SectionKey;
      readonly status: "ready";
      readonly body: string;
      /** A section of `/docs` that owns the exact contract this section describes. */
      readonly docsSlug?: string;
    }
  | {
      readonly key: SectionKey;
      readonly status: "locked";
      readonly lockedReason: string;
      readonly body: "";
    };

export type CookbookRecord = {
  readonly slug: CookbookSlug;
  readonly title: string;
  readonly workflowId: CookbookWorkflowId;
  /**
   * `draft` means: noindex, absent from the sitemap, and not linked from Resources as a
   * representative case. Approving one is a founder act with a run behind it, and it also needs
   * the sitemap and `seo-surface.test.ts` work that lives in the seo-i18n lane -- so the test
   * beside this file fails while any record claims `approved`, rather than letting a page become
   * indexable by an edit here.
   */
  readonly publication: "draft" | "approved";
  readonly recipeId: CookbookSlug;
  readonly recipeVersion: typeof RECIPE_VERSION;
  readonly sections: readonly CookbookSection[];
  /** Claim ids from the claims registry. Empty until a record has a verified run to bind to. */
  readonly claims: readonly string[];
  readonly lastVerifiedAt: string | null;
  readonly verifiedBuild: string | null;
  readonly sourceRights: "unverified" | "cleared" | "restricted";
};

const TEAM = BILLING_OFFERS.studio_access;
const DEVELOPER = BILLING_OFFERS.observer_access;

/*
  How the activation plan is sold, derived rather than described.

  Team is `contact` today because the membership flow is unfinished, and it flips to
  `self_serve` in `billing-catalog.ts` when that ships. A sentence typed here would keep telling
  readers to book a call for a month after the checkout opened, and -- the worse direction --
  would keep promising self-serve after a gate closed.

  Stage-B integration: FD-02 opened activation to the Developer plan when the caller is the
  workspace owner (`planReachesLevel` in `lib/billing-product-access.ts` -- `required ===
  "activation" && role === "owner"`), so the sentence that said activation needs Team was wrong
  in the direction that under-sells. Both halves are still read off the catalog, and the free
  evaluation is still refused, which is the half that must not soften.
*/
const ACTIVATION_CLAUSE = TEAM.saleChannel === "contact"
  ? "sold through a conversation today rather than self-serve checkout"
  : "available on self-serve checkout";

const DEVELOPER_CLAUSE = DEVELOPER.saleChannel === "self_serve"
  ? `the ${DEVELOPER.label} plan, if you are the workspace owner`
  : `the ${DEVELOPER.label} plan, if you are the workspace owner and have arranged it with us`;

const ACTIVATION_SENTENCE =
  `A compile produces a candidate, and a candidate becomes an active World only when a person activates it in the workspace. `
  + `That step needs a paid plan: ${DEVELOPER_CLAUSE}, or the ${TEAM.label} plan, which is ${ACTIVATION_CLAUSE}. `
  + `A free evaluation can upload, compile, review and export; its activation request is refused, so decide the plan before you plan the run.`;

const READING = CAPABILITY_MANIFEST.entries.find((entry) => entry.mime === "application/pdf");
if (!READING) {
  // Fail closed, the way `app/product/document-understanding/page.tsx` does: a content page that
  // cannot read the manifest must not describe the reader from memory.
  throw new Error("capability manifest has no application/pdf entry; cookbook limits cannot be derived");
}

const NO_TABLE_EXTRACTION = READING.knownLimitations.includes("no_table_or_formula_extraction");
const NO_STRUCTURE_READER = READING.knownLimitations.includes("no_native_structure_reader_yet");

/**
 * The reading limit, in the words a customer needs, derived from the manifest that enforces it.
 *
 * This sentence is in the prerequisites of every record and in its limits section, both of which
 * render above the page's calls to action. That ordering is the requirement (WG-060), and the
 * test beside this file asserts it rather than trusting the section order to stay as written.
 */
export const READING_LIMIT_SENTENCE = [
  NO_TABLE_EXTRACTION
    ? "Tables and formulas are not extracted as tables on this deployment: a figure arrives as the paragraph it was printed in, with the page and the box it sat in, so a number is readable and the grid that arranged it is not."
    : "Tables and formulas are extracted, and the capability manifest names the fields that survive.",
  NO_STRUCTURE_READER
    ? "Heading levels, sections and columns are not recovered as typed structure; what the compiler receives is a paragraph and where it sat."
    : "Heading levels, sections and columns are recovered as typed structure.",
  PROCESSING_CEILING_SENTENCE,
].join(" ");

const ACCEPTED_FORMATS = describeAcceptedFormats(CAPABILITY_MANIFEST);

/*
  Bodies are paragraphs, separated by a blank line, because the prerequisites of a cookbook are
  four separate things a reader checks one at a time -- the sources, the reading limit, the plan,
  and what is specific to this recipe -- and one wall of text is how the limit gets skipped. The
  route splits on the blank line; nothing else in the shape changes.
*/
const PARAGRAPH = "\n\n";

function prerequisites(extra: string): string {
  return [
    `Sources: ${ACCEPTED_FORMATS}. Every one of them is sanitized to PDF and read by OCR before anything else happens.`,
    READING_LIMIT_SENTENCE,
    ACTIVATION_SENTENCE,
    extra,
    "What a free evaluation includes, and what a page costs, are on the pricing page. This page does not restate either, so it cannot disagree with them.",
  ].join(PARAGRAPH);
}

function limits(extra: string): string {
  return [
    READING_LIMIT_SENTENCE,
    extra,
    "No time, cost, quality or effort figure appears anywhere on this page: this workflow has not been run on this build, and a figure without a run behind it is an invention.",
  ].join(PARAGRAPH);
}

const LOCKED_REASON = {
  input:
    "No source has been cleared for publication yet. Which documents, at which version, under which redistribution rights, is a founder decision, and a plausible example input would be a fabricated source.",
  ui:
    "Only a real capture of a real run belongs here. No run of this workflow has been recorded on this build, and a staged or generated screen is not a capture.",
  output:
    "The output is whatever a run produced. There has been no run on this build, so there is no file, no table and no draft to show.",
  provenance:
    "Which source location a value came from is a property of a run. There is no run to trace.",
  external:
    "An external consumer's result is its own run, verified on its own. Neither the run nor the consumption has happened on this build.",
  effect:
    "Quality, time, cost and human effort are published from a same-condition measurement or not at all. No measurement of this workflow exists.",
} as const;

function locked(key: SectionKey, reason: string): CookbookSection {
  return { key, status: "locked", lockedReason: reason, body: "" };
}

function ready(key: SectionKey, body: string, docsSlug?: string): CookbookSection {
  return docsSlug ? { key, status: "ready", body, docsSlug } : { key, status: "ready", body };
}

/**
 * The twelve sections, assembled in one place so a record cannot skip one or reorder them.
 *
 * Six are ready on every record and six are locked on every record, and that is not a template
 * convenience -- it is the honest state of all six workflows. The ready six are the ones whose
 * content is a property of the product (what it is for, what you need, where the code is, where
 * it stops, what to do next, what has been verified); the locked six are the ones whose content
 * is a property of a run nobody has performed.
 */
function sectionsFor(parts: {
  outcome: string;
  prerequisitesExtra: string;
  code: string;
  docsSlug: string;
  limitsExtra: string;
  next: string;
}): readonly CookbookSection[] {
  return [
    ready("outcome", parts.outcome),
    locked("input", LOCKED_REASON.input),
    ready("prerequisites", prerequisites(parts.prerequisitesExtra)),
    locked("ui", LOCKED_REASON.ui),
    ready("code", parts.code, parts.docsSlug),
    locked("output", LOCKED_REASON.output),
    locked("provenance", LOCKED_REASON.provenance),
    locked("external", LOCKED_REASON.external),
    locked("effect", LOCKED_REASON.effect),
    ready("limits", limits(parts.limitsExtra)),
    ready("next", parts.next),
    ready(
      "meta",
      "This is a draft: it describes the workflow the product supports and carries no result. The record's verified build, verified date and source-rights state are printed below, and they move when a person records a run, never on an edit to this page.",
    ),
  ];
}

export const COOKBOOKS: readonly CookbookRecord[] = [
  {
    slug: "documents-to-grounded-work",
    title: "Compile a document set into a reviewable work output",
    workflowId: "j1-grounded-work",
    publication: "draft",
    recipeId: "documents-to-grounded-work",
    recipeVersion: RECIPE_VERSION,
    claims: [],
    lastVerifiedAt: null,
    verifiedBuild: null,
    sourceRights: "unverified",
    sections: sectionsFor({
      outcome:
        "Take a small document set through compile, review, activation and one question, and end with an answer you can open at the source location it came from.",
      prerequisitesExtra:
        "Fix the questions before the run rather than after it: one plain fact, one that needs two documents together, one conditional comparison, and one the sources cannot answer. The last one is the useful one.",
      code:
        "The runnable path -- upload capability, PUT the bytes, start a compile, poll the job -- is published in the API quickstart with cURL, Python and TypeScript, and it stops where the product stops: a key cannot activate a World.",
      docsSlug: "quickstart",
      limitsExtra:
        "The result is a draft for a person to check. This workflow is not used to settle a medical, legal or investment question, and a document set is only as current as its last compile.",
      next: [
        "Open the read-only sample to see a compiled World and its evidence without an account, read the quickstart if you are starting from a key, or talk to us about activating a World on your own corpus. Nothing on this page sits behind an email form.",
        /*
          The World Build, summarised from `WORLD_BUILD_OFFER.md`. Read "summarised" literally: the
          structure keeps that file's step names with its arrows flattened into a sentence, and the
          deliverables are shortened to read as prose, so this is a paraphrase and not a quotation.
          What is exact is the list of undecided terms -- the three the file marks FOUNDER DECISION
          (the fee, whether the fee credits against a plan, and the minimum corpus and engagement)
          and nothing else. A deal term named here that the offer file does not carry would be this
          lane inventing one, which is the same act as writing a price. DRAFT is the label, not a
          softener.
        */
        "If you would rather not run it yourself, the World Build is a fixed-scope engagement and its commercial terms are DRAFT: the scope below is decided, and the fee, whether that fee credits against a subscription, and the smallest corpus and engagement worth running are not.",
        "The structure: customer provides representative corpus, TAVONEL compiles, evidence / gaps / review states shown, current World, one update/change test, grounded Ask, architecture + economics review. What it leaves behind: the compiled World itself as a reviewable candidate, a source and evidence report, a report of what could not be compiled and why, one update demonstration, a latency and cost snapshot for that corpus on this deployment, and an implementation plan for going beyond the pilot.",
        "Two things are settled before any document moves: every format in the corpus has to be one this deployment accepts, and the corpus may not need the customer-data gate that is off by default. No fee appears here, because none has been approved.",
      ].join(PARAGRAPH),
    }),
  },
  {
    slug: "financial-report-figures-with-provenance",
    title: "Trace a figure in a financial report to its source location",
    workflowId: "j1-grounded-work",
    publication: "draft",
    recipeId: "financial-report-figures-with-provenance",
    recipeVersion: RECIPE_VERSION,
    claims: [],
    lastVerifiedAt: null,
    verifiedBuild: null,
    sourceRights: "unverified",
    sections: sectionsFor({
      outcome:
        "Read a figure out of a financial report and keep the page and region it came from, so the number can be checked against the document rather than believed.",
      prerequisitesExtra:
        "Read the limit above twice before you plan this one: a financial report is mostly tables, and tables are the part this deployment does not read as tables. Expect to check every figure at its source location, and expect a person to do it.",
      code:
        "Asking the active World a question and reading back which regions supported the answer is the Ask contract, including what it does when nothing matched.",
      docsSlug: "ask",
      limitsExtra:
        "A figure that only exists as a cell in a rendered table can arrive attached to the paragraph beside it, and a footnote that qualifies it is a separate region that nothing links to it automatically. This workflow does not produce an audited number and is not used as one.",
      next:
        "If your reports are mostly tables, the honest next step is a conversation about whether this deployment reads them well enough for your work, not a trial upload. The read-only sample shows what the evidence view looks like on documents we can publish.",
    }),
  },
  {
    slug: "manual-grounded-support-answers",
    title: "Answer a support question from your own manuals",
    workflowId: "j1-grounded-work",
    publication: "draft",
    recipeId: "manual-grounded-support-answers",
    recipeVersion: RECIPE_VERSION,
    claims: [],
    lastVerifiedAt: null,
    verifiedBuild: null,
    sourceRights: "unverified",
    sections: sectionsFor({
      outcome:
        "Turn a set of product manuals into answers a support engineer can send, with the passage behind each answer open beside it.",
      prerequisitesExtra:
        "Manuals are the friendliest corpus for this product and the one most likely to be a scan. A scanned page the reader cannot read fails visibly and is opened for review; nothing guesses at handwriting or a degraded scan.",
      code:
        "The same Ask contract as the grounded-figure recipe, plus the lexical search route when a support tool needs the passages rather than a drafted answer.",
      docsSlug: "ask",
      limitsExtra:
        "An answer is grounded in the manuals that were compiled, so a question about a model you did not upload has no sources behind it. Ask declines when nothing matched the question; it does not judge whether what matched is enough.",
      next:
        "Read the Ask section of the docs for the exact request and response, open the read-only sample to see the evidence view, or talk to us about a corpus of your own.",
    }),
  },
  {
    slug: "connect-external-ai-mcp-api",
    title: "Connect an external AI to an active World over the API or MCP",
    workflowId: "j2-external-consumption",
    publication: "draft",
    recipeId: "connect-external-ai-mcp-api",
    recipeVersion: RECIPE_VERSION,
    claims: [],
    lastVerifiedAt: null,
    verifiedBuild: null,
    sourceRights: "unverified",
    sections: sectionsFor({
      outcome:
        "Point an assistant or an agent at an active World over the API or MCP, so the knowledge a compile produced answers questions outside this product.",
      prerequisitesExtra:
        "You need an active World, a key with the read scopes, and the collection id. There is no World discovery call in the published contract: the id is copied out of the workspace by hand, and this page does not pretend otherwise. An external model or client of your own may bring its own account and its own charges.",
      code:
        "The MCP section lists the server, the tools it exposes and the scopes each one needs; the World and Ask sections carry the plain HTTP equivalents.",
      docsSlug: "mcp",
      limitsExtra:
        "A connected client reads the active World, so a question asked before a person activates a candidate reads the previous revision or nothing at all. A web chat that only accepts local files is not a client that can reach this API.",
      next:
        "Read the MCP section and the World API section, generate a key from the developers page if your plan includes one, and check which plan reaches activation before you build against it.",
    }),
  },
  {
    slug: "portable-package-local-ai",
    title: "Hand a signed package to an AI that reads local files",
    workflowId: "j2-external-consumption",
    publication: "draft",
    recipeId: "portable-package-local-ai",
    recipeVersion: RECIPE_VERSION,
    claims: [],
    lastVerifiedAt: null,
    verifiedBuild: null,
    sourceRights: "unverified",
    sections: sectionsFor({
      outcome:
        "Download the signed package for a World and give it to a tool that reads local files, verifying the signature and the file digests before anything reads it.",
      prerequisitesExtra:
        "Verification is a separate trust path: the key fingerprint comes from the published verifiers, not from the archive you just downloaded. Receiving a download descriptor is not the same act as downloading the archive, and the README and AGENTS files in a package are instructions rather than evidence.",
      code:
        "The exports section publishes the package layout, the digest manifest and the offline verification steps.",
      docsSlug: "exports",
      limitsExtra:
        "A downloaded package is a snapshot of one revision and never updates itself: a World that changes afterwards leaves the copy on disk exactly as it was. A package carrying ontology files does not make a reader capable of reasoning over them.",
      next:
        "Read the exports section for the layout and the verification steps. If you need a package for a corpus of your own, the activation step above is the one to plan first.",
    }),
  },
  {
    slug: "source-revision-reuse",
    title: "Apply a source revision and re-check the same question",
    workflowId: "j3-revision-reuse",
    publication: "draft",
    recipeId: "source-revision-reuse",
    recipeVersion: RECIPE_VERSION,
    claims: [],
    lastVerifiedAt: null,
    verifiedBuild: null,
    sourceRights: "unverified",
    sections: sectionsFor({
      outcome:
        "Replace a source with its real revision, review what changed, and ask the same question again to see which parts of the answer moved and which did not.",
      prerequisitesExtra:
        "Write down what you expect to change, what you expect to disappear and what you expect to stay the same before the run, or the comparison afterwards proves nothing. Adding a new quarterly report is corpus growth, not a revision of the same source, and the two are not mixed.",
      code:
        "The review section carries the candidate queue and the decision records a revision produces; the run-events section carries the state a client polls while it happens.",
      docsSlug: "review",
      limitsExtra:
        "A revision produces a new candidate that a person reviews and activates, so nothing changes for a reader until that happens. A rollback is its own action against current sources and access rules: it does not reach back into work an external consumer already produced from an older answer.",
      next:
        "Read the review section for how a candidate is decided, and bring a real revision rather than an edited copy when you try this on your own documents.",
    }),
  },
];

export function findCookbook(slug: string): CookbookRecord | null {
  return COOKBOOKS.find((record) => record.slug === slug) ?? null;
}

/** Sections in the order the template renders them, so the renderer cannot introduce an order. */
export function orderedSections(record: CookbookRecord): readonly CookbookSection[] {
  return SECTION_ORDER.map((key) => {
    const section = record.sections.find((candidate) => candidate.key === key);
    if (!section) throw new Error(`cookbook ${record.slug} is missing the ${key} section`);
    return section;
  });
}

/** Every docs section a cookbook points at, for the guard that they all still exist. */
export function referencedDocsSlugs(): string[] {
  return [
    ...new Set(
      COOKBOOKS.flatMap((record) =>
        record.sections.flatMap((section) => (section.status === "ready" && section.docsSlug ? [section.docsSlug] : [])),
      ),
    ),
  ];
}

/** The documentation section's own title, or null when the slug names no section. */
export function docsSectionTitle(slug: string): string | null {
  return DOCS_SECTIONS.find((section) => section.slug === slug)?.title ?? null;
}
