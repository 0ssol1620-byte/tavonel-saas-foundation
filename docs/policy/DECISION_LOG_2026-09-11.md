# Decision log — 2026-09-11 (delegated decisions)

## Provenance
On 2026-09-11, in the working session for the competitive-audit, website-growth and IA-redesign programs, the founder
delegated every pending founder decision in `CA_FOUNDER_QUEUE_2026-09-11.md` (FD-01 … FD-68) to the orchestrating agent,
with the instruction to judge each item itself, choose the best option and complete the work. The items below were
therefore decided by the orchestrator under that delegation. They are not the founder's own statements. Public and
internal copy must attribute them as "delegated decision, 2026-09-11 (orchestrator, under the founder's delegation)" and
never as "the founder decided". The founder may reverse any item; a reversal is a new entry here.

## Decisions (site-facing items implemented in the 2026-09-11 lanes)
| id | decision |
|---|---|
| FD-01 | Spreadsheet billable unit = page count of the sanitized PDF, counted after conversion; no byte-derived estimate. |
| FD-02 | Developer plan may promote/roll back a World when the caller is a workspace owner; Team keeps shared roles. Same bar for the retrieval-index rebuild. |
| FD-03 | Prices unchanged. Unused included pages expire at the end of the billing month (no rollover); overage at the published rate. Ledger enforcement of the expiry is a separate item (LEDGER-EXPIRY) and the copy is held to the code until it lands. |
| FD-04 | Refund: full within 14 days of payment if under 10% of included pages consumed; otherwise none; unused pages not refunded on cancellation. |
| FD-06/07 | DPA v1 published as a draft "pending legal review; not a signed agreement": breach notice ≤72 h after awareness; sub-processor changes 30 days' notice with right to object; deletion within 30 days of a verified request. Incident runbook states single operator, no on-call rotation. |
| FD-09 | Support: acknowledgement within 1 business day (KST); no resolution-time commitment. |
| FD-10 | Repository licence: proprietary, all rights reserved, readable for evaluation, no reuse; package manifests say SEE LICENSE IN LICENSE. |
| FD-12 | Keep "no residency guarantee / no external pentest / no SOC 2"; add one roadmap sentence (pentest after first paying customer; SOC 2 timing not set). |
| FD-50 | Docs reviewed against code on 2026-09-11 (R9); four stale statements fixed; DOCS_REVIEWED = 2026-09-11. |
| FD-61 | robots.txt: search crawlers allowed; training crawlers disallowed: GPTBot, CCBot, ClaudeBot, anthropic-ai, Google-Extended, Applebot-Extended, Bytespider, Meta-ExternalAgent. User-triggered fetchers stay allowed. |
| FD-18/19/20/21 | The four migrations (settlement `expired` terminal; retrieval refusal readable; compile-job manifest digest; audit action check) are written and CI-rehearsed; applied to production only with the release that ships them. |
| IA-1 | Five-item top navigation; Sources inside the Product panel and in the footer (supersedes the placement half of A-3/B-5); Security not a bar item; English labels; docs regrouped into five groups; one shared header. |
| FD-36 | K08 contradiction candidates: 0 of 23 real (R8). Contradiction records are not shown to customers until the rule binds dates and entities. |

## Not decided here
Payment credentials, secrets, third-party account access, customer-data consent, corpus rights and any spend beyond the
trial scale stay with the founder (FD-11, FD-28, FD-40, FD-56, FD-15, FD-55).
