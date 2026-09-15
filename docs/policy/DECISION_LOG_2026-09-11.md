# Decision log — 2026-09-11 (delegated decisions)

## Provenance
On 2026-09-11, in the working session for the competitive-audit, website-growth and IA-redesign programs, the founder
delegated every pending founder decision in `CA_FOUNDER_QUEUE_2026-09-11.md` (FD-01 … FD-68) to the orchestrating agent,
with the instruction to judge each item itself, choose the best option and complete the work. The items below were
therefore decided by the orchestrator under that delegation. They are not the founder's own statements. Public and
internal copy must attribute them as "delegated decision, 2026-09-11 (orchestrator, under the founder's delegation)" and
never as "the founder decided". The founder may reverse any item; a reversal is a new entry here.

## Delegation record
The delegation exists only in the founder's working session; there is no earlier document, because the queue
(`CA_FOUNDER_QUEUE_2026-09-11.md`) was written before the founder answered it. The founder's message, verbatim (Korean),
sent on 2026-09-11 in session `https://claude.ai/code/session_016v6krJvJHLhZ9B85eJTYyZ`, as the third instruction of that
session after the competitive-audit and website-growth requests:

> D드라이브 TAVONEL_SITE_IA_NAVIGATION_REDESIGN_2026-09-11_KO.md와 아래 작업도 같이 진행해줘. 그리고 창업자 결정은 너에게
> 권한을 모두 승인할테니까 스스로 판단해서 최고의 선택을해서 모두 완료할 수 있도록하고 발행까지 모두 완료해.

Translation: "Also carry out the D-drive TAVONEL_SITE_IA_NAVIGATION_REDESIGN_2026-09-11_KO.md and the tasks below. And as
for the founder decisions, I approve all of the authority to you, so judge for yourself, make the best choice, complete
everything, and complete everything through to publication."

Ratification: the founder ratifies the decisions below by merging the pull request that carries this file, after reading
it. Until that merge, every public artefact that carries one of these values is labelled as a delegated decision pending
the founder's confirmation. Nothing in this log makes an agent's decision the founder's.

## Decisions (site-facing items implemented in the 2026-09-11 lanes)
| id | decision |
|---|---|
| FD-01 | Spreadsheet billable unit = page count of the sanitized PDF, counted after conversion; no byte-derived estimate. |
| FD-02 | Developer plan may promote/roll back a World when the caller is a workspace owner; Team keeps shared roles. Same bar for the retrieval-index rebuild. |
| FD-03 | Prices unchanged. Included pages belong to the billing month they are granted in: when the next month's pages are granted, whatever is left of the previous month expires (ledger row `allowance_expired`). Unused pages do not roll over and are not refunded on cancellation. The page states exactly what the code does; a stricter period-end promise needs a stored period boundary first. |
| FD-04 | Refund: full within 14 days of payment if under 10% of included pages consumed; otherwise none; unused pages not refunded on cancellation. |
| FD-06/07 | DPA v1 published as a draft "pending the founder's confirmation and legal review; not a signed agreement": breach notice ≤72 h after awareness; sub-processor changes 30 days' notice with right to object; deletion within 30 days of a verified request. Incident runbook states single operator, no on-call rotation. The queue's FD-06/07 rows carried no recommended numbers; these numbers are the delegated choice. |
| FD-09 | Support: acknowledgement within 1 business day (KST); no resolution-time commitment. |
| FD-10 | Repository licence: a LICENSE file stating all rights reserved (the default position of copyright law when no licence is granted), readable for evaluation, no reuse; package manifests say SEE LICENSE IN LICENSE, which removes the MIT field that contradicted the absence of a licence. The founder may replace it with any other licence. |
| FD-12 | Keep "no residency guarantee / no external pentest / no SOC 2"; add one roadmap sentence (pentest after first paying customer; SOC 2 timing not set). |
| FD-50 | Docs reviewed against code on 2026-09-11 (R9); four stale statements fixed; DOCS_REVIEWED = 2026-09-11. |
| FD-61 | robots.txt: search crawlers allowed; training crawlers disallowed: GPTBot, CCBot, ClaudeBot, anthropic-ai, Google-Extended, Applebot-Extended, Bytespider, Meta-ExternalAgent. User-triggered fetchers stay allowed. |
| FD-18/19/20/21 | The four decisions are implemented; FD-19 (retrieval refusal readable) reuses the existing failed-run row and needs no migration. New migration files on the release branch: exactly four — `20260911120000_compute_settlement_expired_terminal`, `20260911120100_oauth_reauthorization_audit_action`, `20260911120200_compile_job_candidate_manifest_digest`, and FD-03's `20260911130000_included_page_expiry_at_renewal`. CI-rehearsed; applied to production only with the release that ships them. |
| IA-1 | Five-item top navigation; Sources inside the Product panel and in the footer (supersedes the placement half of A-3/B-5); Security not a bar item; English labels; docs regrouped into five groups; one shared header. |
| FD-36 | K08 contradiction candidates: 0 of 23 real (R8). Contradiction records are not shown to customers until the rule binds dates and entities. |

## Not decided here
Payment credentials, secrets, third-party account access, customer-data consent, corpus rights and any spend beyond the
trial scale stay with the founder (FD-11, FD-28, FD-40, FD-56, FD-15, FD-55).

## Brand-audit decisions (BA, 2026-09-11 late evening) — same delegation
The premium-brand audit (`reports/brand-audit/BRAND_AUDIT_2026-09-11.md`, 258 findings) listed 37 items that remove a
voluntary limitation disclosure or change a number/label. Decided under the same delegation: every "public wording
removal" item is approved as the audit's recommended default — the limitation is not deleted from the site, it is stated
once on the trust, security, docs or pricing surface with what is provided leading. Exceptions and specifics: BA-001 the
landing hero binds to the real public corpus (fabricated figures removed); BA-032 sample objects badged "PUBLISHED SAMPLE";
BA-034 the object count is labelled with the engine that produced it, recompiling with the customer engine is a later run;
BA-078 locator model kept, status shown in the tiles; BA-119 intake gate becomes a footnote and candidate promotion is a
listed feature; BA-121 the pricing estimator must agree with the volume table; BA-142 contact response target = 1 business
day (KST); BA-250 no legal-entity line until the founder supplies one.

## Public wording of delegated values
On public pages the values above are not labelled with this log's vocabulary. Customer wording: a document under review is
"Draft v1 (2026-09-11) — under review; not a signed agreement"; a stated commitment carries no process label. The provenance
stays here. The founder's merge of the pull request that carries this file is the confirmation.
