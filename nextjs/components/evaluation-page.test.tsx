import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EvaluationPage from "./evaluation-page";
vi.mock("@/components/public-site-chrome", () => ({PublicSiteHeader: () => <header />, PublicSiteFooter: () => <footer />}));
describe("bounded evaluation funnel", () => {
  it("keeps only three required fields and discloses the processing boundary", () => {
    const html = renderToStaticMarkup(<EvaluationPage />);
    expect((html.match(/ required=""/g) ?? []).length).toBe(3);
    expect(html).toContain("An inquiry does not start processing");
    expect(html).toContain("Do not attach or paste customer documents here");
    expect(html).toContain("rather than enabled by a plan purchase");
  });
  it("localizes the complete evaluation path for Korean readers", () => {
    const html = renderToStaticMarkup(<EvaluationPage korean />);
    expect(html).toContain('lang="ko"');
    expect(html).toContain('aria-labelledby="evaluation-request-title"');
    expect(html).toContain('<h2 id="evaluation-request-title">');
    expect(html).not.toContain('aria-label="Request a document evaluation"');
    expect(html).toContain("무엇을 검증하고 싶으신가요?");
    expect(html).toContain("문의를 보내도 자료 처리");
    expect(html).toContain('href="/ko/pricing"');
    expect((html.match(/ required=""/g) ?? []).length).toBe(3);
  });
});
