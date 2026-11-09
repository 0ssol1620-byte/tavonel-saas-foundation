# P0 incident and cost alerts

## Envelope

All receivers consume `tavonel.operations_alert.v1`. Payloads contain a UUID, kind, severity, service, summary, observation time, HTTPS runbook link and deterministic dedupe key. Cost alerts also require current USD value and USD threshold. Credentials, raw document text and customer filenames are forbidden.

## Wired producers

| Producer | Path | Receiver |
| --- | --- | --- |
| Operational SLI breach (B35) | `/api/internal/sli-alerts`, every 5 minutes | `OPERATIONS_ALERT_WEBHOOK_URL` via `deliverOperationsAlert` |
| Production smoke failure | `.github/workflows/operations-smoke.yml` | `OPERATIONS_ALERT_WEBHOOK_URL` repository secret |
| Compile job settled `failed` (the durable queue's dead letter) | `lib/compile-job-worker.ts` → `alertCompileJobTurn`, on the one turn whose `failed` write the store accepted as a change | `OPERATIONS_ALERT_WEBHOOK_URL` via `deliverOperationsAlert` |
| Document blocked `DOCUMENT_NEVER_ARRIVED` (no upload within 15 minutes) | same, on the turn that first blocks it | same |
| OCR `OCR_TIMEOUT_OR_NETWORK` / `OCR_HTTP_UNAVAILABLE` / `OCR_RESPONSE_INVALID` | `/api/internal/billing/settle`, after the settlement is durable; the page states the settlement outcome the worker reported | same |
| Remote MCP 5xx spike (≥ 5% of ≥ 20 tool calls in 5 minutes, one instance; uncalibrated) | `/api/mcp`, after the response (`after()`), never in the tool call's latency | same |
| RunPod spend for the current billing day above `TAVONEL_RUNPOD_DAILY_COST_CAP_USD` (critical at 120%) | `/api/internal/sli-alerts`, hourly slot; reads RunPod `GET /v2/billing?bucketSize=day&lastN=2` with `TAVONEL_RUNPOD_API_KEY` and takes the bucket whose own day holds now | same |
| Daily OCR spend stop: RunPod spend for the billing day at or above `TAVONEL_RUNPOD_DAILY_HARD_STOP_USD` (critical, `kind: cost`), or the stop set and spend unreadable (critical, `OCR_SPEND_UNVERIFIED`) | `lib/compute-reservation.ts`, both reservation paths, through `ocrSpendStop` (one RunPod billing read per instance per minute); new reservations answer 503 `OCR_DAILY_SPEND_STOP` / `OCR_SPEND_UNVERIFIED`, already-admitted work finishes | same |
| Compile backlog age: oldest runnable compile job unmoved for more than 15 minutes (warning) or 60 (critical), or the queue unreadable (`compile_backlog_unavailable`, warning) | `/api/internal/sli-alerts`, every slot, as reasons of the B35 SLI breach | same |
| A scheduled check that cannot run: cap set but no key or unreadable billing; release revision unknown or release store unreadable (warning) | the same two checks, paged once a day from the 00:00 UTC slot | same |
| Production `direct_upload` release row within 7 days of its 30-day life, or lapsed (critical) | `/api/internal/sli-alerts`, 00:00 UTC slot | same |

All of them go through `deliverOperationsAlert` and its 5-minute same-instance dedupe; `alertId` is derived from the trigger, so a receiver can drop repeats by it. With the webhook unset each one returns `ALERT_RECEIVER_UNCONFIGURED` and is counted. Every distinct alert (its `dedupeKey`) is logged to stderr, so one alert never hides another; only the same alert repeating is held to one line per process per hour, with `unconfiguredSinceLastLog` — visible, not fatal. With `TAVONEL_RUNPOD_DAILY_HARD_STOP_USD` unset (or zero, or not a number) nothing is ever refused for spend, which is the behaviour before 2026-11-10; deleting the variable is the rollback. Set it above the alert cap, so the cap pages before the stop refuses. The stop lifts by itself when RunPod's next billing day opens; to lift it sooner, raise or delete the variable and redeploy. With the cost cap unset the cost check reports `RUNPOD_COST_CAP_UNCONFIGURED` in the route's `watch` field and pages nobody.

Not wired: the Cloudflare queue `foundation-quarantine-dead-letter` has no consumer. A message that exhausts `max_retries` there is still silent; an OCR transport failure is recorded (and paged) at attempt 3 before it can get there.

End-to-end timing: the first remote MCP `search_world`/`ask_world` answer from an active World writes one internal receipt to `foundation_operations_receipts`, kind `e2e_timing` (`tavonel.e2e_timing.v1`: upload confirmed → ready → activated → first answer, seconds per hop, null where a record is missing), through the service_role-only `record_foundation_operations_receipt`. It is not in `enterprise_audit_events`, so a customer's audit export never carries it. Read it with `select * from public.foundation_operations_receipts where receipt_kind = 'e2e_timing' order by recorded_at desc` in the SQL editor.

A routing row below with no producer above is defined, not sent.

## Minimum routing

| Trigger                                       | Severity | Initial owner    | Escalation                             |
| --------------------------------------------- | -------- | ---------------- | -------------------------------------- |
| Public readiness false for 5 minutes          | critical | web on-call      | founder after 15 minutes               |
| CDR or RunPod terminal failure ratio above 5% | critical | pipeline on-call | disable intake if sustained 15 minutes |
| Queue oldest age above 10 minutes             | warning  | pipeline on-call | critical at 30 minutes                 |
| Billing webhook failures                      | critical | billing on-call  | suspend entitlement mutation           |
| Daily provider cost above budget              | warning  | founder          | critical at 120%                       |
| Monthly forecast above budget                 | warning  | founder          | review GPU concurrency and intake caps |

## Response

1. Acknowledge the alert and open an incident ID without customer content.
2. Follow the linked runbook and preserve timestamps, deployment IDs and provider request IDs.
3. For data integrity or tenant-isolation risk, disable affected writes before diagnosis.
4. Release credits for terminal failures through the credit-release runbook.
5. Resolve only after the triggering metric recovers and a synthetic check succeeds.
6. Retain the alert payload, acknowledgements, actions, recovery evidence and follow-up owner.

Creating an alert envelope is not evidence that Vercel, Cloudflare, Supabase or RunPod receiver configuration is live. Each receiver needs a real canary and acknowledgement receipt.
