# Competitive audit closure — 2026-09-27

This is an implementation receipt for the 2026-09-23 audit atlas at `D:\CodexProjects\ai-knowledge-compiler\outputs\site-audit-20260923\AUDIT_ATLAS.html`, not a replacement for its 63-item issue register. That crawl discovered 528 URLs: 74 on tavonel.com, 272 on reducto.ai, 177 on docs.reducto.ai, and five other Reducto or peer endpoints. It covered discovered public pages, not authenticated competitor products or every possible URL. The atlas remains the route-by-route evidence record; its conclusions are dated to that crawl.

Reducto's [live homepage](https://reducto.ai/) was checked again on 2026-09-27. It now leads with r-1, a free Studio trial, named customer logos, industry routes, an API snippet, and an advertised 1¢/page preview price. Those are Reducto's own published claims, not independently reproduced product results. Our corresponding path must lead with a usable public World and source-level proof, then explain the current route to using one's own data before asking for money. We do not assert a parsing-speed, cost, or accuracy win over Reducto without an equivalent test and receipt.

## Buyer path implemented in this branch

1. `/` and `/ko`: a centered brand claim, a direct public source specimen, then “How it compiles.” The specimen's Explore link now uses the compiled World's evidence ID for the same OCR source region; the previous link opened an unrelated default filing.
2. `/explore`: the public, compiled sample is available without purchase. Sample and illustration labels remain visible. A custom-source compile is still gated.
3. `/benchmarks`: the two published GDP.pdf arms are distinguished from the two unrun arms. `/arena` points to the already-published document-reader board and does not call it unpublished.
4. `/pricing` and `/ko/pricing`: plan selection goes to a plan-specific inquiry when checkout or own-source intake is closed. Korean visitors can reach the inquiry in Korean. The priced plans distinguish plan entitlements from currently enabled access, and direct own-source prospects to an approved pilot. The Team card does not imply multi-user access.
5. `/contact` and `/ko/contact`: selected plan context is preserved through the form and validated by the API. The privacy page discloses that the chosen plan is included with an inquiry.
6. `/status`: configuration is called “configured,” and a closed customer-data gate keeps the document pipeline “closed.” Configuration is not presented as a measured successful request.
7. `/privacy` and `/subprocessors`: the inquiry processor disclosure names the selected plan sent to Resend. The international-transfer paragraph now describes the DPA and SCC terms as a draft rather than as an executed agreement. The shared legal last-updated date records this revision.

Film Cut 4 was re-recorded from the edited code-based canvas in a production build: 450 frames at 25 fps, 2880×1800 capture, 18 seconds, x264 yuv444p. The locked MP4 is 614,533 bytes, SHA-256 `480c7479ca2a7f3ab73291016c4d64c20bee6e6967f43444bde44e117e0cf732`; its 1440×900 poster is SHA-256 `0657974791412db006d80e36171f45175508fa54421fd852489771d7f4e70208`. The visible MCP and CLI commands were checked against the shipped nine-tool distribution. The film is an illustrative flow, not a customer outcome or model-performance receipt.

## Evidence and limits

- `pnpm build`: brand asset check, type floor, TypeScript, ESLint, hermetic Vitest (369 files, 5,261 tests), and optimized Next build passed.
- The landing and benchmark browser sweep first ran 264 cases across 1920, 1440, 1280, 1024, 768, 390, 360, and reduced motion. It exposed one common source-link defect in eight cases. The eight corrected cases passed on a rebuilt production server. A 63-capture route/width pass and the local Lighthouse result are recorded in `VISUAL_QA_REPORT.md`; this branch adds the Korean Pricing and Contact routes to the enforced Lighthouse budget for exact-head CI.
- A logged-in buyer, paid checkout, real custom-data intake, GPU processing, and legal review are separate acceptance gates. No test here turns a public sample into evidence that those gated flows are available.
- The 63 atlas findings are not all closed. In particular, the legal effect of draft terms, privacy retention decisions, manual accessibility review, field performance, buyer comprehension study, and founder visual review require their own evidence. The atlas remains the open backlog for them; this branch closes the specific contradictions and links described above.

## Release decision

The founder explicitly authorized publication on 2026-09-27. The public marketing and proof path can be published after the final exact-head checks and production smoke. That authorization does not turn on paid checkout or customer-source processing: the production V2 status contract currently reports both actions closed. The draft legal documents remain visibly marked as unreviewed; counsel and customer-specific transfer terms remain separate gates. The compiler/router PR has its own merge and canary gates and is not part of this website publication.
