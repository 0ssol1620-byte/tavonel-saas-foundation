# Decision log — 2026-09-16 (delegated decisions, site review + #1 strategy)

## Provenance
On 2026-09-16 (KST, shortly after midnight) the founder asked the orchestrating agent to complete the full-site review plan
(`D:\TAVONEL_FULL_SITE_REVIEW_AND_NO1_STRATEGY_2026-09-15_KO.md`, 144 findings) together with
`TAVONEL_MASTERPLAN_BLUEPRINT_HANDOFF_2026-09-15_KO.md`, and delegated every founder decision the plan listed.
The founder's message, verbatim (Korean), session `https://claude.ai/code/session_01R51sC91W9Ed9hqyHVkjE19`:

> 그럼 너가 기획한거랑 첨부파일 같이 확인해서 모두 완료할 수 있도록해줘. 필요한 모든 창업자 결정은 모두 승인할테니까
> 너가 판단해서 가장 적합한 결정내려줘.

Translation: "Then check what you planned together with the attachment and complete all of it. I approve all the founder
decisions that are needed, so judge for yourself and make the most appropriate decision."

The items below were decided by the orchestrator under that delegation. Public copy attributes them as
"delegated decision, 2026-09-16 (orchestrator, under the founder's delegation)" using the customer wording rule from
`DECISION_LOG_2026-09-11.md` ("Draft v1 — under review"); never as "the founder decided". Ratification is by the founder
merging the pull request that carries this file. A reversal is a new entry here.

## Decisions
| id | decision | why |
|---|---|---|
| SD-01 | **`customerData` stays closed in this release.** The gate is not a flag; `docs/CUSTOMER_DATA_GATE_2026-09-06.md` names 17 preconditions of which 7 are MISSING (signed compile receipts, tombstones, export/delete routes, provider isolation, ACL capture, at-rest verification, founder receipt) and the RLS suite has never executed against Postgres. Approving a decision does not make that work exist. The site sells honestly instead: one primary CTA everywhere derived from `/api/status`, a visible state line ("Your own files: arranged with us · Public World: open now"), and `/pricing` separates plans that can be paid today from plans that start with a conversation. Opening the gate is scheduled as its own release after the 16 engineering rows are closed; row 17 (the founder receipt) is the founder's own act. | Fail-closed on customer data is a constitution rule; a marketing promise cannot precede it. |
| SD-02 | **Team plan is not sold as "shared membership and roles" until membership exists.** Team is redefined on the pricing surface as the higher-volume plan (2,500 pages, review queue, version history, onboarding session) for a single-member workspace, with "shared members and roles" listed under "Coming, not yet sold". Price unchanged ($99). | `/security` states the workspace has exactly one member; the plan text contradicted it. |
| SD-03 | **The enterprise pricing PDF (`/legal/TAVONEL_ENTERPRISE_PRICING_2026-08-30.pdf`) is unlinked and removed from `public/`.** Enterprise pricing lives on `/enterprise` in HTML using the site's vocabulary (standard/complex pages, no credit packs). The file is preserved in git history only. | It said "live paid sales not open" and "business registration pending" beside a live checkout and a published registration number. |
| SD-04 | **No Arena number is published as a benchmark result in this release.** `/benchmarks` keeps the protocol and gains a dated "What exists today" block pointing to research notes whose receipts are downloadable with full sha256. Internal Model Arena snapshots stay internal until the exact-version rerun the handoff §23 requires. | Handoff §20/§23 and the constitution's claims rules. |
| SD-05 | **AI crawler policy:** training crawlers stay disallowed (GPTBot, CCBot, Google-Extended, Applebot-Extended, Bytespider, Meta-ExternalAgent, anthropic-ai). **ClaudeBot moves from `Disallow: /` to the same allow-list as OAI-SearchBot and PerplexityBot** because it is a fetch-time agent, not a training crawler. `llms.txt` is updated to state this policy instead of "unresolved". Supersedes the ClaudeBot half of FD-61. | Answer-engine citation is the category's discovery path; training opt-out is preserved. |
| SD-06 | **Public repository posture:** the production monorepo remains where it is (moving it is the founder's account action). The site gains a footer "GitHub" link only to the distribution files and recipe scripts once they are published in a separate public repository; until then the "WHERE TO CHECK IT" rows cite `/developer/channel.json` digests and the public files, not internal source paths. | Internal paths on a public page are a verification ritual nobody can perform. |
| SD-07 | **Legal texts:** `/terms` gains governing law = Republic of Korea, exclusive jurisdiction = Seoul Central District Court, limitation of liability = fees paid in the preceding 12 months, warranty disclaimer, indemnity, 30-day notice of material changes, auto-renewal and price-change notice; `/refunds` keeps FD-04 as the single rule (full refund within 14 days if under 10% of included pages consumed) and deletes the unconditional sentence; `/privacy` names PIPA (Korea) and GDPR/UK GDPR, legal bases per purpose, the supervisory-authority route, a cookie table, and no children's data. All carry "Draft v1 — under review" until a lawyer signs off; the founder's counsel review is still required and is recorded as pending. | Live paid subscriptions without governing law or liability terms expose both sides. |
| SD-08 | **Currency:** every price shows "USD" beside it and "excl. tax" once per surface; no KRW pricing is introduced (Paddle settles in USD). Korean pages state "미국 달러(USD) 기준, 세금 별도". | Paddle is the merchant of record; a second currency without a settlement path is a false promise. |
| SD-09 | **SOC 2:** no start date is announced. `/trust` and `/enterprise` say "not started; scheduled after the first paying customer, alongside the external penetration test" (FD-12 wording extended). | No engagement exists. |
| SD-10 | **Customer quotes:** none exist, none are fabricated. Solutions and home carry a "Design partners" block describing what a design partner receives. | Constitution: no claim without a source. |
| SD-11 | **Processing regions are disclosed** on `/security` and `/subprocessors`: Vercel (icn1 Seoul edge, hnd1 Tokyo functions), Supabase (as configured), Cloudflare R2 (APAC), Google Cloud Run asia-northeast3 (Seoul) for CDR, RunPod GPU OCR (region as configured by the endpoint; if not pinned to one region, the page says so). Values are read from configuration, not typed. | A buyer cannot assess residency without it. |
| SD-12 | **Stack release order is unchanged** (#64 → #65 → #66 → this campaign's PR). This campaign's branch is based on the #66 head merged with `main`, so it lands only after the stack. The orchestrator does not bypass the stack. | Handoff §B5. |
| SD-13 | **Router (P0-B) and Arena rerun (P0-C benchmark)** are not executed in this campaign: both require paid GPU runs, frozen holdouts and external adjudication that do not fit a website campaign, and the handoff's $500 hard cap applies. The non-paid prerequisites (portfolio pin inventory) are left to the research repository. | Spend without a measured plan is a stop-the-line item. |

## Not decided here
Google Search Console / Bing / Naver property verification (needs the founder's Google account), npm/PyPI publishing
(needs registry credentials), moving the production repository, signing the DPA, recording the customer-data founder
receipt (precondition 17), and any GPU spend stay with the founder.
