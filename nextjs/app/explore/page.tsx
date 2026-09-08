import type { Metadata } from "next";
import ExploreStage from "@/components/explore/explore-stage";
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

export const metadata: Metadata = {
  title: "Explore a Compiled World | TAVONEL",
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

  What the stage receives is `boundVisualWorld(...)`, not `world` (§24). The compiled World is
  6,300 objects and 1,281 regions and every object carries a reference to every region of its
  filing, so serializing it whole into the RSC payload costs hundreds of megabytes. The full model stays
  here, on the server, where the counts, the Ask answers and the technical drawer are read off
  it; the browser gets the drawn composition, one hop out from it, and the source regions that
  composition can open. `model.totals` carries the compiled figures across the boundary, so a
  smaller payload never becomes a smaller published number.
*/

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const layout = layoutVisualWorld(world);
const change = buildExploreChangeView(
  exploreChangeStory,
  exploreChangeBaselineDocument,
  exploreChangeTimeline,
);
const answers = buildExploreAnswerViews(exploreSampleAnswers, world.evidence);
const model = boundVisualWorld(
  world,
  layout.placements.map((placement) => placement.id),
  answers.flatMap((answer) => answer.regions.map((region) => region.evidenceId)),
);

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

export default function ExplorePage() {
  return (
    <ExploreStage
      model={model}
      layout={layout}
      change={change}
      answers={answers}
      technical={technical}
    />
  );
}
