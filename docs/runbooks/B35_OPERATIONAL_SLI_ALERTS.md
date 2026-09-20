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

This component records alert intent only. It does not call email, paging, chat, webhook, or other
notification providers. Delivery and acknowledgement require a separately approved integration.

Operator checks:

1. Confirm the probe cron remains at `*/5 * * * *` and the alert cron runs one minute later.
2. Call the route twice in one slot with the cron bearer credential; the second response should be
   `SLI_ALERT_EVALUATION_REPLAYED` when the probe snapshot is unchanged.
3. Query `foundation_operational_sli_evaluations` with the service role and confirm the stored
   state and alert reasons match the route receipt. Never treat a `503` response as persisted.
