import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/product" }));
import ProductPage from "@/app/product/page";
import HowItWorksPage, { metadata } from "@/app/how-it-works/page";
import HomeMeasurement from "@/components/landing-v2/home-measurement";
import { CUSTOMER_NAV } from "@/lib/site-navigation";
import { gdpPdfReport } from "@/lib/gdp-pdf-page-data";

describe("the public product story", () => {
  it("sends Product and How it works to distinct live pages", () => {
    expect(CUSTOMER_NAV.find(item => item.label === "Product")?.href).toBe("/product");
    expect(CUSTOMER_NAV.find(item => item.label === "How it works")?.href).toBe("/how-it-works");
    expect(metadata.alternates?.canonical).toBe("/how-it-works");
  });
  it("shows output and use on Product, a source process on How it works", () => {
    const product = renderToStaticMarkup(ProductPage());
    const process = renderToStaticMarkup(HowItWorksPage());
    expect(product).toContain("Open the evidence");
    expect(product).toContain("Use the World in your stack");
    expect(product).not.toContain('aria-label="The compilation process"');
    expect(process).toContain('aria-label="The compilation process"');
    expect(process).toContain("Read the document");
    expect(process).toContain("Bind the evidence");
    expect(process).not.toContain("A Compiled World, drawn from the published sample");
    expect(process).toContain("full-corpus compiles");
    expect(process).toContain("not a customer run receipt");
  });
  it.each([false, true])("keeps the GDP result, denominator and comparison boundary together (Korean=%s)", korean => {
    const html = renderToStaticMarkup(HomeMeasurement({ korean }));
    const report = gdpPdfReport();
    for (const arm of Object.values(report.arms)) {
      expect(html).toContain(`${arm.macro_all_pass_count}<span> / ${arm.n}</span>`);
    }
    expect(html).toContain("−4.0 pp");
    expect(html).not.toContain("pp pp");
    expect(html).toContain('href="/benchmarks/gdp-pdf"');
    expect(html).toContain(korean ? "결과를 개선하지 못했습니다" : "did not improve this run");
    expect(html).toContain(korean ? "경쟁사와 비교할 수 없습니다" : "cannot be compared");
  });
});
