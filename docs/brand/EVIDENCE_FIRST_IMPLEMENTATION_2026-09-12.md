# Evidence in Focus — implementation slice, 2026-09-12

Status: implementation candidate. Not a production release or completion of the entire master blueprint.

## Authority and scope

The user approved direct execution of the September 12 TAVONEL master blueprint. This branch is stacked on `agent/wg-completion-20260912`, starting at release-fix commit `84bf061`. It deliberately does not change billing, processing gates, production migrations, model routing, the locked film, or legal assertions.

## Implemented surfaces

- English home: “Give your AI knowledge you can check.” The supporting text describes the published sample, not unrestricted customer intake.
- Home proof: the existing `SolutionProofSample` is composed in the server page and passed as a React slot. It uses the same compiled claim, source region, corpus and digest as the existing solution pages. No invented illustration, generated screenshot, customer outcome, accuracy number or performance claim is introduced.
- Hero composition: readable statement and actual evidence side by side on wide screens; a single reading order on phones. The paper-coloured claim pane distinguishes the result from the dark product frame. Styles are scoped; existing status colours elsewhere remain unchanged.
- First jobs: technical support, AI applications, change review. Contract-signing language is removed from the opening customer segmentation.
- Korean entry: “AI가 쓰는 지식, 근거까지 확인하세요.” A public-sample action precedes the inquiry action, and the same real sample is present on the page. English reference destinations remain explicit.
- Workspace guide: setup is no longer labelled first task success; an activated World points the user toward a question, cited passage and actual use. Disclosure controls reference their rendered content.
- Motion: the scene-jump action respects reduced-motion preferences. Existing films and mobile canvas policy are retained.
- Search metadata: English home title and description describe inspectable knowledge and the published sample. Existing canonical and hreflang pair remain.

## Evidence boundary

The Apple SEC sample is a published artifact, not a new production customer journey. Showing it on another page does not establish Korean OCR quality, external-agent task completion, source-update reliability or preservation of all document structures. A graph, a downloaded ZIP, a completed compile and an activated World are not substitutes for final customer-task success.

The implementation does not make any current-customer-data gate more permissive. Existing commercial-state and authentication rules continue to determine access links. Research performance is not represented as production performance.

## Validation contract

1. TypeScript and ESLint using repository scripts.
2. Full unit suite using original test timeouts, including source provenance, route weight, pricing, security and copy contracts.
3. New `e2e/evidence-first.spec.ts`: actual sample composition, headline and panel dimensions, working evidence destination, Korean entry and no horizontal overflow.
4. Existing home, navigation, film, accessibility, consent, sources and workspace regression tests.
5. Desktop and mobile visual review; test builds use dummy public Supabase values and are never deployed as production artifacts.
6. Separate remote CI on the exact branch head; no administrative merge bypass.

A new assertion updates only the expressly approved hero wording and adds published-sample scope assertions. It does not suppress feature, provenance, security or accessibility checks. All test failures remain visible until resolved.

## Release dependency

PR #63 must satisfy `docs/runbooks/RELEASE_ORDER.md`: verified production preflight and four migrations before merge/deployment. This branch must not be used to smuggle the same unqualified release to production by another route.

The September 12 read-only preflight found a provider-linked active account in the billing projection, seven trialing accounts and no rows in the separate subscription table. This is not proof of zero paid customers or a successful payment. Verify authoritative billing history, allowance impact and a usable recovery point before financial-schema changes. No production mutation was made by this implementation slice.

## Still outside this slice

- Full Explore information-architecture replacement and all remaining page-by-page blueprint contracts.
- End-to-end customer intake through final grounded work, external API/MCP/package task completion and same-lineage V1/V2 update proof.
- Production backup/recovery verification, the four release migrations, production deployment and exact-SHA smoke receipts.
- Full asset register, new film production, Korean language expansion beyond the existing entry page.
- Search Console/GA4/Keyword Planner/Naver measurement, legal review, payment-operator identity and paid campaign launch.
- Fresh frozen routing/competitor benchmark and statistically supported leadership claims.

These remain gates or implementation tasks, not implicit successes. The final execution receipt must record actual command outcomes and commit IDs separately from this design description.
