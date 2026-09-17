# Evidence in Focus — implementation slice, 2026-09-12

Status: implementation candidate. Not a production release or completion of the entire master blueprint.

## Authority and scope

The user approved direct execution of the September 12 TAVONEL master blueprint. This branch is stacked on `agent/wg-completion-20260912`, starting at release-fix commit `84bf061`. It deliberately does not change billing, processing gates, production migrations, model routing, the locked film, or legal assertions.

## Implemented surfaces

- English home: “Give your AI knowledge you can check.” The supporting text describes the published sample, not unrestricted customer intake.
- Home proof: `SolutionProofSample` is composed in the server page and passed as a React slot. It displays an excerpt of the actual highlighted source region, with the same corpus, locator and digest used by Explore. No invented illustration, generated screenshot, customer outcome, accuracy number or performance claim is introduced.
- Hero composition: readable statement and source evidence side by side on wide screens; a single reading order on phones. A paper-coloured passage pane distinguishes the original text from the dark product frame. Styles are scoped; existing status colours elsewhere remain unchanged.
- First jobs: technical support, AI applications, change review. Contract-signing language is removed from the opening customer segmentation.
- Korean entry: “AI가 쓰는 지식, 근거까지 확인하세요.” A public-sample action precedes the inquiry action, and the same real sample is present on the page. English reference destinations remain explicit.
- Workspace guide: setup is no longer labelled first task success; an activated World points the user toward a question, cited passage and actual use. Disclosure controls reference their rendered content.
- Motion: the scene-jump action respects reduced-motion preferences. Existing films and mobile canvas policy are retained.
- Search and sharing metadata: English home title, description, Open Graph and Twitter text describe inspectable knowledge and the published sample. Existing canonical and hreflang pair remain. Unsupported code-repository ingestion was removed from Organization and SoftwareApplication structured-data descriptions.

## Evidence boundary and discovered defect

The Apple SEC sample is a published artifact, not a new production customer journey. Showing it on another page does not establish Korean OCR quality, external-agent task completion, source-update reliability or preservation of all document structures. A graph, a downloaded ZIP, a completed compile and an activated World are not substitutes for final customer-task success.

Actual preview inspection found that the old shared proof component selected a document-heading Claim through `evidenceRefs`, while its highlighted source region described the company business. An ID association alone did not establish textual support. The UI now quotes the selected region directly and explicitly labels it `Source passage`. The DOM binds that excerpt to the highlighted region ID. This corrects the public presentation; it does not repair or qualify claim-level bindings in the compiled artifact. A deeper binding audit remains required before promoting that artifact as verified claim-level evidence.

The implementation does not make any current-customer-data gate more permissive. Existing commercial-state and authentication rules continue to determine access links. Research performance is not represented as production performance.

## Validation contract

1. TypeScript and ESLint using repository scripts.
2. Full unit suite using original test timeouts, including source provenance, route weight, pricing, security and copy contracts.
3. New `e2e/evidence-first.spec.ts`: actual sample composition, exact source-region ID and displayed-passage correspondence, headline and panel dimensions, working evidence destination, Korean entry and no horizontal overflow.
4. Existing home, navigation, film, accessibility, consent, sources and workspace regression tests.
5. Desktop and mobile visual review; test builds use dummy public Supabase values and are never deployed as production artifacts.
6. Separate remote CI on the exact branch head; no administrative merge bypass.

The revised hero and Korean action assertions reflect the expressly approved blueprint. Source-passage assertions add provenance checks instead of treating an arbitrary referenced Claim as verified. Feature, privacy, security, locale and accessibility checks remain enabled. All failures remain visible until resolved.

## Release dependency

PR #63 must satisfy `docs/runbooks/RELEASE_ORDER.md`: verified production preflight and four migrations before merge/deployment. This branch must not be used to release the same unqualified production changes by another route.

Read-only production preflight is not a recovery guarantee. Verify authoritative billing history, allowance impact and a usable recovery point before financial-schema changes; do not infer zero customers from a stale document or an empty secondary table. No production mutation was made by this implementation slice. Operational account details belong in the private execution receipt, not public brand documentation.

## Still outside this slice

- Full Explore information-architecture replacement and all remaining page-by-page blueprint contracts.
- Claim-level support audit of the compiled sample and current customer output.
- End-to-end customer intake through final grounded work, external API/MCP/package task completion and same-lineage V1/V2 update proof.
- Production backup/recovery verification, the four release migrations, production deployment and exact-SHA smoke receipts.
- Full asset register, new film production, Korean language expansion beyond the existing entry page.
- Search Console/GA4/Keyword Planner/Naver measurement, legal review, payment-operator identity and paid campaign launch.
- Fresh frozen routing/competitor benchmark and statistically supported leadership claims.

These remain gates or implementation tasks, not implicit successes. The final execution receipt must record actual command outcomes and commit IDs separately from this design description.
