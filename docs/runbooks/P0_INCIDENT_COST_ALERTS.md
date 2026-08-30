# P0 incident and cost alerts

## Envelope

All receivers consume `tavonel.operations_alert.v1`. Payloads contain a UUID, kind, severity, service, summary, observation time, HTTPS runbook link and deterministic dedupe key. Cost alerts also require current USD value and USD threshold. Credentials, raw document text and customer filenames are forbidden.

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
