# B35 operational SLI alert evaluations

`/api/internal/sli-alerts` runs every five minutes after the synthetic probe. It reads the bounded
probe history, evaluates `tavonel.operational_sli.v1` at the fixed UTC schedule slot, and records
the result through `record_foundation_operational_sli`.

The database derives the evaluation key from the fixed schedule slot and binds it to the first
canonical payload hash. An identical retry returns the existing receipt as `replayed`; changed
evidence within the same slot is rejected as an idempotency conflict, and records are append-only. If the probe
history is missing or unreadable, the route persists a sanitized `blocked/history_unavailable`
evaluation. If database configuration, transport, or receipt validation fails, the route returns
`503`, `persisted: false`, and the bounded evaluation. A successful HTTP response therefore means
the receipt is durable, not merely calculated in memory.

## Delivery

When an evaluation carries at least one alert (a breach), the route posts one
`tavonel.operations_alert.v1` envelope to the incoming webhook named by the
`OPERATIONS_ALERT_WEBHOOK_URL` secret, through `deliverOperationsAlert` (the same receiver the
production smoke workflow pages). The record is attempted first; delivery is attempted even when
the record failed, because a database outage is exactly the breach that must page.

- **Breach id.** One breach per schedule slot. `alertId` is a UUID derived from the slot alone, and
  the summary names the slot, so `dedupeKey` is stable per breach. A retry inside one slot is the
  same breach.
- **At-least-once.** A repeat of the same breach on the same instance is suppressed
  (`ALERT_SUPPRESSED_DUPLICATE`). A retry that lands on another instance after a successful post can
  page twice with the same `alertId`; receivers drop repeats by `alertId`/`dedupeKey`. A failed or
  unconfigured delivery is never marked as sent, so the next retry tries again.
- **Payload.** State, unique alert reasons, slot, severity (critical if any alert is critical),
  `service: "web"` and this runbook's link. No probe bodies, provider errors, environment values,
  credentials or the webhook URL. The URL is never logged or returned.

Route outcomes (`delivery.code` in the response):

| Outcome | HTTP | Meaning |
| --- | --- | --- |
| `NO_BREACH` | 200 | No alert in the evaluation; nothing sent. |
| `ALERT_DELIVERED` | 200 | Receiver answered 2xx. |
| `ALERT_SUPPRESSED_DUPLICATE` | 200 | Same breach already delivered from this instance. |
| `ALERT_DELIVERY_UNCONFIGURED` | 200 | Secret unset or not `https://`: **record-only**. stderr carries `ALERT_RECEIVER_UNCONFIGURED`. Nobody was paged. |
| `ALERT_DELIVERY_FAILED` | 502 | Receiver answered non-2xx, was unreachable, or exceeded the 5 s timeout. The receipt is still durable (`persisted: true`); route code `SLI_ALERT_DELIVERY_FAILED`. |

A `503` (record not persisted) also carries `delivery`, so a page can go out while the store is down.

Acknowledgement, escalation and on-call rotation are not part of this route. The channel behind the
webhook is the founder's choice.

Operator checks:

1. Confirm the probe cron remains at `*/5 * * * *` and the alert cron runs one minute later.
2. Call the route twice in one slot with the cron bearer credential; the second response should be
   `SLI_ALERT_EVALUATION_REPLAYED` when the probe snapshot is unchanged.
3. Query `foundation_operational_sli_evaluations` with the service role and confirm the stored
   state and alert reasons match the route receipt. Never treat a `503` response as persisted.
   The stored evaluation also carries `watch`: the `{check, code}` of each scheduled operations
   check that ran in the slot (the hourly RunPod daily-cost read, the 00 UTC release-row expiry),
   and an empty list in slots that run none. It holds codes only, never spend, cap or delivery
   detail. An hourly slot whose `watch` lacks `runpod_daily_cost` did not read billing. The
   checks share one 4 s deadline so the record and its page keep the route's 15 s budget; a check
   that ran out of time is stored as `CHECK_DEADLINE_EXCEEDED`: the deadline expired before the
   check finished, so its outcome is unknown. Billing may or may not have been read, and a page
   may still have gone out.
4. With `OPERATIONS_ALERT_WEBHOOK_URL` set, confirm a breaching slot returns `ALERT_DELIVERED` and
   the message arrives in the chosen channel. `ALERT_DELIVERY_UNCONFIGURED` in production means
   alerts are still record-only.
