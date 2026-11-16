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
  it("renders the complete evaluation path in English (/ko/evaluation redirects with a 308)", () => {
    const html = renderToStaticMarkup(<EvaluationPage />);
    expect(html).toContain('lang="en"');
    expect(html).toContain('aria-labelledby="evaluation-request-title"');
    expect(html).toContain('<h2 id="evaluation-request-title">');
    expect(html).not.toContain('aria-label="Request a document evaluation"');
    expect(html).toContain("Tell us what you want to verify");
    expect(html).toContain("An inquiry does not start processing");
    expect(html).toContain('href="/pricing"');
    expect(html).not.toContain('href="/ko/');
    expect((html.match(/ required=""/g) ?? []).length).toBe(3);
  });
});
