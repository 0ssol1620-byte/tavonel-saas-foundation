import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EvidenceWorkbench from "./evidence-workbench";
import { buildExploreAnswerViews } from "@/lib/explore-story";
import { exploreSampleAnswers, exploreSampleDocuments, exploreSampleWorld } from "@/lib/explore-sample";
import { toVisualWorldModel } from "@/lib/visual-world-model";
import type { ExploreTechnicalRecord } from "@/lib/explore-story";
vi.mock("@/components/world-visual/original-source-page", () => ({default: ({active}: {active: {id:string}}) => <div data-source-id={active.id} />}));
const model = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const answers = buildExploreAnswerViews(exploreSampleAnswers, model.evidence);
const technical = { documents: [...exploreSampleDocuments] } as ExploreTechnicalRecord;
function markup() { return renderToStaticMarkup(<EvidenceWorkbench model={model} answers={answers} technical={technical} capturedOn="2026-09-01" onOpenRegion={() => {}} onRelations={() => {}} onChanges={() => {}} />); }
describe("source-first workbench", () => {
  it("handles an empty artifact without fabricating a result or source", () => {
    const html = renderToStaticMarkup(<EvidenceWorkbench model={{...model, evidence:[]}} answers={[]} technical={technical} capturedOn="2026-09-01" onOpenRegion={() => {}} onRelations={() => {}} onChanges={() => {}} />);
    expect(html).toContain("No prepared answer is available");
    expect(html).toContain("No source region is available");
    expect(html).not.toContain("data-source-id=");
  });
  it("opens on a real retrieved passage with an explicit demo boundary", () => {
    const html = markup();
    expect(html).toContain("Find a sample question");
    expect(html).toContain("Free-form AI queries are not running");
    expect(html).toContain("Candidate · inspect evidence");
    expect(html).toContain("data-source-id=");
    expect(html).toContain("Permanent evidence link");
    expect(html).toContain(encodeURIComponent(answers[0].regions[0].evidenceId));
  });
  it("keeps graph and changes opt-in and offers a readable mobile alternative", () => {
    const html = markup();
    expect(html).toContain("Relations ↗");
    expect(html).toContain("Changes ↗");
    expect(html).toContain('aria-label="Reading pane"');
    expect(html).toContain('aria-label="Original source viewer"');
    expect(html).not.toContain("<canvas");
  });
});
