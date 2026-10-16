import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EvidenceWorkbench from "./evidence-workbench";
import AskOverlay from "./ask-overlay";
import { EXPLORE_COPY, buildExploreAnswerViews, type ExploreAnswerView } from "@/lib/explore-story";
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

/* Text as renderToStaticMarkup escapes it, so a whole answer can be looked for verbatim. */
const escaped = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const SOURCE_VIEWER = 'aria-label="Original source viewer"';
const OVERFLOW = EXPLORE_COPY.askAbstentions.EVIDENCE_EXCEEDS_ANSWER_LIMIT;
const company = answers.find(view => view.question.includes("Company Background"))!;
const grounded = answers.filter(view => view.status === "grounded");
function workbench(list: ExploreAnswerView[]) {
  return renderToStaticMarkup(<EvidenceWorkbench model={model} answers={list} technical={technical} capturedOn="2026-09-01" onOpenRegion={() => {}} onRelations={() => {}} onChanges={() => {}} />);
}
function ask(list: ExploreAnswerView[], index: number) {
  return renderToStaticMarkup(<AskOverlay answers={list} index={index} onSelectQuestion={() => {}} onOpenRegion={() => {}} onClose={() => {}} />);
}

describe("both Ask consumers render the retriever's state", () => {
  it("starts from the actual views: grounded answers and the Company Background overflow", () => {
    expect(company.status).toBe("abstained");
    expect(company.answer).toBe("");
    expect(company.regions.length).toBeGreaterThan(0);
    expect(grounded.length).toBe(answers.length - 1);
  });

  it("quotes the complete grounded answer in the workbench, apart from the source passage", () => {
    for (const view of grounded) {
      const html = workbench([view]);
      const [article, source] = html.split(SOURCE_VIEWER);
      expect(article, view.question).toContain(`<blockquote>${escaped(view.answer)}</blockquote>`);
      expect(article).toContain("This is a quotation selected by retrieval");
      expect(article).not.toContain(OVERFLOW.slice(0, 30));
      // The source viewer still quotes its region, under its own source-evidence label.
      expect(source).toContain("Source evidence · exact selected passage");
      expect(source).toContain("<blockquote>");
    }
  });

  it("states the overflow in the workbench without an answer quotation, and keeps every source link", () => {
    const html = workbench([company]);
    const [article, source] = html.split(SOURCE_VIEWER);
    expect(article).toContain(escaped(company.question));
    expect(article).not.toContain("<blockquote");
    expect(article).not.toContain("This is a quotation selected by retrieval");
    expect(article).toContain(`role="status">${escaped(OVERFLOW)}</p>`);
    expect(html).not.toContain("EVIDENCE_EXCEEDS_ANSWER_LIMIT");
    expect(article).toContain('aria-label="Source evidence"');
    for (const region of company.regions) expect(article).toContain(`Page ${region.page} →`);
    expect(company.regions.some(region => article.includes(encodeURIComponent(region.evidenceId)))).toBe(true);
    expect(article).toContain("Open full evidence inspector ↗");
    expect(source).toContain("data-source-id=");
    expect(source).toContain("Source evidence · exact selected passage");
  });

  it("quotes the complete grounded answer in the Ask panel", () => {
    for (const view of grounded) {
      const html = ask(answers, answers.indexOf(view));
      expect(html, view.question).toMatch(new RegExp(`<blockquote[^>]*>${escaped(view.answer).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</blockquote>`));
      expect(html).not.toContain(OVERFLOW.slice(0, 30));
    }
  });

  it("states the overflow in the Ask panel without an answer quotation, and keeps every source link", () => {
    const html = ask(answers, answers.indexOf(company));
    expect(html).not.toContain("<blockquote");
    expect(html).toContain(`role="status">${escaped(OVERFLOW)}</p>`);
    expect(html).not.toContain("EVIDENCE_EXCEEDS_ANSWER_LIMIT");
    expect(html).toContain(`${company.regions.length} SOURCE REGION`);
    for (const region of company.regions) {
      expect(html).toContain(escaped(region.filename));
      expect(html).toContain(`PAGE ${region.page}`);
    }
    // The question group does not promise every prepared question is answered.
    expect(html).toContain('aria-label="Prepared questions"');
    expect(html).not.toContain("Questions this sample answers");
  });

  it("renders the Ask panel safely with no prepared answers", () => {
    const html = ask([], 0);
    expect(html).toContain("No prepared answer is available");
    expect(html).not.toContain("<blockquote");
    expect(html).not.toContain("SOURCE REGION");
  });
});
