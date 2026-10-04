import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HeroSourceCard from "./hero-source-card";
import { buildHeroView } from "@/lib/landing-v2-runtime";
describe("artifact-bound landing evidence", () => {
  it("uses the committed image, excerpt, and deep link without an autoplay film", () => {
    const view = buildHeroView();
    const html = renderToStaticMarkup(<HeroSourceCard />);
    expect(html).toContain(view.image!.src);
    expect(html).toContain(view.source.filename);
    expect(html).toContain("data-derived");
    expect(html).toContain("Inspect this evidence");
    expect(html).not.toMatch(/<video|<canvas|autoplay/i);
  });
  it("localizes its interface without translating or changing the source", () => {
    const html = renderToStaticMarkup(<HeroSourceCard korean />);
    expect(html).toContain("이 근거 확인하기");
    expect(html).toContain(buildHeroView().source.filename);
  });
});
