# Premium product craft — 2026-09-09

Scope: typography, hierarchy, actual control geometry and pricing presentation. No new product capability, price, entitlement, customer-data activation, corpus result or generated product illustration.

## Research translated into the implementation

The official Linear design review (https://linear.app/now/behind-the-latest-design-refresh) argues for a calmer hierarchy, consistent alignment and less competing interface chrome. This change applies those principles to existing TAVONEL product and evidence surfaces rather than copying that product's layout or assets.

W3C target-size guidance distinguishes the 24 CSS pixel AA minimum and its exceptions from larger ergonomic targets (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Primary TAVONEL actions retain a 44px internal target; scene ticks stay visually 6px while their actual area is 30x44. This is not a blanket WCAG conformity claim.

## Actual changes

- Narrative document titles: fluid 34–64px, balanced line wrapping and stronger hierarchy. Technical body/receipt text is not enlarged indiscriminately.
- Primary buttons: readable sans-serif treatment, minimum 44px height, bounded width and text wrapping. The long Evidence link no longer forces horizontal document overflow.
- Header: 11.5px minimum phone action label instead of 9.5px. Short action layout and exact viewport bounds are tested; no price/capability copy change.
- Scene controls: existing coarse-pointer hit-target treatment also applies at narrow widths with a fine pointer. The earlier audit had observed only the latter; coarse-pointer support was not absent.
- Docs Copy: 44px actual control, not a tiny label requiring precise pointer placement.
- Pricing: the same four catalog-backed plan choices now precede the six detailed usage explanations. All seventeen FAQ answers and original commercial conditions are preserved. The FAQ heading is customer-facing rather than an internal purchase-objection label.
- Pricing surfaces: differentiated plan hierarchy, tabular price numerals, quieter detail sections and improved mobile spacing. No dependency or decorative 3D asset added.

## Evidence actually obtained

- Existing TypeScript + ESLint check passed.
- Production Next build completed with live commercial presentation; local HTTP is used only for the loopback test server.
- New premium-craft tests plus existing mobile/Explore-entry regressions: 78 passed, 90 conditional exclusions, zero failures across the existing viewport/reduced-motion projects.
- Independent geometry sweep: 24 public route types x 360/390/768/1440 = 96 renderings; no horizontal overflow or unhandled page exception.
- First pricing plan starts at y=470.19px in the 390x900 test viewport (496.58 at 360, 371.81 at 768, 447.41 at 1440). These are controlled local measurements, not user conversion statistics.
- Actual browser contact sheet: premium-craft-browser-preview-20260909.webp. It is composed from saved production-build screenshots, not a speculative/generated design image.

## Non-green local evidence retained

The first full local unit run had 2362 passing tests and three unchanged-timeout failures, plus the local secret-scan test module failing to load. Re-running the three affected suites with one worker passed all 49 tests. The scanner import error also reproduced under explicitly selected Node 22; changing the Node version alone did not resolve it. No test was deleted, disabled or loosened. Direct scanner execution and exact-head clean CI are separate required release checks. The local unit suite is not described as wholly green.

## Release boundaries

This is not a claim that every pixel of every authenticated Workspace state has been reviewed, that conversion improved, or that the full premium redesign is finished. The existing graph/landing film, source corpus and evidence semantics are preserved. Detailed signed-in flows and content curation remain separate work.

Release only through exact-head required CI, existing Lighthouse budgets and normal protected merge. A preview or passing local geometry test is not a production deployment receipt.
