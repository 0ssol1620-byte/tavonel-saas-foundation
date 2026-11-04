# P0 incident and cost alerts

## Envelope

All receivers consume `tavonel.operations_alert.v1`. Payloads contain a UUID, kind, severity, service, summary, observation time, HTTPS runbook link and deterministic dedupe key. Cost alerts also require current USD value and USD threshold. Credentials, raw document text and customer filenames are forbidden.

## Wired producers

| Producer | Path | Receiver |
| --- | --- | --- |
| Operational SLI breach (B35) | `/api/internal/sli-alerts`, every 5 minutes | `OPERATIONS_ALERT_WEBHOOK_URL` via `deliverOperationsAlert` |
| Production smoke failure | `.github/workflows/operations-smoke.yml` | `OPERATIONS_ALERT_WEBHOOK_URL` repository secret |
| Compile job settled `failed` (the durable queue's dead letter) | `lib/compile-job-worker.ts` → `alertCompileJobTurn`, every worker turn | `OPERATIONS_ALERT_WEBHOOK_URL` via `deliverOperationsAlert` |
| Document blocked `DOCUMENT_NEVER_ARRIVED` (no upload within 15 minutes) | same, on the turn that first blocks it | same |
| OCR `OCR_TIMEOUT_OR_NETWORK` / `OCR_RESPONSE_INVALID` | `/api/internal/billing/settle`, after the settlement is durable | same |
| Remote MCP 5xx spike (≥ 5% of ≥ 20 tool calls in 5 minutes, one instance; uncalibrated) | `/api/mcp` | same |
| RunPod spend for the UTC day above `TAVONEL_RUNPOD_DAILY_COST_CAP_USD` (critical at 120%) | `/api/internal/sli-alerts`, hourly slot; reads RunPod `GET /v2/billing` with `TAVONEL_RUNPOD_API_KEY` | same |
| Production `direct_upload` release row within 7 days of its 30-day life, or lapsed (critical) | `/api/internal/sli-alerts`, 00:00 UTC slot | same |

All of them go through `deliverOperationsAlert` and its 5-minute same-instance dedupe; `alertId` is derived from the trigger, so a receiver can drop repeats by it. With the webhook unset each one returns `ALERT_RECEIVER_UNCONFIGURED`, is counted, and the state is logged once per process per hour with `unconfiguredSinceLastLog` — visible, not fatal. With the cost cap unset the cost check reports `RUNPOD_COST_CAP_UNCONFIGURED` in the route's `watch` field and pages nobody.

Not wired: the Cloudflare queue `foundation-quarantine-dead-letter` has no consumer. A message that exhausts `max_retries` there is still silent; an OCR transport failure is recorded (and paged) at attempt 3 before it can get there.

End-to-end timing: the first remote MCP `search_world`/`ask_world` answer from an active World writes one `enterprise_audit_events` row, action `operations.e2e_timing` (`tavonel.e2e_timing.v1`: upload confirmed → ready → activated → first answer, seconds per hop, null where a record is missing).

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
