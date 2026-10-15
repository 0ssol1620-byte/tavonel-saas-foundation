import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HeroStatement from "../components/landing-v2/hero-statement";
import { landingV2Copy } from "./landing-v2-copy";

/* Brief 2026-10-15, move 1: H1, then the one support sentence, then the actions and film. */
describe("HeroStatement", () => {
  it.each([false, true])("renders the support sentence right after the H1 and before children (korean: %s)", korean => {
    const copy = landingV2Copy(korean).hero;
    const html = renderToStaticMarkup(
      createElement(HeroStatement, { copy, titleId: "t" }, createElement("div", { "data-child": "1" })),
    );
    expect(html).toMatch(/<\/h1><p class="lv2-hero-support lv2-body-l">[^<]+<\/p><div data-child="1">/);
    expect(html.match(/lv2-hero-support/g)).toHaveLength(1);
  });
});
