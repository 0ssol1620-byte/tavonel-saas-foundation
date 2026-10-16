import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const { default: MarketingConsent, CONSENT_REVEAL, MarketingConsentLink, homeSheetClear } = await import("../components/marketing-consent");

/*
  Fix round 4 (M3). The Home phone sheet (a 104px zone at the foot of the screen) keeps clear of the
  frame and the reading line together. Rects are the measured 2c7fba3 first screens
  (redesign-r3-20261015 critic3/phone.json): at 430x932 EN the frame was 545-795 and the line under
  it 807-852, so the frame alone said "clear" while the sheet (829-924) covered the line.
*/
describe("Home phone consent sheet zone", () => {
  it("counts the reading line, not only the frame", () => {
    const frame430 = { top: 545, bottom: 795 }, line430 = { top: 807, bottom: 852 };
    expect(homeSheetClear([frame430], 932)).toBe(true);
    expect(homeSheetClear([frame430, line430], 932)).toBe(false);
  });

  it("holds the region from the higher top to the lower bottom, in either order", () => {
    // Line above the frame (phone Fit after fix round 4), 390x844: the frame's foot decides.
    expect(homeSheetClear([{ top: 596, bottom: 822 }, { top: 521, bottom: 588 }], 844)).toBe(false);
    expect(homeSheetClear([{ top: 296, bottom: 522 }, { top: 221, bottom: 288 }], 844)).toBe(true);
    // The line still on screen keeps the sheet waiting; both below the screen, or the zone edge.
    expect(homeSheetClear([{ top: 900, bottom: 1100 }, { top: 830, bottom: 890 }], 844)).toBe(false);
    expect(homeSheetClear([{ top: 950, bottom: 1100 }, { top: 860, bottom: 890 }], 844)).toBe(true);
    expect(homeSheetClear([{ top: 500, bottom: 740 }], 844)).toBe(true);
    expect(homeSheetClear([{ top: 500, bottom: 741 }], 844)).toBe(false);
    expect(homeSheetClear([], 844)).toBe(true);
  });
});

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
