import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const { default: MarketingConsent, CONSENT_REVEAL, MarketingConsentLink } = await import("../components/marketing-consent");

/*
  Release 2 (orchestrator decision, 2026-10-15): the first-time prompt is not on the first paint.
  The server render is that first paint, so it must hold no prompt and no reserved box; the card
  arrives after a 200px scroll or 8 s (e2e/marketing-consent.spec.ts drives that half).
*/
describe("MarketingConsent first paint", () => {
  it("server-renders no prompt on a measured page", () => {
    expect(renderToStaticMarkup(createElement(MarketingConsent))).toBe("");
  });

  it("reveals after a 200px scroll or 8 s, whichever comes first", () => {
    expect(CONSENT_REVEAL).toEqual({ scrollPx: 200, delayMs: 8000 });
  });

  it("puts the footer separator outside the link's pair, so a grid row can drop it", () => {
    const html = renderToStaticMarkup(createElement(MarketingConsentLink));
    expect(html).toMatch(/^<span class="site-footer-legal-sep" aria-hidden="true">·<\/span><span class="site-footer-legal-pair"><button/);
  });
});
