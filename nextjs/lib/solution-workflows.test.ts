import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ExplorePage from "../app/explore/page";
import SolutionsPage from "../app/solutions/page";
import SolutionPage, { SOLUTIONS } from "../app/solutions/[slug]/page";
import SolutionWorkflowProof, { solutionWorkflowEvidence } from "../app/solutions/solution-workflow-proof";
import { exploreSampleArtifact, exploreSampleAnswers, exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import {
  REGION_BOUND,
  RELATION_BOUND,
  boundVisualWorld,
  layoutVisualWorld,
  toVisualWorldModel,
  type VisualWorldModel,
} from "./visual-world-model";

// This suite owns Solutions composition and evidence, rather than commercial state or chrome.
vi.mock("@/components/public-page-shell", () => ({
  PublicPageShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("@/components/public-primary-cta", () => ({ default: () => null }));
// The /explore page is read for the model it hands the stage, never rendered as the client stage.
vi.mock("@/components/explore/explore-stage", () => ({ default: () => null }));

const entries = Object.entries(SOLUTIONS) as [keyof typeof SOLUTIONS, typeof SOLUTIONS[keyof typeof SOLUTIONS]][];
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

describe("Solutions task choices and workflow evidence", () => {
  it("renders the same input/action/output on hub and every detail, with adoption content once", async () => {
    const hub = renderToStaticMarkup(createElement(SolutionsPage));
    expect((hub.match(/id="design-partners-title"/g) ?? []).length).toBe(1);
    for (const [slug, solution] of entries) {
      const detail = renderToStaticMarkup(await SolutionPage({ params: Promise.resolve({ slug }) }));
      expect(hub).toContain(`href="/solutions/${slug}"`);
      for (const value of Object.values(solution.task)) {
        expect(hub).toContain(escape(value));
        expect(detail).toContain(escape(value));
      }
      expect(detail).not.toContain('id="design-partners-title"');
      expect(detail).toContain('href="/solutions#design-partners-title"');
      expect(detail).toMatch(/<details[^>]*class="solution-notes"[^>]*open=""/);
      for (const limitation of solution.limitations) expect(detail).toContain(escape(limitation));
      expect(detail).toContain('href="/docs"');
    }
  });

  it("binds every readable passage to the actual sample source and its evidence destination", () => {
    for (const [slug, solution] of entries) {
      const proof = solutionWorkflowEvidence(slug, solution.proof);
      expect(exploreSampleWorld.evidence).toContain(proof.region);
      expect(proof.document.documentId).toBe(proof.region.sourceId);
      const html = renderToStaticMarkup(createElement(SolutionWorkflowProof, { kind: slug, pick: solution.proof }));
      expect(html).toContain(`data-workflow-proof="${slug}"`);
      expect(html).toContain(escape(proof.region.excerpt.slice(0, 100)));
      expect(html).toContain(encodeURIComponent(proof.region.id));
      expect(html).toContain("mechanics demonstrations, not customer engagements or domain-accuracy results");
    }
  });

  it("ships every published Solutions target in the bounded /explore model, with its locator and owner", () => {
    // The model /explore actually hands its stage, not a projection rebuilt beside it.
    const [stage] = ExplorePage().props.children as [ReactElement<{ model: VisualWorldModel }>, ReactNode];
    const shipped = stage.props.model;
    const full = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
    const shippedIds = new Set(shipped.evidence.map((item) => item.id));
    expect(entries.map(([slug]) => slug)).toContain("knowledge-operations");
    /*
      Foundation 424: correctness of the projection, not its size. The bounds are unchanged and
      govern the initial selection only; explicit region retention and page-mates may exceed them,
      so nothing here caps a count or compares the payload against a number.
    */
    expect(REGION_BOUND).toBe(12);
    expect(RELATION_BOUND).toBe(24);
    expect(shippedIds.size, "every shipped region id is unique").toBe(shipped.evidence.length);
    const fullNodeById = new Map(full.nodes.map((node) => [node.id, node] as const));
    for (const node of shipped.nodes) {
      const source = fullNodeById.get(node.id);
      expect(source, node.id).toBeDefined();
      // No shipped object points at a region the browser was not sent.
      for (const ref of node.evidenceRefs) expect(shippedIds.has(ref), `${node.id} ${ref}`).toBe(true);
      // REGION_BOUND still selects each shipped object's leading regions; retention only adds.
      for (const ref of source!.evidenceRefs.slice(0, REGION_BOUND)) {
        expect(node.evidenceRefs, `${node.id} ${ref}`).toContain(ref);
      }
    }
    // Initial selection alone, against the shipped model: explicit retention adds and never drops.
    const baseline = boundVisualWorld(full, layoutVisualWorld(full).placements.map((placement) => placement.id));
    const shippedNodeIds = new Set(shipped.nodes.map((node) => node.id));
    for (const item of baseline.evidence) expect(shippedIds.has(item.id), item.id).toBe(true);
    for (const node of baseline.nodes) expect(shippedNodeIds.has(node.id), node.id).toBe(true);
    // Diagnostics only: serialized UTF-8 byte counts, never the model content.
    const bytes = (value: VisualWorldModel) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    console.info(`[explore-model-bytes] baseline=${bytes(baseline)} corrected=${bytes(shipped)}`);
    for (const [slug, solution] of entries) {
      const { region, document } = solutionWorkflowEvidence(slug, solution.proof);
      const kept = shipped.evidence.filter((item) => item.id === region.id);
      expect(kept, slug).toHaveLength(1);
      expect(kept[0].id, slug).toBe(region.id);
      expect(kept[0].sourceId, slug).toBe(region.sourceId);
      expect(kept[0].sourceId, slug).toBe(document.documentId);
      expect(kept[0].page, slug).toBe(region.page);
      expect(kept[0].bbox1000, slug).toEqual([...region.bbox]);
      expect(kept[0].excerpt, slug).toBe(region.excerpt);
      expect(kept[0], slug).toEqual(full.evidence.find((item) => item.id === region.id));
      // The owner `boundVisualWorld` retains for a kept region, unchanged but for its shipped refs.
      const owner = full.nodes.find((node) => node.evidenceRefs.includes(region.id));
      expect(owner, slug).toBeDefined();
      const shippedOwner = shipped.nodes.find((node) => node.id === owner!.id);
      expect(shippedOwner, slug).toEqual({ ...owner!, evidenceRefs: owner!.evidenceRefs.filter((ref) => shippedIds.has(ref)) });
      expect(shippedOwner!.evidenceRefs, slug).toContain(region.id);
      // The owner the stage resolves `?evidence=` under (a Claim first) is shipped and holds it.
      const stageOwner = shipped.nodes.find((node) => node.kind === "Claim" && node.evidenceRefs.includes(region.id))
        ?? shipped.nodes.find((node) => node.evidenceRefs.includes(region.id));
      expect(stageOwner?.evidenceRefs, slug).toContain(region.id);
      // The source sheet draws the page, so every page-mate ships with the target.
      for (const mate of full.evidence.filter((item) => item.sourceId === region.sourceId && item.page === region.page)) {
        expect(shippedIds.has(mate.id), `${slug} ${mate.id}`).toBe(true);
      }
    }
  });

  it("takes retrieval locator fields and graph CSV bytes from existing emitted files", () => {
    const retrieval = solutionWorkflowEvidence("ai-ready-knowledge", SOLUTIONS["ai-ready-knowledge"].proof);
    const fields = JSON.parse(retrieval.preview!.content);
    const chunks = exploreSampleArtifact.package.files.find((file) => file.path === "rag/chunks.jsonl")!;
    const actual = chunks.content.trim().split("\n").map((line) => JSON.parse(line)).find((item) => item.chunkId === fields.chunkId);
    for (const [key, value] of Object.entries(fields)) expect(actual[key]).toEqual(value);
    expect(actual.text).toBe(retrieval.region.excerpt);
    const graph = solutionWorkflowEvidence("knowledge-graph", SOLUTIONS["knowledge-graph"].proof);
    const csv = exploreSampleArtifact.package.files.find((file) => file.path === graph.preview!.path)!;
    const [header, row] = graph.preview!.content.split("\n");
    expect(csv.content.startsWith(`${header}\n`)).toBe(true);
    expect(csv.content.split("\n")).toContain(row);
    expect(row).toContain(graph.region.id.split(":")[0]);
  });

  it("uses a supported question's returned locator, rather than the retired segment-sales question", () => {
    const proof = solutionWorkflowEvidence("source-grounded-assistants", SOLUTIONS["source-grounded-assistants"].proof);
    const answer = exploreSampleAnswers.find((item) => item.question === proof.question)!;
    expect(answer.status).toBe("grounded");
    expect(answer.citations.some((citation) => citation.sourceId === proof.region.sourceId
      && citation.pageNumber1 === proof.region.page
      && JSON.stringify(citation.bbox1000) === JSON.stringify(proof.region.bbox))).toBe(true);
    expect(proof.region.excerpt).toContain("Research and development");
    expect(proof.question).not.toContain("segment");
  });

  it("shows artifact validation without converting it into activation or scan accuracy", () => {
    const operations = solutionWorkflowEvidence("knowledge-operations", SOLUTIONS["knowledge-operations"].proof);
    const report = exploreSampleArtifact.package.files.find((file) => file.path === "validation/report.json")!;
    expect(operations.validation).toEqual(JSON.parse(report.content));
    expect(exploreSampleArtifact.lifecycle).toBe("candidate");
    expect(exploreSampleArtifact.candidatePromotion).toBe(false);
    const operationHtml = renderToStaticMarkup(createElement(SolutionWorkflowProof, { kind: "knowledge-operations", pick: SOLUTIONS["knowledge-operations"].proof }));
    expect(operationHtml).toContain("not a production activation receipt");
    const readHtml = renderToStaticMarkup(createElement(SolutionWorkflowProof, { kind: "document-intelligence", pick: SOLUTIONS["document-intelligence"].proof }));
    expect(readHtml).toContain("does not establish degraded-scan accuracy or recovered table grids");
  });

  it("links exported files to the existing compiled-world package section", () => {
    for (const kind of ["ai-ready-knowledge", "knowledge-graph"] as const) {
      const html = renderToStaticMarkup(createElement(SolutionWorkflowProof, { kind, pick: SOLUTIONS[kind].proof }));
      expect(html).toContain('href="/product/compiled-world#public-package-proof"');
      expect(html).not.toContain("/product/portable-artifacts");
    }
  });

  it("keeps Team contact-led without promising shared membership administration", async () => {
    const html = renderToStaticMarkup(await SolutionPage({ params: Promise.resolve({ slug: "knowledge-operations" }) }));
    expect(html).toContain("Team setup is arranged with us rather than bought at a checkout");
    expect(html).toContain("single-member workspace");
    expect(html).toContain("shared roles, invitations and organization administration are not available");
    expect(html).not.toContain("we provision the tenant and the roles with you");
  });

  it("fails visibly when a selected source passage is absent", () => {
    expect(() => solutionWorkflowEvidence("knowledge-graph", { form: "DEF 14A", match: /not-a-real-source-passage/, framing: "" })).toThrow("solution_workflow_region_missing");
  });
});
