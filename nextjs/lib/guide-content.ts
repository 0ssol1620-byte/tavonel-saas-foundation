import { activationPolicy } from "./activation-policy";
import { BILLING_OFFERS } from "./billing-catalog";
import type { DocsBlock } from "./docs-content";
import { MCP_TOOLS, MCP_TOOL_COUNT_WORD } from "./mcp-tools";
import { KO_CHROME, type SiteLink } from "./site-navigation";
import { SUPPORT_ACKNOWLEDGEMENT } from "./support-targets";

/*
  The product guide, EN and KO, as data (EN-1, ENABLEMENT-GAP-2026-10-17 §4a).

  `/guide` and `/ko/guide` render this file and nothing else. It is the docs block format
  (`DocsBlock` in `lib/docs-content.ts`) with one kind added, `media`, for a recorded walkthrough.

  Rules this file is written to, each one checked by `lib/guide-content.test.ts`:

  - Every sentence describes main 4c80bb30 (= tavonel.com on 2026-10-17). Each chapter's comment
    names the route and component the sentence was read from.
  - A sentence quoted from the live site sits in curly quotes, verbatim, and the test finds it in
    the source tree. That is the only place "verified" may appear: inside a live sentence that
    says what something is not. The guide never calls a page verified and never calls completion
    accuracy.
  - A number outside a quote is on the test's allow-list with the file it came from. A count the
    product owns is imported (the MCP tool count, the plan labels), not retyped.
  - Korean is the literal translation of the English beside it (D12), spelled with
    `lib/ko-terms.ts`. The site's screens are English, so a Korean sentence names an on-screen
    label in English and a quoted live sentence keeps its English original next to the translation.
  - What a reader cannot do today is said where they meet it, in the live sentence that says it:
    customer upload is switched off, the Explore sample World is the only finished World, MCP is a
    downloaded read-only bridge, and there is no SDK (SERVICE-DEFINITION-2026-10-17 §4).
*/

/** The three recordings, by the names `enablement/VIDEO-MANIFEST.json` gives them. */
export const GUIDE_VIDEOS = ["guide-1-explore", "guide-2-mcp", "guide-3-api"] as const;
export type GuideVideo = (typeof GUIDE_VIDEOS)[number];

/*
  The one block kind the guide adds. A recording is named, not addressed: the renderer derives
  every file from the name (`guideVideoFiles`), so a block cannot point at a file the manifest
  does not list.
*/
export type GuideMediaBlock = { kind: "media"; video: GuideVideo; title: string };
export type GuideBlock = Extract<DocsBlock, { kind: "prose" | "note" | "steps" | "table" | "code" }> | GuideMediaBlock;

export type GuideChapter = {
  /** The fragment, identical in both languages, so /guide#x and /ko/guide#x are the same chapter. */
  id: string;
  title: string;
  blocks: GuideBlock[];
  /** Where in the product the chapter happens. Rendered as links under the chapter. */
  links: SiteLink[];
};

export type GuideLanguage = "en" | "ko";

/*
  Whether a chapter's steps need an API key (ENABLEMENT-GAP-2026-10-17 §4.0-1, second half: "각
  가이드가 키 없이 도는지 표시합니다"). One table for both languages, keyed by the chapter id they
  share, so /guide and /ko/guide cannot disagree. "none": every step in the chapter works without a
  key. "some": the chapter reaches a step that needs one, and the chapter's own sentence says which
  (`lib/guide-content.test.ts` holds each "some" to that sentence and each "none" to its absence).
  No chapter is "all": the guide covers only what anyone can use today.
*/
export type GuideApiKey = "none" | "some";

const CHAPTER_API_KEY: Readonly<Record<string, GuideApiKey>> = {
  "what-this-guide-covers": "none",
  "what-tavonel-makes": "none",
  "open-the-public-world": "none",
  "read-the-evidence": "none",
  "see-what-changed": "none",
  "relations": "none",
  "verify-a-signed-package": "some",
  "call-the-api-without-a-key": "none",
  "get-the-developer-files": "some",
  "connect-the-mcp-bridge": "some",
  "estimate-a-cost": "none",
  "status-and-trust": "none",
  "start-with-your-files": "none",
  "getting-help": "none",
  "glossary": "none",
};

/** The marker a chapter carries. Fails closed: a chapter nobody classified renders nothing at all. */
export function guideChapterApiKey(id: string): GuideApiKey {
  const value = CHAPTER_API_KEY[id];
  if (!value) throw new Error(`guide chapter ${id} does not say whether it needs an API key`);
  return value;
}

/** Every id the table classifies, for the test that holds it to the chapter list. */
export const GUIDE_API_KEY_CHAPTERS: readonly string[] = Object.keys(CHAPTER_API_KEY);

/*
  The first edition. Moved by a person when the content changes, never derived at render time --
  the same rule as `DOCS_REVIEWED`.
*/
export const GUIDE_REVIEWED = "2026-10-19";

/*
  The variants and caption languages the video lane recorded (VIDEO-MANIFEST.json `files`): a
  1280x800 desktop take and a 390x844 phone take of each guide, each with a JPEG poster and
  WebVTT captions in Korean and English. Served flat from `public/guide/`.
*/
export const GUIDE_VIDEO_VARIANTS = ["desktop", "phone"] as const;
export type GuideVideoVariant = (typeof GUIDE_VIDEO_VARIANTS)[number];

export function guideVideoFiles(video: GuideVideo, variant: GuideVideoVariant) {
  const base = `${video}-${variant}`;
  return { mp4: `${base}.mp4`, poster: `${base}.jpg`, en: `${base}.en.vtt`, ko: `${base}.ko.vtt` };
}

export const GUIDE_UI: Record<GuideLanguage, {
  title: string;
  lede: string;
  contents: string;
  where: string;
  reviewed: string;
  transcript: string;
  feedbackLead: string;
  feedbackLink: string;
  feedbackSubject: string;
  englishOnly: string;
  apiKey: Record<GuideApiKey, string>;
}> = {
  en: {
    title: "Product guide",
    lede: "How to use what TAVONEL offers today, screen by screen, and where each screen stops.",
    contents: "Chapters",
    where: "Where",
    reviewed: "Reviewed",
    transcript: "Transcript",
    feedbackLead: "Something here out of date or wrong?",
    feedbackLink: "Report an issue with this page",
    feedbackSubject: "Guide feedback: Product guide",
    englishOnly: "",
    apiKey: { none: "No API key needed for this chapter.", some: "Some steps in this chapter need an API key." },
  },
  ko: {
    title: "제품 가이드",
    lede: "TAVONEL이 오늘 제공하는 것을 화면별로 사용하는 방법과, 각 화면이 멈추는 곳을 안내합니다.",
    contents: "장 목록",
    where: "위치",
    reviewed: "검토일",
    transcript: "대본",
    feedbackLead: "오래되었거나 틀린 내용이 있나요?",
    feedbackLink: "이 페이지의 문제 알리기",
    feedbackSubject: "Guide feedback: 제품 가이드",
    // The /ko pages' own convention for a link to an English-only page (`app/ko/pricing/page.tsx`).
    englishOnly: " (영문)",
    apiKey: { none: "이 장은 API 키 없이 따라 할 수 있습니다.", some: "이 장의 일부 단계에는 API 키가 필요합니다." },
  },
};

const developer = BILLING_OFFERS.observer_access.label;
const team = BILLING_OFFERS.studio_access.label;
const intakeEn = "We arrange intake for your own sources with you.";
const intakeKo = "내 자료의 연결과 컴파일은 상담 후 함께 설정합니다.";

/* ================================================================================== English */

const EN: GuideChapter[] = [
  /*
    0. Scope. The two layers SERVICE-DEFINITION §4.3 calls "now" and "pilot". The reason string
    is `activationPolicy.customerData.reason` (lib/activation-policy.ts), the sentence /api/status
    serves; the intake sentence is the landing's (components/landing-v2/landing-page.tsx).
  */
  {
    id: "what-this-guide-covers",
    title: "What this guide covers",
    blocks: [
      { kind: "prose", text: "This guide walks through the parts of TAVONEL anyone can use today without an account: the public Compiled World with its evidence, changes and relations, the signed sample package, the API reads that take no key, the developer files and the MCP bridge. Each chapter says where to click and where the screen stops." },
      { kind: "prose", text: `“${activationPolicy.customerData.reason}”` },
      { kind: "note", text: `“${intakeEn}”` },
    ],
    links: [
      { href: "/explore", label: "Explore a Compiled World" },
      { href: "/contact", label: "Contact" },
    ],
  },
  /*
    1. The product's nouns, from /docs/concepts (lib/docs-content.ts, section "concepts") and the
    activation gate's own reason (`activationPolicy.candidatePromotion.reason`). No performance
    claim is attached (SERVICE-DEFINITION §4.2).
  */
  {
    id: "what-tavonel-makes",
    title: "What TAVONEL makes",
    blocks: [
      { kind: "prose", text: "TAVONEL compiles documents into a **Compiled World**: semantic objects, the relations between them, and the evidence each object rests on." },
      { kind: "prose", text: "**Evidence** is a page and a region on that page, bound to a source version by digest. An object with no evidence is not published." },
      { kind: "prose", text: "A compile produces a **candidate**. A person activates it in a signed-in session, and answers are served from the active version only. No API key can activate a candidate, and no compile activates itself." },
      { kind: "note", text: `“${activationPolicy.candidatePromotion.reason}”` },
    ],
    links: [
      { href: "/docs/concepts", label: "Concepts" },
      { href: "/product/compiled-world", label: "Compiled World" },
    ],
  },
  /*
    2. /explore, the entry act: components/explore/evidence-workbench.tsx (scope line, "Find a
    sample question", "Retrieved source passage", the Result/Source tabs below 760px) and the
    prepared questions in lib/explore-sample.ts. "Complete text ... not a rewrite" is
    `EXPLORE_COPY.askNote` (lib/explore-story.ts).
  */
  {
    id: "open-the-public-world",
    title: "Open the public World",
    blocks: [
      { kind: "prose", text: "**/explore** is a read-only sample World compiled from Apple's public SEC filings. It opens without signing in." },
      {
        kind: "steps",
        items: [
          "Open /explore. The note at the top names the sample and the date its sources were captured.",
          "Under **Find a sample question**, choose a prepared question, or type to filter them.",
          "Read the answer under **Retrieved source passage**. It is the complete text of the source regions the retriever selected, not a rewrite of it.",
          "Each row under the passage names its source file and page. Choose a row to open that page; on a phone, **Result** and **Source** switch between the passage and the page.",
        ],
      },
      { kind: "note", text: "“Prepared retrieval results from this artifact. Free-form AI queries are not running in this public demo.”" },
      { kind: "media", video: "guide-1-explore", title: "Follow a result to its source in the public World" },
    ],
    links: [{ href: "/explore", label: "Explore a Compiled World" }],
  },
  /*
    3. The source pane and the evidence act: evidence-workbench.tsx ("Source version",
    "Permanent evidence link", "Open full evidence inspector", `sourcePageQualifier` in
    lib/source-page-rasters.ts) and components/explore/evidence-act.tsx (State, Evidence,
    Relations, "Previous" / "Next"). The source version definition is /docs/concepts' table.
  */
  {
    id: "read-the-evidence",
    title: "Read the evidence",
    blocks: [
      { kind: "prose", text: "The source pane shows the page the passage came from, with its region marked, and the exact passage under it. The pane's header says whether you are looking at the original PDF or a reference render of that page." },
      {
        kind: "steps",
        items: [
          "**Source version** names the version of the document the region is bound to: the document plus the sha256 of its sanitized bytes.",
          "**Permanent evidence link** is an address for this piece of evidence that you can copy and share.",
          "**Open full evidence inspector** opens the object beside the source region that supports it, with its state, its evidence and its relations. When the object has more than a single region, **Previous** and **Next** step through them.",
        ],
      },
      { kind: "note", text: "“This is a quotation selected by retrieval, not an independently verified conclusion.”" },
    ],
    links: [
      { href: "/explore", label: "Explore a Compiled World" },
      { href: "/docs/concepts#evidence", label: "Evidence, in Concepts" },
    ],
  },
  /*
    4. The change act: components/explore/change-act.tsx (Objects reached, Unchanged object
    identities, FILINGS THAT ARRIVED, HOW THIS WORLD WAS REACHED, the per-step counts) and
    components/explore/parallel-view.tsx (AFFECTED / UNCHANGED as words). `?act=change` is
    `EXPLORE_ACT_QUERY` in lib/explore-story.ts. The opening sentence is `EXPLORE_COPY.changeHint`
    without its count; the quote is `EXPLORE_COPY.changeCaption`.
  */
  {
    id: "see-what-changed",
    title: "See what changed",
    blocks: [
      { kind: "prose", text: "**Changes** sets the World compiled from Apple's 2025 Form 10-K beside the same World after the 2026 filings arrived." },
      {
        kind: "steps",
        items: [
          "Choose **Changes** on /explore.",
          "Read the counts: **Objects reached** and **Unchanged object identities**, with the objects added, removed and rebuilt in place beneath them.",
          "**FILINGS THAT ARRIVED** shows each filing with the page it was read from, and opens the original PDF or its reference render.",
          "**HOW THIS WORLD WAS REACHED** lists each step with what it added, rebuilt in place, removed and left unchanged.",
          "**Objects, relations and evidence as a list** marks every object AFFECTED or UNCHANGED in words.",
        ],
      },
      { kind: "prose", text: "This is the comparison recorded in this sample, not a live feed of new filings." },
      { kind: "note", text: "“Both snapshots are complete compiles of the corpus as it stood, compared object by object. Every count below is measured from that comparison.”" },
    ],
    links: [{ href: "/explore?act=change", label: "Changes" }],
  },
  /*
    5. The World act: components/explore/world-act.tsx ("Select an object", "Directly connected",
    "Open source evidence", "Showing … of … graph nodes") and parallel-view.tsx, which opens by
    default under reduced motion (`open={reduced}`).
  */
  {
    id: "relations",
    title: "Relations",
    blocks: [
      { kind: "prose", text: "**Relations** opens the World as a graph of its compiled objects and the relations between them." },
      {
        kind: "steps",
        items: [
          "Choose **Relations** on /explore.",
          "Select an object. **Directly connected** lists each relation by its name and the object at its other end.",
          "When the object has evidence, **Open source evidence** takes it to the region that supports it.",
          "**Objects, relations and evidence as a list** gives the same graph as text. It is open from the start when your system asks for reduced motion.",
        ],
      },
      { kind: "note", text: "The line under the graph says how many of the World's graph nodes are on screen." },
    ],
    links: [{ href: "/explore?act=world", label: "Relations" }],
  },
  /*
    6. /demo, components/signed-product-demo.tsx: the "Signed export" step, its record (Manifest
    schema, Package files, Key, Signed payload), "Download the offline verifier" ->
    /developer/tavonel-verify-export.mjs (lib/signed-product-demo.ts `verifierHref`). The trust
    route is app/api/export/trust/route.ts. The download scope is `SCOPE_COPY` in docs-content.
    The `jq -r .publicKeySpkiSha256` one-liner is deliberately absent (SERVICE-DEFINITION C16).
  */
  {
    id: "verify-a-signed-package",
    title: "Verify a signed package",
    blocks: [
      { kind: "prose", text: "**/demo** follows a synthetic source through compile, review and activation to an answer and a signed export." },
      {
        kind: "steps",
        items: [
          "Open /demo and go to **Signed export**. It shows the Ed25519 signature check over the sample manifest, with the manifest schema, the package files, the key and the signed payload digest.",
          "**Download the offline verifier** gives you tavonel-verify-export.mjs, the file /developer/channel.json lists for checking an export.",
          "GET /api/export/trust publishes the key record exports are signed with, or refuses with EXPORT_SIGNER_NOT_CONFIGURED where no signer is configured.",
          "The verifier checks an archive, and downloading an archive of a World takes an API key with the collections:download scope.",
        ],
      },
      { kind: "note", text: "“A valid signature proves manifest integrity. It does not certify semantic quality, customer approval, or current activation status.”" },
    ],
    links: [
      { href: "/demo", label: "Signed product path" },
      { href: "/docs/exports", label: "Exports" },
      { href: "/docs/cli", label: "CLI and package verification" },
    ],
  },
  /*
    7. /api's "Try it, with no key": the three TRY_IT routes in app/api/page.tsx and the lede in
    components/docs/api-try-it.tsx (main 4c80bb30). Recipe 2 is /docs/integration-recipes
    (docs-content "integration-recipes"). The fixture note is TRY_IT[2].note, verbatim.
  */
  {
    id: "call-the-api-without-a-key",
    title: "Call the API without a key",
    blocks: [
      { kind: "prose", text: "The API reference at **/api** opens with **Try it, with no key**: “Three unauthenticated reads, run from this page against TAVONEL. No signup, no credential, nothing that spends.”" },
      {
        kind: "steps",
        items: [
          "**What TAVONEL can read** runs GET /api/v1/capabilities, the same list the upload route validates against.",
          "**What is open right now** runs GET /api/status, including whether compiling your own files is open.",
          "**The shape of an answer** runs GET /reproducibility/sample-world: object, evidence, source version, page and region, from a fixed sample.",
          "Recipe 2 on Integration recipes makes the same read from a published Python script that recomputes the response's Content-Digest header over the bytes it received.",
        ],
      },
      { kind: "note", text: "“A deterministic product fixture, unsigned and labelled as such in its own disclosure field. Build against the shape; do not judge extraction from it.”" },
      { kind: "media", video: "guide-3-api", title: "First API and CLI calls, without a key" },
    ],
    links: [
      { href: "/api#try-it-heading", label: "Try it, with no key" },
      { href: "/docs/integration-recipes#recipe-2-python-over-the-public-sample-world", label: "Recipe 2: Python over the public sample World" },
    ],
  },
  /*
    8. public/developer/channel.json (`version`, `assets.*.url`, `assets.*.sha256`) and
    public/developer/tavonel-cli.mjs: `status` reads /api/status/v2 with no key; the usage text
    says the key is "required except status"; there is no upload command (SERVICE-DEFINITION C12).
  */
  {
    id: "get-the-developer-files",
    title: "Get the developer files",
    blocks: [
      { kind: "prose", text: "**/developer/channel.json** lists every file TAVONEL publishes for developers, each with its URL and sha256, under a single channel version." },
      {
        kind: "steps",
        items: [
          "Download the file you need from the URL channel.json gives for it.",
          "Compute its sha256 and compare it with the value in channel.json: sha256sum on Linux, shasum -a 256 on macOS, certutil -hashfile with SHA256 on Windows.",
          "node tavonel-cli.mjs status prints the public status and needs no key.",
        ],
      },
      {
        kind: "code",
        label: "Fetch the CLI, check it, ask for status",
        language: "bash",
        body: [
          "curl -fsS https://tavonel.com/developer/channel.json",
          "curl -fsSO https://tavonel.com/developer/tavonel-cli.mjs",
          "sha256sum tavonel-cli.mjs",
          "node tavonel-cli.mjs status",
        ].join("\n"),
      },
      { kind: "note", text: "The CLI has no upload command. Its usage text names the key as “Scoped tvnl_live_... token (required except status)”." },
    ],
    links: [
      { href: "/developer/channel.json", label: "channel.json" },
      { href: "/docs/cli", label: "CLI and package verification" },
    ],
  },
  /*
    9. public/developer/tavonel-mcp.mjs (--version, --doctor, `assertReadOnly`, the
    API_KEY_MISSING refusal on tools/call) and /docs/mcp (docs-content "mcp": no npm or PyPI
    package, the client paths, the no-write and no-activation notes). The tool count is
    `MCP_TOOLS`, pinned against the shipped server by docs-content.test.ts.
  */
  {
    id: "connect-the-mcp-bridge",
    title: "Connect the MCP bridge",
    blocks: [
      { kind: "prose", text: `The MCP server is a single file, tavonel-mcp.mjs, with ${MCP_TOOL_COUNT_WORD} read-only tools. There is no npm or PyPI package: you download the file and point your client at it.` },
      {
        kind: "steps",
        items: [
          "Download tavonel-mcp.mjs and check its sha256 against /developer/channel.json, as in the previous chapter.",
          "node tavonel-mcp.mjs --version prints the exact build.",
          "Register it with Claude Desktop (claude_desktop_config.json) or Claude Code (.mcp.json) by its absolute path. /docs/mcp carries the block.",
          "node tavonel-mcp.mjs --doctor checks the key, the channel pin and a real read, and names the first check that failed.",
        ],
      },
      { kind: "prose", text: "The server refuses to start if a tool that writes is ever added to it. There is no activation tool: activation stays with a person in a browser." },
      { kind: "note", text: "Without a key the tool list still answers, and every tool call returns “API_KEY_MISSING: set TAVONEL_API_KEY to a key from your workspace”. Keys and your own World are set up with us." },
      { kind: "media", video: "guide-2-mcp", title: "The read-only MCP bridge, as far as it goes without a key" },
    ],
    links: [
      { href: "/docs/mcp#registering-it-with-a-client", label: "Registering it with a client" },
      { href: "/developers", label: "MCP and agents" },
    ],
  },
  /*
    10. /pricing, components/pricing-page-client.tsx: the "What will this run cost?" section
    (id usage-estimator-title), its two inputs, the ceiling rows, the plan totals and the maximum.
    Plan names are `BILLING_OFFERS` labels. While checkout is closed (`primaryCallToAction()` is
    ACCESS_CTA, lib/commercial-state.ts) every plan action goes to /contact; no price is restated.
  */
  {
    id: "estimate-a-cost",
    title: "Estimate a cost",
    blocks: [
      { kind: "prose", text: "**/pricing** carries a calculator, **What will this run cost?** Enter the sources in the run and the pages in the longest source." },
      {
        kind: "steps",
        items: [
          "It first shows how that run meets the compile ceilings, row by row.",
          `Then it shows the ${developer} and ${team} totals, the pages beyond ${developer}, and the maximum if every extra page escalates.`,
        ],
      },
      { kind: "prose", text: "“All figures in US dollars, excluding tax.”" },
      { kind: "note", text: "Buying a plan starts with a conversation: the plan actions on /pricing go to /contact." },
    ],
    links: [
      { href: "/pricing#usage-estimator-title", label: "What will this run cost?" },
      { href: "/contact", label: "Contact" },
    ],
  },
  /*
    11. app/status/page.tsx (its three section headings), app/trust/page.tsx through
    components/trust-provisions.tsx (the in place / coming / absent table, each row linked) with
    the certification row from content/trust/provisions.ts, app/security/page.tsx (h1 and the
    boundary and controls sections), app/benchmarks/gdp-pdf/page.tsx (description; the h1 is
    `gdpPdfHeadline`).
  */
  {
    id: "status-and-trust",
    title: "Status and trust",
    blocks: [
      {
        kind: "steps",
        items: [
          "**/status** shows the configuration and activation state, the scheduled dependency checks and the incident history.",
          "**/trust** lists what is in place, what is coming and what is absent, each row linked to the page that states it.",
          "**/security** describes how document processing is controlled: the enforced processing boundary and the controls customers can rely on.",
          "**/benchmarks/gdp-pdf** publishes a two-arm run on the public GDP.pdf task set, with its result as the page's headline.",
        ],
      },
      { kind: "note", text: "“No SOC 2 report, ISO 27001 certificate or independent penetration-test report exists yet.”" },
    ],
    links: [
      { href: "/status", label: "Status" },
      { href: "/trust", label: "Trust Center" },
      { href: "/security", label: "Security" },
      { href: "/benchmarks/gdp-pdf", label: "GDP.pdf run" },
    ],
  },
  /*
    12. app/sources/page.tsx (h1), app/evaluation/page.tsx (description), app/contact/page.tsx
    (description). The gate is `activationPolicy.customerData`; the intake sentence is the
    landing's.
  */
  {
    id: "start-with-your-files",
    title: "Start with your files",
    blocks: [
      {
        kind: "steps",
        items: [
          "**/sources** lists every source TAVONEL reads and what survives the read, format by format.",
          "**/evaluation** sets out how an evaluation of your documents is agreed: permissions, questions, limits, costs and evidence quality before processing begins.",
          "**/contact** asks you to “Tell us what your documents need to become, without sending the documents themselves.”",
        ],
      },
      { kind: "note", text: `“${intakeEn}”` },
    ],
    links: [
      { href: "/sources", label: "Sources" },
      { href: "/evaluation", label: "Evaluate your documents" },
      { href: "/contact", label: "Contact" },
    ],
  },
  /*
    13. `SUPPORT_ACKNOWLEDGEMENT` (lib/support-targets.ts), and the mailto every /docs section
    ends on (app/docs/[section]/page.tsx: subject "Docs feedback: <title>"). This page ends on one.
  */
  {
    id: "getting-help",
    title: "Getting help",
    blocks: [
      { kind: "prose", text: `“${SUPPORT_ACKNOWLEDGEMENT}”` },
      { kind: "prose", text: "Every documentation section ends with **Report an issue with this page**, which opens an email to support@tavonel.com with the page named in the subject. This guide ends with the same link." },
    ],
    links: [
      { href: "mailto:support@tavonel.com", label: "support@tavonel.com" },
      { href: "/contact", label: "Contact" },
    ],
  },
  /*
    Appendix. Definitions from /docs/concepts (docs-content "concepts", including its identifier
    table) and the 0-1000 page frame from /docs/cli and /docs/integration-recipes.
  */
  {
    id: "glossary",
    title: "Glossary and revision log",
    blocks: [
      {
        kind: "table",
        head: ["Term", "Meaning"],
        rows: [
          ["Compiled World", "What a set of sources compiles into: semantic objects, relations between them, and the evidence each object rests on."],
          ["Candidate", "A compile result nobody has accepted yet."],
          ["Activate", "Make a candidate the active version, the version answers are served from. A person does it in a signed-in session; no API key can."],
          ["Evidence", "A page and a region on that page, bound to a source version by digest."],
          ["Region", "The area of a page a passage was read from, as a box in the page's 0-1000 coordinate frame."],
          ["Source version", "The document plus the sha256 of its sanitized bytes. It changes when the file changes."],
        ],
      },
      {
        kind: "table",
        head: ["Date", "Change"],
        rows: [[GUIDE_REVIEWED, "First edition: chapters 0 to 13 and this appendix."]],
      },
    ],
    links: [{ href: "/docs/concepts", label: "Concepts" }],
  },
];

/* =================================================================================== Korean */

const KO: GuideChapter[] = [
  {
    id: "what-this-guide-covers",
    title: "이 가이드가 다루는 것",
    blocks: [
      { kind: "prose", text: "이 가이드는 계정 없이 누구나 오늘 사용할 수 있는 TAVONEL의 부분을 차례로 안내합니다. 근거·변경·관계를 갖춘 공개 Compiled World, 서명된 샘플 패키지, 키가 필요 없는 API 읽기, 개발자 파일, MCP 브리지입니다. 각 장은 어디를 누르는지와 화면이 어디서 멈추는지를 말합니다." },
      // KO_CHROME.customerDataGate: the site's one Korean spelling of `activationPolicy.customerData.reason`.
      { kind: "prose", text: `“${KO_CHROME.customerDataGate}”` },
      { kind: "note", text: `“${intakeKo}”` },
    ],
    links: [
      { href: "/explore", label: "Compiled World 살펴보기" },
      { href: "/ko/contact", label: "이용 문의" },
    ],
  },
  {
    id: "what-tavonel-makes",
    title: "TAVONEL이 만드는 것",
    blocks: [
      { kind: "prose", text: "TAVONEL은 문서를 **Compiled World**로 컴파일합니다. 의미 객체, 객체 사이의 관계, 그리고 각 객체가 기대는 근거입니다." },
      { kind: "prose", text: "**근거**는 페이지 하나와 그 페이지 위의 영역이며, 다이제스트로 원문 버전에 묶입니다. 근거가 없는 객체는 게시되지 않습니다." },
      { kind: "prose", text: "컴파일은 **후보**를 만듭니다. 로그인한 세션에서 사람이 그것을 활성화하고, 답은 활성 버전에서만 나옵니다. 어떤 API 키도 후보를 활성화할 수 없고, 어떤 컴파일도 스스로를 활성화하지 않습니다." },
      { kind: "note", text: `“${activationPolicy.candidatePromotion.reason}” 활성화는 언제나 사람이 명시적으로 내리는 결정입니다.` },
    ],
    links: [
      { href: "/docs/concepts", label: "개념" },
      { href: "/product/compiled-world", label: "Compiled World" },
    ],
  },
  {
    id: "open-the-public-world",
    title: "공개 World 열기",
    blocks: [
      { kind: "prose", text: "**/explore**는 Apple의 공개 SEC 공시로 컴파일한 읽기 전용 샘플 World입니다. 로그인 없이 열립니다." },
      {
        kind: "steps",
        items: [
          "/explore를 엽니다. 맨 위의 안내가 샘플과 그 원문을 수집한 날짜를 알려 줍니다.",
          "**Find a sample question** 아래에서 준비된 질문 하나를 고르거나, 입력해서 질문을 거릅니다.",
          "**Retrieved source passage** 아래의 답을 읽습니다. 검색이 고른 원문 영역의 전체 텍스트이며, 다시 쓴 글이 아닙니다.",
          "발췌 아래의 각 행은 원문 파일과 페이지를 알려 줍니다. 행을 고르면 그 페이지가 열립니다. 휴대폰에서는 **Result**와 **Source**로 발췌와 페이지를 오갑니다.",
        ],
      },
      { kind: "note", text: "“Prepared retrieval results from this artifact. Free-form AI queries are not running in this public demo.” 이 아티팩트에서 준비한 검색 결과이며, 이 공개 데모에서는 자유 형식 AI 질의가 실행되지 않습니다." },
      { kind: "media", video: "guide-1-explore", title: "공개 World에서 결과를 출처까지 따라가기" },
    ],
    links: [{ href: "/explore", label: "Compiled World 살펴보기" }],
  },
  {
    id: "read-the-evidence",
    title: "근거 읽기",
    blocks: [
      { kind: "prose", text: "원문 창은 발췌가 나온 페이지를 그 영역이 표시된 채로 보여 주고, 그 아래에 정확한 발췌를 보여 줍니다. 창의 머리글은 지금 보는 것이 원본 PDF인지, 그 페이지의 기준 렌더인지 알려 줍니다." },
      {
        kind: "steps",
        items: [
          "**Source version**은 영역이 묶인 문서의 버전을 가리킵니다. 문서와, 정제된 바이트의 sha256입니다.",
          "**Permanent evidence link**는 이 근거의 주소이며, 복사해서 공유할 수 있습니다.",
          "**Open full evidence inspector**는 객체를, 그것을 받치는 원문 영역과 함께 엽니다. 객체의 상태, 근거, 관계가 보입니다. 객체에 영역이 하나보다 많으면 **Previous**와 **Next**로 차례로 넘깁니다.",
        ],
      },
      { kind: "note", text: "“This is a quotation selected by retrieval, not an independently verified conclusion.” 검색이 고른 인용이며, 독립적으로 확인된 결론이 아니라는 뜻입니다." },
    ],
    links: [
      { href: "/explore", label: "Compiled World 살펴보기" },
      { href: "/docs/concepts#evidence", label: "개념의 근거 항목" },
    ],
  },
  {
    id: "see-what-changed",
    title: "변경 보기",
    blocks: [
      { kind: "prose", text: "**Changes**는 Apple의 2025 Form 10-K로 컴파일한 World를, 2026년 공시가 도착한 뒤의 같은 World와 나란히 둡니다." },
      {
        kind: "steps",
        items: [
          "/explore에서 **Changes**를 고릅니다.",
          "수치를 읽습니다. **Objects reached**와 **Unchanged object identities**가 있고, 그 아래에 추가·제거·제자리 재구성된 객체가 있습니다.",
          "**FILINGS THAT ARRIVED**는 도착한 공시마다 그것을 읽은 페이지를 보여 주고, 원본 PDF나 그 기준 렌더를 엽니다.",
          "**HOW THIS WORLD WAS REACHED**는 단계마다 추가·제자리 재구성·제거·변경 없음을 나열합니다.",
          "**Objects, relations and evidence as a list**는 모든 객체에 AFFECTED 또는 UNCHANGED를 글자로 표시합니다.",
        ],
      },
      { kind: "prose", text: "이것은 이 샘플에 기록된 비교이며, 새 공시를 실시간으로 받는 피드가 아닙니다." },
      { kind: "note", text: "“Both snapshots are complete compiles of the corpus as it stood, compared object by object. Every count below is measured from that comparison.” 두 스냅숏은 모두 그 시점의 코퍼스를 완전히 컴파일한 것이며, 객체 단위로 비교했습니다. 아래의 모든 수치는 그 비교에서 측정한 것입니다." },
    ],
    links: [{ href: "/explore?act=change", label: "Changes" }],
  },
  {
    id: "relations",
    title: "관계 보기",
    blocks: [
      { kind: "prose", text: "**Relations**는 World를 컴파일된 객체와 객체 사이의 관계로 이루어진 그래프로 엽니다." },
      {
        kind: "steps",
        items: [
          "/explore에서 **Relations**를 고릅니다.",
          "객체를 선택합니다. **Directly connected**가 각 관계를 그 이름과 반대쪽 끝의 객체로 나열합니다.",
          "객체에 근거가 있으면 **Open source evidence**가 그것을 받치는 영역으로 데려갑니다.",
          "**Objects, relations and evidence as a list**는 같은 그래프를 텍스트로 보여 줍니다. 시스템이 동작 줄이기를 요청하면 처음부터 열려 있습니다.",
        ],
      },
      { kind: "note", text: "그래프 아래의 줄은 World의 그래프 노드 가운데 몇 개가 화면에 있는지 알려 줍니다." },
    ],
    links: [{ href: "/explore?act=world", label: "Relations" }],
  },
  {
    id: "verify-a-signed-package",
    title: "서명 패키지 검증",
    blocks: [
      { kind: "prose", text: "**/demo**는 합성 원문 하나를 컴파일, 검토, 활성화를 거쳐 답과 서명된 내보내기까지 따라갑니다." },
      {
        kind: "steps",
        items: [
          "/demo를 열고 **Signed export**로 갑니다. 샘플 매니페스트에 대한 Ed25519 서명 확인 결과와 함께 매니페스트 스키마, 패키지 파일, 키, 서명된 페이로드 다이제스트가 보입니다.",
          "**Download the offline verifier**를 누르면 tavonel-verify-export.mjs를 받습니다. /developer/channel.json이 내보내기를 확인하는 파일로 올려 둔 파일입니다.",
          "GET /api/export/trust는 내보내기에 서명하는 키 기록을 공개하고, 서명자가 설정되지 않은 곳에서는 EXPORT_SIGNER_NOT_CONFIGURED로 거절합니다.",
          "검증기는 아카이브를 확인합니다. World의 아카이브를 내려받으려면 collections:download scope를 가진 API 키가 필요합니다.",
        ],
      },
      { kind: "note", text: "“A valid signature proves manifest integrity. It does not certify semantic quality, customer approval, or current activation status.” 유효한 서명은 매니페스트의 무결성을 증명합니다. 의미 품질, 고객의 승인, 현재 활성화 상태를 보증하지는 않습니다." },
    ],
    links: [
      { href: "/demo", label: "서명된 제품 경로" },
      { href: "/docs/exports", label: "내보내기" },
      { href: "/docs/cli", label: "CLI와 패키지 검증" },
    ],
  },
  {
    id: "call-the-api-without-a-key",
    title: "키 없이 API 호출",
    blocks: [
      { kind: "prose", text: "**/api**의 API 레퍼런스는 **Try it, with no key**로 시작합니다. “Three unauthenticated reads, run from this page against TAVONEL. No signup, no credential, nothing that spends.” 이 페이지에서 TAVONEL을 상대로 실행하는 인증 없는 읽기 세 가지입니다. 가입도, 자격 증명도, 비용이 드는 일도 없습니다." },
      {
        kind: "steps",
        items: [
          "**What TAVONEL can read**는 GET /api/v1/capabilities를 실행합니다. 업로드 경로가 형식을 확인할 때 사용하는 것과 같은 목록입니다.",
          "**What is open right now**는 GET /api/status를 실행합니다. 내 파일의 컴파일이 열려 있는지도 여기에 나옵니다.",
          "**The shape of an answer**는 GET /reproducibility/sample-world를 실행합니다. 고정 샘플에서 객체, 근거, 원문 버전, 페이지, 영역을 돌려줍니다.",
          "Integration recipes의 Recipe 2는 같은 읽기를 공개된 Python 스크립트로 합니다. 이 스크립트는 받은 바이트로 응답의 Content-Digest 헤더를 다시 계산합니다.",
        ],
      },
      { kind: "note", text: "“A deterministic product fixture, unsigned and labelled as such in its own disclosure field. Build against the shape; do not judge extraction from it.” 결정적인 제품 픽스처이며, 서명되지 않았고 자체 disclosure 필드에 그렇게 표시되어 있습니다. 모양에 맞춰 개발하고, 이것으로 추출 품질을 판단하지 마세요." },
      { kind: "media", video: "guide-3-api", title: "키 없이 하는 첫 API·CLI 호출" },
    ],
    links: [
      { href: "/api#try-it-heading", label: "Try it, with no key" },
      { href: "/docs/integration-recipes#recipe-2-python-over-the-public-sample-world", label: "Recipe 2: 공개 샘플 World를 Python으로" },
    ],
  },
  {
    id: "get-the-developer-files",
    title: "개발자 파일 받기",
    blocks: [
      { kind: "prose", text: "**/developer/channel.json**은 TAVONEL이 개발자에게 공개하는 모든 파일을 URL, sha256과 함께 하나의 채널 버전 아래에 나열합니다." },
      {
        kind: "steps",
        items: [
          "필요한 파일을 channel.json에 적힌 URL에서 내려받습니다.",
          "파일의 sha256을 계산해 channel.json의 값과 비교합니다. Linux는 sha256sum, macOS는 shasum -a 256, Windows는 certutil -hashfile에 SHA256을 붙여 실행합니다.",
          "node tavonel-cli.mjs status는 공개 상태를 출력하며 키가 필요 없습니다.",
        ],
      },
      {
        kind: "code",
        label: "CLI를 받고, 확인하고, 상태를 묻기",
        language: "bash",
        body: [
          "curl -fsS https://tavonel.com/developer/channel.json",
          "curl -fsSO https://tavonel.com/developer/tavonel-cli.mjs",
          "sha256sum tavonel-cli.mjs",
          "node tavonel-cli.mjs status",
        ].join("\n"),
      },
      { kind: "note", text: "CLI에는 업로드 명령이 없습니다. 사용법 텍스트는 키를 “Scoped tvnl_live_... token (required except status)”로 적습니다. status를 뺀 모든 명령에 범위가 정해진 키가 필요하다는 뜻입니다." },
    ],
    links: [
      { href: "/developer/channel.json", label: "channel.json" },
      { href: "/docs/cli", label: "CLI와 패키지 검증" },
    ],
  },
  {
    id: "connect-the-mcp-bridge",
    title: "MCP 브리지 연결",
    blocks: [
      { kind: "prose", text: `MCP 서버는 파일 하나, tavonel-mcp.mjs이며 읽기 전용 도구 ${MCP_TOOLS.length}개를 제공합니다. npm이나 PyPI 패키지는 없습니다. 파일을 내려받고 클라이언트가 그 파일을 가리키게 합니다.` },
      {
        kind: "steps",
        items: [
          "tavonel-mcp.mjs를 내려받고, 앞 장처럼 /developer/channel.json으로 sha256을 확인합니다.",
          "node tavonel-mcp.mjs --version은 정확한 빌드를 출력합니다.",
          "Claude Desktop(claude_desktop_config.json)이나 Claude Code(.mcp.json)에 절대 경로로 등록합니다. 설정 블록은 /docs/mcp에 있습니다.",
          "node tavonel-mcp.mjs --doctor는 키, 채널 고정값, 실제 읽기를 점검하고, 처음 실패한 점검을 알려 줍니다.",
        ],
      },
      { kind: "prose", text: "쓰기 도구가 추가되면 서버는 시작을 거부합니다. 활성화 도구는 없습니다. 활성화는 브라우저에서 사람이 합니다." },
      { kind: "note", text: "키가 없어도 도구 목록은 응답하고, 모든 도구 호출은 “API_KEY_MISSING: set TAVONEL_API_KEY to a key from your workspace”를 돌려줍니다. 워크스페이스에서 발급한 키를 TAVONEL_API_KEY에 넣으라는 뜻입니다. 키와 내 World는 저희와 함께 설정합니다." },
      { kind: "media", video: "guide-2-mcp", title: "읽기 전용 MCP 브리지 — 키 없이 갈 수 있는 곳까지" },
    ],
    links: [
      { href: "/docs/mcp#registering-it-with-a-client", label: "클라이언트에 등록하기" },
      { href: "/developers", label: "MCP와 에이전트" },
    ],
  },
  {
    id: "estimate-a-cost",
    title: "비용 미리 보기",
    blocks: [
      { kind: "prose", text: "**/pricing**에는 계산기 **What will this run cost?**가 있습니다. 이번 실행의 원문 수와 가장 긴 원문의 페이지 수를 넣습니다." },
      {
        kind: "steps",
        items: [
          "먼저 그 실행이 컴파일 한도를 어떻게 만나는지 행별로 보여 줍니다.",
          `이어서 ${developer}와 ${team}의 합계, ${developer}를 넘는 페이지, 추가 페이지가 모두 상향될 때의 최대 금액을 보여 줍니다.`,
        ],
      },
      { kind: "prose", text: "“All figures in US dollars, excluding tax.” 모든 금액은 미국 달러이며 세금은 포함하지 않습니다." },
      { kind: "note", text: "요금제 구매는 상담으로 시작합니다. /pricing의 요금제 버튼은 /contact로 연결됩니다." },
    ],
    links: [
      { href: "/pricing#usage-estimator-title", label: "What will this run cost?" },
      { href: "/ko/pricing", label: "요금" },
      { href: "/ko/contact", label: "이용 문의" },
    ],
  },
  {
    id: "status-and-trust",
    title: "상태와 신뢰",
    blocks: [
      {
        kind: "steps",
        items: [
          "**/status**는 설정과 활성화 상태, 예약된 의존성 점검, 장애 이력을 보여 줍니다.",
          "**/trust**는 갖춘 것, 앞으로 갖출 것, 없는 것을 나열하고, 각 행을 그것을 밝힌 페이지에 연결합니다.",
          "**/security**는 문서 처리를 어떻게 통제하는지 설명합니다. 강제되는 처리 경계와, 믿고 기댈 수 있는 통제입니다.",
          "**/benchmarks/gdp-pdf**는 공개 GDP.pdf 과제 세트로 돌린 두 갈래 실행을 게시하며, 그 결과를 페이지 제목으로 보여 줍니다.",
        ],
      },
      { kind: "note", text: "“No SOC 2 report, ISO 27001 certificate or independent penetration-test report exists yet.” SOC 2 보고서, ISO 27001 인증서, 독립 침투 테스트 보고서는 없습니다." },
    ],
    links: [
      { href: "/status", label: "상태" },
      { href: "/trust", label: "신뢰 센터" },
      { href: "/security", label: "보안" },
      { href: "/benchmarks/gdp-pdf", label: "GDP.pdf 실행" },
    ],
  },
  {
    id: "start-with-your-files",
    title: "내 파일로 시작하려면",
    blocks: [
      {
        kind: "steps",
        items: [
          "**/sources**는 TAVONEL이 읽는 모든 원문과, 읽은 뒤에 남는 것을 형식별로 나열합니다.",
          "**/ko/evaluation**은 내 문서 평가를 어떻게 합의하는지 설명합니다. 처리를 시작하기 전에 권한, 질문, 한도, 비용, 근거 품질을 정합니다.",
          "**/ko/contact**는 이렇게 묻습니다. “자료를 보내지 않고 해결하려는 일과 필요한 범위를 알려주세요.”",
        ],
      },
      { kind: "note", text: `“${intakeKo}”` },
    ],
    links: [
      { href: "/sources", label: "지원 파일" },
      { href: "/ko/evaluation", label: "내 문서 평가" },
      { href: "/ko/contact", label: "이용 문의" },
    ],
  },
  {
    id: "getting-help",
    title: "도움 받기",
    blocks: [
      { kind: "prose", text: `“${SUPPORT_ACKNOWLEDGEMENT}” support@tavonel.com으로 보낸 메일은 KST 기준 1영업일 안에 접수를 확인합니다. 이는 접수 확인 목표이며 해결 시간이 아닙니다. 해결 시간은 약속하지 않으며, security@tavonel.com으로 보낸 보안 제보는 제품 문의 뒤에 쌓이지 않고 먼저 읽습니다.` },
      { kind: "prose", text: "모든 문서 섹션은 **Report an issue with this page**로 끝납니다. 누르면 support@tavonel.com으로 가는 메일이 열리고, 제목에 그 페이지가 적힙니다. 이 가이드는 같은 메일을 여는 **이 페이지의 문제 알리기** 링크로 끝납니다." },
    ],
    links: [
      { href: "mailto:support@tavonel.com", label: "support@tavonel.com" },
      { href: "/ko/contact", label: "이용 문의" },
    ],
  },
  {
    id: "glossary",
    title: "용어집과 개정 이력",
    blocks: [
      {
        kind: "table",
        head: ["용어", "뜻"],
        rows: [
          ["Compiled World", "원문 묶음을 컴파일한 결과입니다. 의미 객체, 객체 사이의 관계, 각 객체가 기대는 근거로 이루어집니다."],
          ["후보", "받아들여지기 전의 컴파일 결과입니다."],
          ["활성화", "후보를 활성 버전, 즉 답이 나오는 버전으로 만드는 일입니다. 로그인한 세션에서 사람이 하며, API 키로는 할 수 없습니다."],
          ["근거", "페이지 하나와 그 페이지 위의 영역이며, 다이제스트로 원문 버전에 묶입니다."],
          ["영역", "발췌를 읽은 페이지의 부분이며, 페이지의 0-1000 좌표계 안의 상자로 나타냅니다."],
          ["원문 버전", "문서와, 정제된 바이트의 sha256입니다. 파일이 바뀌면 함께 바뀝니다."],
        ],
      },
      {
        kind: "table",
        head: ["날짜", "변경"],
        rows: [[GUIDE_REVIEWED, "초판: 0장부터 13장까지와 이 부록."]],
      },
    ],
    links: [{ href: "/docs/concepts", label: "개념" }],
  },
];

export const GUIDE: Record<GuideLanguage, readonly GuideChapter[]> = { en: EN, ko: KO };

/** The guide's own block for a recording, so a docs page that shows it uses the guide's title. */
export function guideMediaBlock(video: GuideVideo, language: GuideLanguage = "en"): GuideMediaBlock {
  for (const chapter of GUIDE[language]) {
    for (const block of chapter.blocks) if (block.kind === "media" && block.video === video) return block;
  }
  throw new Error(`the ${language} guide has no media block for ${video}`);
}

/** Every sentence of one language's guide, for the guards and for a reader that wants the text. */
export function guideText(language: GuideLanguage): string[] {
  const ui = GUIDE_UI[language];
  return [
    ui.title,
    ui.lede,
    ...GUIDE[language].flatMap((chapter) => [
      chapter.title,
      ui.apiKey[guideChapterApiKey(chapter.id)],
      ...chapter.links.map((link) => link.label),
      ...chapter.blocks.flatMap((block) => {
        switch (block.kind) {
          case "prose":
          case "note":
            return [block.text];
          case "steps":
            return block.items;
          case "table":
            return [...block.head, ...block.rows.flat()];
          case "code":
            return [block.label, block.body];
          case "media":
            return [block.title];
        }
      }),
    ]),
  ];
}
