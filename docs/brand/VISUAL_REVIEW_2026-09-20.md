# Visual review and refinement — 2026-09-20

Baseline: PR #71, `3e2d54c08fbf1ee6e835b3cc321b813d244f99a2`.
Scope: public website, English/Korean landing, shared chrome, source-evidence UI and a documentation accessibility defect. Customer-data activation, pricing logic, source records, original films and compiler authority are unchanged.

## Assessment

The baseline passed its automated release checks but retained composition defects: a viewport-height-dependent film width, competing headline faces, weak title hierarchy, excessive wide-screen margins and repeated light/dark section changes. Passing geometry and functional checks did not establish visual quality. The revised checks include minimum visual width and matching font synthesis, not just maximum bounds.

The public audit covered 58 HTML routes and an Atom feed at 1440 and 390 pixels. The feed is a non-HTML resource; it is validated by its MIME type and XML rather than HTML accessibility rules. The contact form's off-screen anti-spam honeypot is an intentional exclusion, not a layout defect.

## Findings and changes

| ID | Finding | Refinement |
|---|---|---|
| V01 | The 1296px shell leaves 312px outer margins at 1920px. | Shared 1600px maximum measure with fluid 20–64px gutters. |
| V02 | Public article and header edges use different containers. | Navigation, landing, public article grid and footer share the same measure. |
| V03 | The hero film shrinks with viewport height, down to 568px at 1440×900 under the old formula. | Width follows available horizontal space: 1120px, or 1280px on wide screens; original 16:10 frames remain intact. |
| V04 | H1 at 56px barely separates from 46px H2. | Responsive 64–76px desktop H1 with subordinate section headings. |
| V05 | The source phrase uses a separate italic face and an independent line box. | Upright sans, matching size, weight and synthesis; source-blue emphasis. |
| V06 | Headline line-height compresses glyphs; small WebKit viewports can add an unintended line. | More open line-height and a separately measured phone scale. |
| V07 | Accepted formats and the connected-source suffix wrap unnecessarily on desktop. | Wider statement measure; readable sans metadata. |
| V08 | Hero support can end with an isolated word. | Wider 780px reading measure without changing the approved copy. |
| V09 | The film disclaimer is a centered monospace paragraph. | Left-aligned sans caption at the film's own measure. |
| V10 | Four alternating paper sections interrupt the story. | Paper is reserved for actual proof and original evidence; explanatory sections use slate. |
| V11 | Minimum viewport heights add empty space to short scenes. | Content-driven scene heights and reduced, responsive padding. |
| V12 | The desktop 4:8 split constrains longer section headings. | A 5:7 split balances the headline and technical visual. |
| V13 | Evidence is visually loose and original-page previews are undersized. | A bounded proof panel, a wider original-page column and a source-blue selected tab. |
| V14 | Phone source objects stack into a long single-column sequence. | Two-column object overview, smaller source thumbnails and tighter connectors; no evidence is removed. |
| V15 | Small explanatory text and metadata have little hierarchy. | 15px secondary text, 13px landing metadata, 14px film labels and captions. |
| V16 | Neutral text is visually subdued against near-black surfaces. | A slate/blue-gray palette and brighter text, retaining separate semantic state colors and the 4.5:1 token contrast checks. |
| V17 | Small, widely spaced monospace branding weakens the header. | A 15px sans wordmark and more readable navigation and footer text. |
| V18 | The declared Korean fallback ships only Latin subsets. | Locally hosted unicode subsets from the existing Wanted Sans dependency, with its SIL OFL retained. Only used glyph ranges are fetched. |
| V19 | `/docs/concepts` has a horizontally scrollable figure unreachable by keyboard. | Focusable, named lifecycle figure with its complete text description preserved. |
| V20 | Existing visual tests only constrained maximum width and historical styling. | Added minimum film width, shared-edge, matching font/synthesis, font-asset and focusability regressions. |

## Release verification

Run the unit/type/lint and browser suites on the exact revision. The seven viewport projects, reduced-motion project, browser launch suites and accessibility audits remain release checks. Old hard-coded 760px/72px hero geometry is replaced by the revised design contract, not by skipped tests. The 44px touch floor, source fidelity, real data, keyboard behavior, four-cut player, reduced-motion and customer-data gates are retained.

A wide, uncropped product film necessarily makes the hero taller than the previous shrunken film. The 1440×900 hero is bounded at 1.6 viewports while its statement and at least the first third of its visual remain above the fold. This is a composition trade-off, not a claim that the whole page fits on one screen.

Production completion requires: exact-head CI green, normal protected-branch merge, Vercel production SHA equal to final main, and fresh production public smoke. Local and fixture evidence does not claim an authenticated customer upload/compile/billing transaction.

## Intentionally unchanged

Customer-data activation remains closed. Selective-recompilation authority and benchmark claims are not promoted. No original film or public-source asset is replaced; no source text, count or geometry is fabricated. No generated imagery, stock decoration, customer logo or invented testimonial is introduced.
