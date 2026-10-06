import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SolutionsPage from "../app/solutions/page";
import SolutionPage, { SOLUTIONS } from "../app/solutions/[slug]/page";
import SolutionWorkflowProof, { solutionWorkflowEvidence } from "../app/solutions/solution-workflow-proof";
import { exploreSampleArtifact, exploreSampleAnswers, exploreSampleWorld } from "./explore-sample";

// This suite owns Solutions composition and evidence, rather than commercial state or chrome.
vi.mock("@/components/public-page-shell", () => ({
  PublicPageShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("@/components/public-primary-cta", () => ({ default: () => null }));

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
