import { CAPABILITY_MANIFEST, describeAcceptedFormats } from "../../shared/capabilityManifest";
import { activationPolicy } from "./activation-policy";
import { TRAINING_DATA_CLAIM } from "./security-claims";
import { ACCESS_CTA, BRAND_LINE, EXPLORE_CTA, KO_CHROME, SELF_SERVE_CTA } from "./site-navigation";

/**
 * Every word the Landing V2 entry pages say, in the two languages this site publishes.
 *
 * One typed object per scene, in the order §9 puts them: hero, proof, sources, evidence,
 * recompile, why, use, trust, start. The scenes carry sentences; they carry no figures. Every
 * number on the landing is read out of the compiled public World at build time by
 * `lib/landing-v2-hero.ts` and `lib/landing-v2-proof.ts`, and `landing-v2-copy.test.ts` asserts
 * that not one string in this module contains a digit -- so a count can only reach the page
 * through a module that measured it.
 *
 * Nothing here restates a string the site already owns. The headline is `BRAND_LINE.headline`,
 * the three action labels are `EXPLORE_CTA` / `ACCESS_CTA` / `SELF_SERVE_CTA`, the accepted
 * formats are `describeAcceptedFormats`, and the deployment gate is
 * `activationPolicy.customerData.reason` -- each imported rather than typed, because a second
 * spelling of a published claim is a second claim.
 *
 * Korean is a literal translation of the English above it (D12), spelled with `KO_TERMS`:
 * 원문 for source, 근거 for evidence, 컴파일 for compile, World and Compiled World kept in
 * English because they name artefacts a reader also meets in a filename and a digest.
 * `landing-v2-copy.test.ts` runs `koTermDrift` over every Korean string in this file.
 */

/* ------------------------------------------------------------------ the rules this copy obeys */

/*
  §20.2's eight forbidden claims are `LANDING_V2_FORBIDDEN`, and they live in
  `lib/landing-v2-copy.test.ts` rather than here.

  Two of them -- the absolute accuracy claim and the lossless one -- are also on
  `lib/prohibited-phrases.test.ts`'s contract list, which sweeps every non-test file under
  `app/`, `components/` and `lib/` for them. A runtime module that carries the strings it forbids
  is a module that sweep matches, which is the same reason `lib/site-navigation.ts` keeps
  `RETIRED_NAMES` in `lib/brand-copy.test.ts`. Nothing at run time needs the list; only the guard
  does.
*/

/* ------------------------------------------------------------------------- shared vocabulary */

export type LandingV2Locale = "en" | "ko";

/**
 * The action labels, imported from the site's own table.
 *
 * Which of the two access actions applies is `isLiveCommerce()` and is decided by the component,
 * not here: this object carries both spellings so the page can render either without inventing a
 * third. The Korean labels are `KO_CHROME.cta`'s, keyed by the same destinations.
 */
export const LANDING_V2_ACTIONS = {
  explore: EXPLORE_CTA,
  access: ACCESS_CTA,
  selfServe: SELF_SERVE_CTA,
} as const;

/*
  The accepted-format sentence, derived.

  §10.1 prints a hand-typed micro-proof line ("PDF · DOCX · XLSX · PPTX · scans · connected
  sources"). A typed list is how `.csv` got onto a marketing page that the upload route refuses,
  so the formats half is `describeAcceptedFormats(CAPABILITY_MANIFEST)` -- the same sentence
  /sources, /docs and the cookbook already publish -- and "connected sources" is the second half,
  which is the connector path (`app/integrations/page.tsx`) rather than a format.
*/
const ACCEPTED_FORMATS = describeAcceptedFormats(CAPABILITY_MANIFEST);

/* ----------------------------------------------------------------------------- scene shapes */

export type LandingV2Scene = {
  /** The section id and `data-scene` anchor this copy belongs to (D9). */
  id: string;
  eyebrow: string;
  headline: string;
  /** The second half of a two-sentence headline, set in the editorial serif (D3). */
  headlineAccent?: string;
  support: string;
  /** A line that qualifies the scene rather than selling it. Rendered as small print. */
  note?: string;
};

export type LandingV2HeroCopy = LandingV2Scene & {
  /*
    D8 TEST 01 -- THE HEADLINE EXPERIMENT, AND THE ONLY EXPERIMENT COPY ON THIS SITE.

    Arm A is `headline` above, which is `BRAND_LINE.headline` and stays the default everywhere:
    with `NEXT_PUBLIC_LANDING_EXPERIMENT` unset these two strings are rendered by nothing. Arm B
    is the shortest statement of what the product does; arm C is the same promise written as the
    outcome a reader gets. Both are single sentences on purpose -- the H1 composition is one
    sentence per line and a three-line hero headline is what §6's cap exists to stop.

    They are in this module rather than beside the experiment code so that the four guards in
    `landing-v2-copy.test.ts` sweep them exactly as they sweep the default: §20.2's forbidden
    claims, BARRED / OVERCLAIMS / RETIRED_NAMES, no digit, and `koTermDrift` over the Korean.
    An experiment arm is a public claim for as long as it is live, and a claim that is only
    checked when it ships is checked too late.
  */
  headlineExperiment?: { b: string; c: string };
  /** The derived intake line under the CTA row. Formats, then the connector path. */
  microProofFormats: string;
  microProofConnected: string;
  /*
    THE TWO METADATA FORMATS THE HERO DEMO FILLS FROM THE RECORD.

    Format strings and not sentences, because the figures in them are not this module's to type:
    `{form}`, `{page}`, `{pageCount}` and `{coordinates}` are substituted by
    `components/landing-v2/hero-compiler-demo.tsx` out of `buildHeroScene()`, which read them
    from the compiled World. The no-digit rule in `landing-v2-copy.test.ts` therefore still holds
    over this file, and the words around those digits are in the page's own language -- before
    this round `/ko` printed §4.1's signature label and the page connective in English, because
    both were assembled in the data module, and a data module has no locale.
  */
  /** §4.1's signature label: `SOURCE · 10-K · p.4 · [30,291 → 971,380]`, in the page's language. */
  regionLabelFormat: string;
  /** Which page of how many. */
  pageOfFormat: string;
  /** The label over the demo, and the words its beats are announced with. */
  demoLabel: string;
  beats: { source: string; read: string; compile: string; structure: string; verify: string; change: string; recompile: string; use: string };
  playLabel: string;
  pauseLabel: string;
};

export type LandingV2ProofCopy = LandingV2Scene & {
  /** The tab group's accessible name, and the two labels on each tab's panel. */
  tabsLabel: string;
  answerLabel: string;
  sourceLabel: string;
  openSource: string;
};

export type LandingV2EvidenceCopy = LandingV2Scene & {
  /** The inspector's field names, in the order §14 lists them. */
  fields: { status: string; source: string; page: string; region: string; version: string };
  /** The unit the region coordinates are in, in the words `lib/proof-copy.ts` already uses. */
  regionUnit: string;
  copyCitation: string;
  openOriginal: string;
};

export type LandingV2RecompileCopy = LandingV2Scene & {
  beforeLabel: string;
  afterLabel: string;
  arrivalsLabel: string;
  /*
    THE TWO SNAPSHOT LABELS ARE FORMATS, NOT SENTENCES, and that is the whole of the fix.

    `exploreChangeStory.before.label` and `.after.label` are literals typed in
    `lib/explore-change.ts` -- "2025 Form 10-K" and "2025 Form 10-K + four 2026 filings" -- and
    `RevisionBadge` rendered both inside `data-derived="1"`, the marker `e2e/landing-v2.spec.ts`
    treats as proof that a digit was measured. The count word and the years were certified as
    measurements while nothing measured them: add a fifth filing to `exploreSampleInputs` and the
    badge renders five arrivals under a label still saying four, with every guard green.

    So the figures come from `buildHeroScene()` -- the baseline filing's form and filing year, and
    `change.arrivals.length` -- and the words around them are here, in both languages, the way
    `regionLabelFormat` and `pageOfFormat` already work.
  */
  snapshotBeforeFormat: string;
  snapshotAfterFormat: string;
  affectedLabel: string;
  /*
    The noun over the hero's four counts, and it is deliberately not `affectedLabel`.

    That list holds rebuilt, added, removed and untouched, and `lib/explore-change.ts` defines
    `untouchedNodeIds` as exactly the objects the arrivals did NOT reach -- the complement of the
    set `affectedNodeIds` names, which `explore-change.test.ts` asserts never overlap. Heading
    the list "Objects the arrivals reached" states the opposite of the data for the largest of the
    four figures, and a screen reader read it as "Objects the arrivals reached, list, N
    untouched". This noun covers the partition instead of one side of it. `affectedLabel` keeps
    its job in Scene 05, where `affectedSample` really is the affected set.
  */
  compareLabel: string;
  /** What each of the four measured counts is a count of. The figures come from the data module. */
  countLabels: { rebuilt: string; added: string; removed: string; untouched: string };
  contractNote: string;
  contractHref: string;
};

export type LandingV2WhyCopy = LandingV2Scene & {
  /** §16's continuum, left to right. */
  stages: { id: string; label: string; caption: string }[];
  /** One row per layer, each saying what that layer is responsible for. Never who is worse. */
  layers: { id: string; label: string; responsibility: string }[];
  manifesto: string;
};

export type LandingV2UseCopy = LandingV2Scene & {
  inLabel: string;
  outLabel: string;
  inbound: { id: string; label: string; note: string; href: string; built: boolean }[];
  outbound: { id: string; label: string; note: string; href: string; built: boolean }[];
};

export type LandingV2TrustCopy = LandingV2Scene & {
  /*
    C4: `href` is where this proof is WRITTEN DOWN, and the support line above the four promises
    exactly that ("each written down where it can be checked"). It is required rather than
    optional so a fifth proof cannot be added without naming the page that backs it.
  */
  proofs: { id: string; label: string; note: string; href: string }[];
  links: { label: string; href: string }[];
};

export type LandingV2StartCopy = LandingV2Scene & {
  /** §19's microtext. `activationPolicy.customerData.reason`, verbatim (D5). */
  microtext: string;
};

export type LandingV2Copy = {
  hero: LandingV2HeroCopy;
  proof: LandingV2ProofCopy;
  sources: LandingV2Scene;
  evidence: LandingV2EvidenceCopy;
  recompile: LandingV2RecompileCopy;
  why: LandingV2WhyCopy;
  use: LandingV2UseCopy;
  trust: LandingV2TrustCopy;
  start: LandingV2StartCopy;
};

/* ------------------------------------------------------------------------------------ English */

const EN: LandingV2Copy = {
  hero: {
    id: "hero",
    eyebrow: "THE KNOWLEDGE COMPILER",
    /*
      Imported, never retyped. `BRAND_LINE.headline` is a founder-approved public claim and the
      nav lane owns the string; a landing that spelled it a second time would be the sixth
      surface answering "what is this" in its own words, which is the drift BRAND_LINE exists to
      end.
    */
    headline: BRAND_LINE.headline,
    headlineExperiment: {
      b: "Compile your knowledge.",
      c: "Turn your files into knowledge your AI can trust.",
    },
    /*
      C1, 2026-09-19. It read "Connect the files and systems you already have", and neither half
      of that is what this deployment offers in the present tense: `activationPolicy` keeps
      customer data closed, and connectors are not this deployment's shipped claim. "Bring the
      files you already have" is the same invitation with nothing promised that is not built.
    */
    support:
      "Bring the files you already have. TAVONEL compiles them into structured, versioned knowledge your AI can use — and you can verify.",
    microProofFormats: ACCEPTED_FORMATS,
    microProofConnected: "connected sources",
    regionLabelFormat: "SOURCE · {form} · p.{page} · {coordinates}",
    pageOfFormat: "p.{page} of {pageCount}",
    demoLabel: "What the compiler does with one page",
    /*
      The eight beats of the hero demo (§11.2), adapted to what this World actually holds.

      Two of them say something different from the storyboard, and both changes are the same
      rule. §11.2 narrates "1 source change detected" and a version step v1 → v2; nothing in the
      2025 Form 10-K was reissued, so the Change beat says four filings *arrived*. And §11.2
      calls the Verify beat "verified"; the state on these objects is the World's own, which for
      a deterministic public sample is a published sample rather than a verification -- so the
      beat names the state instead of asserting one. The words themselves come from the data
      module, not from here.
    */
    beats: {
      source: "A filing arrives.",
      read: "One region of one page is read.",
      compile: "The passage is compiled, and stays bound to that region.",
      structure: "The filing's objects and relations are compiled with it.",
      verify: "Every object carries the state the World gives it.",
      change: "Later filings arrive on top of it.",
      recompile: "The World is compiled again, and the comparison says what moved.",
      use: "A question is answered out of the source, with the region it came from.",
    },
    playLabel: "Play the compile sequence",
    pauseLabel: "Pause the compile sequence",
  },

  proof: {
    id: "proof",
    eyebrow: "REAL OUTPUT · PUBLIC COMPILED WORLD",
    headline: "Don’t take our word for it.",
    /*
      §12's own sentence is "Open the source behind the answer.", written for the scene with the
      three claim tabs and the region raster beside them. Those land in P1. Until they do, that
      sentence describes a page that is not deployed -- there is no answer, no source region and
      no tab in this scene -- and a Preview reviewer reads the copy that is there, not the copy
      that is coming. So the invitation points at the finished World this scene links to, which
      is true today and stays true when the tabs arrive beside it.
    */
    support: "Open a finished Compiled World and read the source behind every answer in it.",
    tabsLabel: "Questions answered from this Compiled World",
    answerLabel: "From the source",
    sourceLabel: "Original filing",
    /*
      Not §12's "Open source ↗". "Open source" reads first as the software licence, and this site
      already has one name for this act: /explore's Evidence pane says "Open the source region".
      The destination is unchanged.
    */
    openSource: "Open the source region",
    note: "Each answer is the source text the retriever scored, not a rewrite of it.",
  },

  sources: {
    id: "sources",
    eyebrow: "SOURCES INTO A WORLD",
    headline: "Bring the mess.",
    headlineAccent: "Keep the meaning.",
    /*
      C2, 2026-09-19. "Documents, spreadsheets, decks and scans come in" stated an intake range
      this World has never run: the sample is five SEC filings, all PDF. The accepted-format list
      under the stack has a receipt (`describeAcceptedFormats(CAPABILITY_MANIFEST)`), and it says
      what the upload route ACCEPTS -- so the sentence now says accepted, which is the claim the
      receipt actually supports, and the receipt stays where it is.
    */
    support:
      "Documents, spreadsheets, decks and scans are accepted at upload. What comes out is a structured, evidence-bound World.",
    note: "Every accepted source is sanitized to PDF and read the same way, so a paragraph keeps its page and its region.",
  },

  evidence: {
    id: "evidence",
    eyebrow: "EVIDENCE IS THE PRODUCT",
    headline: "Every answer has a way back.",
    support:
      "Every published object stays bound to the source version, page and region it came from.",
    fields: {
      status: "STATUS",
      source: "SOURCE",
      page: "PAGE",
      region: "REGION",
      version: "VERSION",
    },
    /* The unit `lib/proof-copy.ts` already publishes for a bbox. One page, one spelling. */
    regionUnit: "bbox, per mille of the page",
    copyCitation: "Copy citation",
    openOriginal: "Open the original",
  },

  recompile: {
    id: "recompile",
    eyebrow: "WHEN THE SOURCES MOVE",
    /*
      D5 / rule 7. §15 asks for "TAVONEL does not blindly rebuild everything. It tracks what
      depends on the changed source and recompiles the affected knowledge." -- which describes
      selective recompilation, and `lib/claim-state.ts` records that as Direction rather than a
      shipped capability. The public sample is five complete compiles, so the scene says what the
      comparison between two complete compiles shows, and `contractNote` puts dependency-aware
      recompilation where it belongs: the compiler contract, linked, not a live rebuild.

      §15 also frames the event as a source that changed. Nothing in the 2025 Form 10-K was
      reissued; four later filings arrived. An arrival is not a revision, so the headline says
      arrive.
    */
    headline: "When new sources arrive,",
    headlineAccent: "the knowledge is compiled again.",
    support:
      "Each snapshot of this World is a complete compile of the corpus as it stood, compared with the complete compile before it. The comparison says which objects the arriving filings rebuilt, which they added, and which they left untouched.",
    beforeLabel: "Before",
    afterLabel: "After",
    arrivalsLabel: "Filings that arrived",
    /* The figures are the record's: the baseline filing's year and form, then how many arrived. */
    snapshotBeforeFormat: "{year} Form {form}",
    snapshotAfterFormat: "{before} + {count} later filings",
    affectedLabel: "Objects the arrivals reached",
    compareLabel: "Objects in the recompiled World",
    countLabels: {
      rebuilt: "rebuilt in place",
      added: "added",
      removed: "removed",
      untouched: "untouched",
    },
    contractNote:
      "Recompiling only what depends on a changed source is the compiler contract. This deployment compares two complete compiles rather than performing a selective rebuild.",
    contractHref: "/product/continuous-knowledge",
  },

  why: {
    id: "why",
    eyebrow: "WHY A COMPILER",
    headline: "A parser reads files.",
    headlineAccent: "A compiler keeps what connects them.",
    support:
      "Reading a document, structuring what is in it, binding every object to the region it came from, and keeping those bindings as the sources move are four different responsibilities. They tend to live in four different layers.",
    /* §16's continuum, left to right. Labels are stages of work, never a scoreboard. */
    stages: [
      { id: "read", label: "READ", caption: "text and layout" },
      { id: "structure", label: "STRUCTURE", caption: "entities and claims" },
      { id: "bind", label: "BIND", caption: "evidence" },
      { id: "maintain", label: "MAINTAIN", caption: "versions and dependencies" },
    ],
    /*
      §16 forbids calling another layer inferior, so each row states the responsibility that
      layer takes and stops. Which stages a row covers is the component's mapping, and it says
      "this layer is responsible for" rather than "this layer fails at".
    */
    /*
      C3, 2026-09-19: each row says what that layer KEEPS, and stops.

      The scene used to draw a coverage grid over these rows -- full and partial cells across four
      stages -- which rendered as "two competitor rows in pieces, our row unbroken". That is a
      product scoreboard with no receipt behind either mark, the ladder reading §16 forbids and
      the perception §37 warns about. What each layer keeps is a plain fact about it and needs no
      comparison to be useful: text, chunks, nodes, and a binding.
    */
    layers: [
      { id: "parser", label: "Parser", responsibility: "Keeps the text and the layout it read off the file." },
      { id: "retrieval", label: "Retrieval index", responsibility: "Keeps chunks of text it can find again at question time." },
      { id: "graph", label: "Graph database", responsibility: "Keeps nodes and edges that something upstream produced." },
      { id: "compiler", label: "Knowledge Compiler", responsibility: "Keeps every object bound to the source version, page and region it came from, across all four stages." },
    ],
    manifesto: "A compiler keeps what connects them.",
  },

  use: {
    id: "use",
    eyebrow: "BRING IT · USE IT",
    headline: "One way in.",
    headlineAccent: "Every way out.",
    support:
      "Sources arrive through one intake path, whatever they came from. What is compiled leaves in the shapes your systems already read.",
    inLabel: "In",
    outLabel: "Out",
    /*
      Rule 7. Only what is built is listed as built; `built: false` is the component's instruction
      to draw the row monochrome. Nothing here names a connector this deployment does not have.
    */
    inbound: [
      { id: "files", label: "Files, folders and ZIP", note: "Uploaded directly; an archive is expanded before upload.", href: "/sources", built: true },
      { id: "cloud", label: "Google Drive, Dropbox, OneDrive and SharePoint", note: "Read-only connections you authorize.", href: "/integrations", built: true },
      { id: "private", label: "Your own infrastructure", note: "A mounted file server or object storage read by an agent you run.", href: "/integrations", built: true },
    ],
    outbound: [
      { id: "mcp", label: "AI over MCP", note: "Reach a compiled World from an assistant.", href: "/docs/mcp", built: true },
      { id: "api", label: "API", note: "Query objects, evidence and versions over HTTP.", href: "/docs/world-api", built: true },
      { id: "artifacts", label: "Retrieval artifacts", note: "The chunks and bindings a retriever needs, exported.", href: "/docs/exports", built: true },
      { id: "package", label: "Signed portable package", note: "Take the compiled World away and check it offline.", href: "/developers", built: true },
    ],
  },

  trust: {
    id: "trust",
    eyebrow: "TRUST",
    headline: "Built for knowledge you cannot afford to misplace.",
    support: "Four things this deployment does, each written down where it can be checked.",
    /*
      The four §18 proofs, and where each one is backed.

      ROUND3-P2 corrected this comment and two of the notes. Contract rule 7 calls all four "the
      /security rows"; only the first is one. The other three are claims this site publishes
      elsewhere, and two of them cited a receipt that was about something else:

      1. training  -- /security's own control row, imported (`lib/security-claims.ts`).
      2. evidence  -- what Scene 04 above demonstrates on real data: `buildEvidenceRecord()`
                      refuses to build a record without the source version, page and region, and
                      the scene prints all three. `lib/landing-v2-trust.test.ts` checks that.
      3. review    -- the held-for-review mechanism, published in /contact's FAQ and on /trust.
                      It used to print `activationPolicy.candidatePromotion.reason` ("Activation
                      is always an explicit human decision"), which is the gate on promoting a
                      candidate World to the active one -- a different mechanism from a per-object
                      hold, so the note stated one thing and cited another.
      4. portable  -- the export contract in `lib/docs-content.ts`: a download is signed at
                      request time or refused with EXPORT_SIGNER_NOT_CONFIGURED, and there is no
                      third outcome. The old note promised a signed package unconditionally, which
                      is not what a deployment without a signer does.
    */
    /*
      C4, 2026-09-19: every proof now names the page it is written down on, and every one of
      those pages exists in `app/` (there is no /architecture on this site and none is invented).
      The support line promises "written down where it can be checked" and three of the four had
      nowhere to go.
    */
    proofs: [
      { id: "training", label: TRAINING_DATA_CLAIM.label, note: TRAINING_DATA_CLAIM.body, href: "/security" },
      { id: "evidence", label: "Evidence stays attached", note: "A published object carries the source version, page and region it was compiled from, and is not emitted without them.", href: "/evidence" },
      { id: "review", label: "Unverified knowledge is held for review", note: "A passage that cannot be verified is held for review and surfaced as such, not published as if it were verified. Fail closed is a property of the compiler, not a setting.", href: "/trust" },
      { id: "portable", label: "Portable output, and a verifier you run", note: "A download is signed at request time or refused; there is no unsigned archive. The verifiers that check the signature and the contents are published for download.", href: "/docs/exports" },
    ],
    /* Only routes that exist. There is no /architecture on this site and none is invented. */
    links: [
      { label: "Security", href: "/security" },
      { label: "Trust Center", href: "/trust" },
      { label: "Sub-processors", href: "/subprocessors" },
      { label: "Status", href: "/status" },
      { label: "Evidence", href: "/evidence" },
    ],
  },

  start: {
    id: "start",
    eyebrow: "START",
    headline: "Bring your knowledge.",
    headlineAccent: "Leave with something your AI can trust.",
    support: "Read a finished Compiled World first. Bring your own sources when you are ready.",
    /* D5: the gate sentence is the deployment's own, verbatim, not a paraphrase of it. */
    microtext: activationPolicy.customerData.reason,
  },
};

/* ------------------------------------------------------------------------------------- Korean */

const KO: LandingV2Copy = {
  hero: {
    id: "hero",
    eyebrow: "지식 컴파일러",
    /* A literal translation of `BRAND_LINE.headline`, not a second claim. */
    headline: "AI가 바로 사용할 수 있는 지식. 모든 원문까지 추적됩니다.",
    /* D12: the literal translation of each arm. The subject is dropped, as the deck does. */
    headlineExperiment: {
      b: "지식을 컴파일하세요.",
      c: "파일을 AI가 신뢰할 수 있는 지식으로 바꾸세요.",
    },
    support:
      "이미 가지고 있는 파일을 가져오세요. TAVONEL은 그것을 AI가 사용할 수 있고, 직접 검증할 수 있는 구조화된 버전 관리 지식으로 컴파일합니다.",
    microProofFormats: ACCEPTED_FORMATS,
    microProofConnected: "연결 소스",
    /* 원문 is KO_TERMS' spelling of "source"; 쪽 is the page counter the filing metadata uses. */
    regionLabelFormat: "원문 · {form} · {page}쪽 · {coordinates}",
    pageOfFormat: "{pageCount}쪽 중 {page}쪽",
    demoLabel: "컴파일러가 한 페이지로 하는 일",
    beats: {
      source: "공시 문서가 도착합니다.",
      read: "한 페이지의 한 영역을 읽습니다.",
      compile: "문단이 컴파일되고, 그 영역에 계속 묶여 있습니다.",
      structure: "그 문서의 객체와 관계가 함께 컴파일됩니다.",
      verify: "모든 객체는 World가 부여한 상태를 가지고 있습니다.",
      change: "이후의 공시 문서가 그 위에 도착합니다.",
      recompile: "World를 다시 컴파일하고, 비교 결과가 무엇이 움직였는지 말해 줍니다.",
      use: "질문에 원문으로 답하고, 그 답을 읽어 온 영역을 함께 보여 줍니다.",
    },
    playLabel: "컴파일 과정 재생",
    pauseLabel: "컴파일 과정 일시정지",
  },

  proof: {
    id: "proof",
    eyebrow: "실제 결과 · 공개 Compiled World",
    headline: "말만 믿지 마세요.",
    support: "완성된 Compiled World를 열어, 모든 답 뒤에 있는 원문을 직접 읽어 보세요.",
    tabsLabel: "이 Compiled World에서 답한 질문",
    answerLabel: "원문에서",
    sourceLabel: "원문 공시 문서",
    openSource: "원문 영역 열기",
    note: "각 답은 검색기가 점수를 매긴 원문 그대로이며, 다시 쓴 문장이 아닙니다.",
  },

  sources: {
    id: "sources",
    eyebrow: "원문에서 World로",
    headline: "그대로 가져오세요.",
    headlineAccent: "의미는 그대로 남습니다.",
    support:
      "문서, 스프레드시트, 발표자료, 스캔본을 업로드에서 허용합니다. 나오는 것은 구조화되고 근거에 묶인 World입니다.",
    note: "허용되는 모든 원문은 PDF로 정제해 같은 방식으로 읽으므로, 문단마다 페이지와 영역이 남습니다.",
  },

  evidence: {
    id: "evidence",
    eyebrow: "근거가 곧 제품입니다",
    headline: "모든 답에는 돌아가는 길이 있습니다.",
    support: "게시된 모든 객체는 그것이 나온 원문 버전, 페이지, 영역에 계속 묶여 있습니다.",
    fields: {
      status: "상태",
      source: "원문",
      page: "페이지",
      region: "영역",
      version: "버전",
    },
    regionUnit: "bbox, 페이지 기준 천분율",
    copyCitation: "인용 복사",
    openOriginal: "원본 열기",
  },

  recompile: {
    id: "recompile",
    eyebrow: "원문이 움직일 때",
    headline: "새 원문이 도착하면,",
    headlineAccent: "지식을 다시 컴파일합니다.",
    support:
      "이 World의 각 스냅샷은 그 시점 자료 전체를 컴파일한 결과이고, 바로 이전의 전체 컴파일과 비교합니다. 비교 결과는 도착한 공시 문서가 어떤 객체를 다시 만들었고, 무엇을 추가했으며, 무엇을 그대로 두었는지 말해 줍니다.",
    beforeLabel: "이전",
    afterLabel: "이후",
    arrivalsLabel: "도착한 공시 문서",
    snapshotBeforeFormat: "{year}년 {form}",
    snapshotAfterFormat: "{before} + 이후 도착한 공시 문서 {count}건",
    affectedLabel: "도착이 영향을 미친 객체",
    compareLabel: "다시 컴파일한 World의 객체",
    countLabels: {
      rebuilt: "제자리에서 다시 만들어짐",
      added: "추가됨",
      removed: "삭제됨",
      untouched: "그대로",
    },
    contractNote:
      "바뀐 원문에 의존하는 부분만 다시 컴파일하는 것은 컴파일러의 계약입니다. 이 배포판은 선택적 재빌드를 수행하지 않고 두 번의 전체 컴파일을 비교합니다.",
    contractHref: "/product/continuous-knowledge",
  },

  why: {
    id: "why",
    eyebrow: "왜 컴파일러인가",
    headline: "파서는 파일을 읽습니다.",
    headlineAccent: "컴파일러는 그것들을 잇는 것을 지킵니다.",
    support:
      "문서를 읽는 일, 그 안의 내용을 구조화하는 일, 모든 객체를 나온 영역에 묶는 일, 원문이 바뀌어도 그 연결을 유지하는 일은 서로 다른 네 가지 책임입니다. 대개 서로 다른 계층에 있습니다.",
    stages: [
      { id: "read", label: "읽기", caption: "텍스트와 레이아웃" },
      { id: "structure", label: "구조화", caption: "개체와 주장" },
      { id: "bind", label: "연결", caption: "근거" },
      { id: "maintain", label: "유지", caption: "버전과 의존 관계" },
    ],
    layers: [
      { id: "parser", label: "파서", responsibility: "파일에서 읽어 낸 텍스트와 레이아웃을 가지고 있습니다." },
      { id: "retrieval", label: "검색 색인", responsibility: "질문 시점에 다시 찾을 수 있는 텍스트 조각을 가지고 있습니다." },
      { id: "graph", label: "그래프 데이터베이스", responsibility: "앞 단계가 만들어 준 노드와 간선을 가지고 있습니다." },
      { id: "compiler", label: "지식 컴파일러", responsibility: "네 단계 전부에 걸쳐, 모든 객체를 그것이 나온 원문 버전과 페이지와 영역에 묶어 둡니다." },
    ],
    manifesto: "컴파일러는 그것들을 잇는 것을 지킵니다.",
  },

  use: {
    id: "use",
    eyebrow: "가져오기 · 사용하기",
    headline: "들어오는 길은 하나.",
    headlineAccent: "나가는 길은 모두.",
    support:
      "원문이 어디에서 왔든 하나의 반입 경로로 들어옵니다. 컴파일된 결과는 이미 쓰고 있는 시스템이 읽는 형태로 나갑니다.",
    inLabel: "들어오기",
    outLabel: "나가기",
    inbound: [
      { id: "files", label: "파일, 폴더, ZIP", note: "직접 업로드하며, 압축 파일은 업로드 전에 풀립니다.", href: "/sources", built: true },
      { id: "cloud", label: "Google Drive, Dropbox, OneDrive, SharePoint", note: "직접 승인하는 읽기 전용 연결입니다.", href: "/integrations", built: true },
      { id: "private", label: "직접 운영하는 인프라", note: "직접 운영하는 에이전트가 읽는 마운트된 파일 서버 또는 오브젝트 스토리지입니다.", href: "/integrations", built: true },
    ],
    outbound: [
      { id: "mcp", label: "MCP로 AI에서", note: "어시스턴트에서 Compiled World에 접근합니다.", href: "/docs/mcp", built: true },
      { id: "api", label: "API", note: "객체, 근거, 버전을 HTTP로 조회합니다.", href: "/docs/world-api", built: true },
      { id: "artifacts", label: "검색용 아티팩트", note: "검색기에 필요한 청크와 연결을 내보냅니다.", href: "/docs/exports", built: true },
      { id: "package", label: "서명된 이식 가능 패키지", note: "컴파일된 World를 가져가서 오프라인에서 검증합니다.", href: "/developers", built: true },
    ],
  },

  trust: {
    id: "trust",
    eyebrow: "신뢰와 보안",
    headline: "잃어버려서는 안 되는 지식을 위해 만들었습니다.",
    support: "이 배포판이 실제로 하는 네 가지이며, 각각 확인할 수 있는 곳에 적혀 있습니다.",
    proofs: [
      { id: "training", label: "고객의 자료는 학습 데이터가 아닙니다", note: "고객의 문서는 공용 모델 학습에 사용되지 않습니다. 모델은 World를 컴파일하기 위해서만 원문을 읽습니다.", href: "/security" },
      { id: "evidence", label: "근거는 계속 붙어 있습니다", note: "게시된 객체는 그것이 컴파일된 원문 버전, 페이지, 영역을 함께 가지며, 그것이 없으면 게시되지 않습니다.", href: "/evidence" },
      { id: "review", label: "검증되지 않은 지식은 검토를 위해 보류됩니다", note: "검증할 수 없는 구절은 검토를 위해 보류되고 그렇게 표시되며, 검증된 것처럼 게시되지 않습니다. 닫힌 상태로 실패하는 것은 컴파일러의 성질이며 설정이 아닙니다.", href: "/trust" },
      { id: "portable", label: "이식 가능한 결과물과 직접 실행하는 검증기", note: "내려받기는 요청 시점에 서명되거나 거부되며, 서명되지 않은 아카이브는 없습니다. 서명과 내용을 검사하는 검증기를 내려받을 수 있습니다.", href: "/docs/exports" },
    ],
    links: [
      { label: "보안", href: "/security" },
      { label: "Trust Center", href: "/trust" },
      { label: "하위 처리자", href: "/subprocessors" },
      { label: "상태", href: "/status" },
      { label: "근거", href: "/evidence" },
    ],
  },

  start: {
    id: "start",
    eyebrow: "시작하기",
    headline: "지식을 가져오세요.",
    headlineAccent: "AI가 신뢰할 수 있는 결과를 가지고 나가세요.",
    support: "먼저 완성된 Compiled World를 읽어 보세요. 준비되면 직접 가진 원문을 가져오시면 됩니다.",
    /*
      The English microtext is `activationPolicy.customerData.reason` verbatim; this is its one
      Korean translation, and it lives in `KO_CHROME` because the footer states the same sentence
      on every public route now. Two spellings of one gate is what rule 5 forbids in English, and
      a translation is not exempt from it.
    */
    microtext: KO_CHROME.customerDataGate,
  },
};

export const LANDING_V2_COPY: Record<LandingV2Locale, LandingV2Copy> = { en: EN, ko: KO };

/** The record a surface renders. English is the default, so no English string moves. */
export function landingV2Copy(korean?: boolean): LandingV2Copy {
  return korean ? LANDING_V2_COPY.ko : LANDING_V2_COPY.en;
}

/** The nine scene ids, in the order §9 puts them. The page's section order is read from this. */
export const LANDING_V2_SCENE_ORDER = [
  "hero",
  "proof",
  "sources",
  "evidence",
  "recompile",
  "why",
  "use",
  "trust",
  "start",
] as const;

export type LandingV2SceneId = (typeof LANDING_V2_SCENE_ORDER)[number];
