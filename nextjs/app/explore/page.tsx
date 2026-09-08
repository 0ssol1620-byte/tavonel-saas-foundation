import type { Metadata } from "next";
import ExploreStage from "@/components/explore/explore-stage";
import { exploreChangeBaselineDocument, exploreChangeStory } from "@/lib/explore-change";
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
import { layoutVisualWorld, toVisualWorldModel } from "@/lib/visual-world-model";

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
  compiler over two World snapshots -- the annual filing alone, and the annual filing plus the
  four 2026 filings -- and refuses to load if either stops matching its frozen digest. Doing that here rather than in the browser keeps `node:crypto` and the
  compiler off the client bundle: what ships is the adapted `VisualWorldModel` and the layout
  derived from it, not the machinery that produced them.

  The layout is computed here for the same reason it is a pure function -- one composition for
  every device, and a server-rendered first paint that already has the world in it.
*/

const model = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const layout = layoutVisualWorld(model);
const change = buildExploreChangeView(exploreChangeStory, exploreChangeBaselineDocument);
const answers = buildExploreAnswerViews(exploreSampleAnswers, model.evidence);

const technical: ExploreTechnicalRecord = {
  worldId: model.worldId,
  worldStatus: model.status,
  manifestDigest: model.manifestDigest,
  runtime: exploreSampleArtifact.coreExecution.runtime,
  receipt: {
    requestId: exploreSampleArtifact.coreExecution.receipt.requestId,
    inputSha256: exploreSampleArtifact.coreExecution.receipt.inputSha256,
    outputSha256: exploreSampleArtifact.coreExecution.receipt.outputSha256,
    manifestDigest: exploreSampleArtifact.coreExecution.receipt.manifestDigest,
  },
  sourceDirectory: EXPLORE_SAMPLE_SOURCE_DIRECTORY,
  documents: [...exploreSampleDocuments],
  revisions: model.revisions,
  counts: {
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
