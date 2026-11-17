import type { Metadata } from "next";
/*
  Not `@/app/solutions/...`: importing a page module imports its stylesheets, and /explore drew none
  of them yet shipped them render-blocking (2026-11-09, LCP over budget). The picks and the
  resolver live in `lib/solution-proof-picks`; `lib/solution-workflows.test.ts` pins both halves.
*/
import { SOLUTION_PROOF_PICKS, solutionWorkflowEvidence, type WorkflowKind } from "@/lib/solution-proof-picks";
import ExploreStage from "@/components/explore/explore-stage";
import SiteFooter from "@/components/v34/shell/site-footer";
import SiteHeader from "@/components/v34/shell/site-header";
import tokens from "@/components/v34/tokens.module.css";
import { primaryCallToAction } from "@/lib/commercial-state";
import { chooseExploreEntryProof } from "@/lib/explore-entry-proof";
import {
  exploreChangeBaselineDocument,
  exploreChangeStory,
  exploreChangeTimeline,
} from "@/lib/explore-change";
import {
  EXPLORE_SAMPLE_SOURCE_DIRECTORY,
  exploreSampleAnswers,
  exploreSampleArtifact,
  exploreSampleDocuments,
  exploreSampleWorld,
} from "@/lib/explore-sample";
import {
  buildExploreAnswerViews,
  buildExploreChangeView,
  type ExploreTechnicalRecord,
} from "@/lib/explore-story";
import {
  boundVisualWorld,
  layoutVisualWorld,
  toVisualWorldModel,
} from "@/lib/visual-world-model";
import secCorpusManifest from "@/public/explore-sample/sec-corpus-manifest.json";

export const metadata: Metadata = {
  title: "Explore a Compiled World and its evidence — TAVONEL",
  description:
    "Step inside a compiled World: open any object to the filing, the page and the exact region it came from, and see what four newly filed documents rebuilt.",
  alternates: { canonical: "/explore" },
  openGraph: { url: "/explore" },
};

/*
  A server component, so the compile happens once, at build time, on the server.

  `lib/explore-sample` reads the committed filings' extracted text layer, runs the production
  compiler over five World snapshots -- the annual filing alone, then the World after each of the
  four 2026 filings arrived -- and refuses to load if any of them stops matching its frozen
  digest. Doing that here rather than in the browser keeps `node:crypto` and the compiler off the
  client bundle: what ships is the adapted `VisualWorldModel` and the layout derived from it, not
  the machinery that produced them.

  The layout is computed here for the same reason it is a pure function -- one composition for
  every device, and a server-rendered first paint that already has the world in it.

  What the stage receives is `boundVisualWorld(...)`, not `world` (§24). The World /explore is
  built from is the TypeScript engine's output -- 6,300 objects and 1,281 regions, not the 4,402
  the live Core delivers on the same bytes -- and every object carries a reference to every region of its
  filing, so serializing it whole into the RSC payload costs hundreds of megabytes. The full model stays
  here, on the server, where the counts, the Ask answers and the technical drawer are read off
  it; the browser gets the drawn composition, one hop out from it, and the source regions that
  composition can open. `model.totals` carries the compiled figures across the boundary, so a
  smaller payload never becomes a smaller published number.
*/

/*
  WG-034: the capture date, read off the acquisition record rather than typed into copy.

  `scripts/fetch-explore-sec-corpus.mjs` stamps `generatedAt` when it acquires the filings and
  writes the manifest; `scripts/build-explore-sample.mjs` compiles the World from exactly those
  files. So this is the day the sample's sources were captured, and it moves only when somebody
  re-acquires them. A per-document `filingDate` is not this date and cannot stand in for it: a
  filing is dated when the issuer filed it, not when we read it.
*/
const capturedOn = secCorpusManifest.generatedAt.slice(0, 10);

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const layout = layoutVisualWorld(world);
const change = buildExploreChangeView(
  exploreChangeStory,
  exploreChangeBaselineDocument,
  exploreChangeTimeline,
);
const answers = buildExploreAnswerViews(exploreSampleAnswers, world.evidence);
const entryProof = chooseExploreEntryProof(world.evidence, answers);
/*
  Each Solutions page links one passage here as `/explore?evidence=<id>`, and that passage is what
  `solutionWorkflowEvidence` resolves from the page's own proof pick (`SOLUTION_PROOF_PICKS`) -- the call the page renders
  from. Naming those regions keeps them, an owner and their page-mates in the bounded model through
  the same `keepRegionIds` the Ask citations use. Nothing is typed: a pick that stops resolving
  throws here at build time rather than shipping a link that opens some other passage.
*/
const solutionTargets = (Object.keys(SOLUTION_PROOF_PICKS) as WorkflowKind[]).map(
  (slug) => solutionWorkflowEvidence(slug, SOLUTION_PROOF_PICKS[slug]).region.id,
);
const model = boundVisualWorld(
  world,
  layout.placements.map((placement) => placement.id),
  [...answers.flatMap((answer) => answer.regions.map((region) => region.evidenceId)),
    ...(entryProof ? [entryProof.id] : []),
    ...solutionTargets],
);
/*
  Foundation 424. The stage resolves `?evidence=<id>` only when the exact region *and* an owner
  holding it both shipped; either half missing renders the unavailable state. So a published
  Solutions link is kept whole here -- region and retained owner together -- and a target that
  would ship without one fails the build instead of shipping a link that opens nothing. This is a
  correctness check on named IDs, not a size gate: REGION_BOUND and RELATION_BOUND bound only the
  initial selection, and explicit retention plus page-mates may legitimately exceed them.
*/
for (const id of solutionTargets) {
  const shipped = model.evidence.some((item) => item.id === id);
  const owned = model.nodes.some((node) => node.evidenceRefs.includes(id));
  if (!shipped || !owned) throw new Error(`explore_solution_target_unretained:${id}`);
}

const technical: ExploreTechnicalRecord = {
  worldId: world.worldId,
  worldStatus: world.status,
  manifestDigest: world.manifestDigest,
  runtime: exploreSampleArtifact.coreExecution.runtime,
  receipt: {
    requestId: exploreSampleArtifact.coreExecution.receipt.requestId,
    inputSha256: exploreSampleArtifact.coreExecution.receipt.inputSha256,
    outputSha256: exploreSampleArtifact.coreExecution.receipt.outputSha256,
    manifestDigest: exploreSampleArtifact.coreExecution.receipt.manifestDigest,
  },
  sourceDirectory: EXPLORE_SAMPLE_SOURCE_DIRECTORY,
  documents: [...exploreSampleDocuments],
  revisions: world.revisions,
  /* The compiled World's counts, read off the full model rather than the bounded one. */
  counts: { ...world.totals },
  shipped: {
    objects: model.nodes.length,
    relations: model.edges.length,
    regions: model.evidence.length,
  },
};

/*
  D33 #4 (WO-CI-6B): /explore is a retained public route, so it carries the V34 shell. Every other
  retained route gets it from `V34Page` (through `PublicSitePage`); this one cannot take `V34Page`
  itself because the stage renders the page's one `<main id="main">` and the T4 template mark on it.

  So the page draws V34Page's header and footer, each inside V34Page's token wrapper, and leaves the
  stage OUTSIDE both wrappers. `.site` is not only variables: it sets the colour scheme, the font,
  the size and the line height every descendant inherits, and the stage was drawn on the legacy
  body's (15px, 1.62, dark). Wrapping the stage in it changed the computed style of every element
  in the workbench (round 1 review, receipts/review-WO-CI-6B/r19/probe-inherit.txt: 112 elements at
  1440). Outside it, the stage inherits exactly what it inherited before, from the same body.

  `display: contents`: the wrappers pass the tokens down by inheritance but draw no box of their
  own. With a box, `.site`'s `min-height: 100vh` would make the header a screen tall, and the
  header's `position: sticky` would be confined to a wrapper as tall as itself. The header and the
  footer paint their own surfaces (`tokens.paper`, `tokens.forest`), so nothing paints the wrapper.
  `lib/v34/retained-shell.test.ts` holds both to V34Page's own markup and the stage outside them.

  The header and footer stay here, on the server, rather than inside the stage (a client component),
  so the footer directory is not shipped to the browser (chrome-02 / D35). The legacy
  `PublicSiteFooter` this replaces is what put the legacy chrome stylesheet chunk on the route's first
  paint (WO-CI-6); the same test fails if any module this page reaches imports that chrome again.

  `SiteHeader` gets no `currentPath`, as on every retained route: /explore is not a primary item, and
  the More panel and the drawer read the path themselves.
*/
const shellPart = { className: tokens.site, "data-v34-site": "", style: { display: "contents" } } as const;

export default function ExplorePage() {
  return (
    <>
      <div {...shellPart}>
        <SiteHeader />
      </div>
      <ExploreStage
        access={primaryCallToAction()}
        model={model}
        layout={layout}
        change={change}
        answers={answers}
        technical={technical}
        capturedOn={capturedOn}
      />
      <div {...shellPart}>
        <SiteFooter />
      </div>
    </>
  );
}
