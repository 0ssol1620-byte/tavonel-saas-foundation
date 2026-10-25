# Change notifications: turning them on

**Scope.** G8 CHANGE-NOTIFY (DECISION-REGISTER S6-15). A signed outbound webhook that tells a
workspace a finished compile produced a candidate that differs from its active World. Activation
stays a person's decision; nothing here activates anything. Receiver contract: `/docs/run-events`,
"Change notifications".

Ships **off**. With `TAVONEL_CHANGE_NOTIFY_ENABLED` unset, the cron route
`/api/internal/change-notify/run` answers `CHANGE_NOTIFY_DISABLED` and reads nothing
(`nextjs/lib/change-notify.test.ts`, "the rollout switch").

## What turning it on needs, in this order

Follows `RELEASE_ORDER.md`: migration first, then the environment that reaches it.

1. **Apply** `supabase/migrations/20261019100000_change_notify_outbox.sql` to production (founder;
   production database writes are not an agent's call). It creates only
   `foundation_change_notifications` (service_role SELECT/INSERT/UPDATE, RLS on).
2. **Set the secret** `TAVONEL_CHANGE_NOTIFY_SECRET` (32+ characters) in the Vercel project. The name
   is the contract; the value is never committed or logged.
3. **Register endpoints** in `TAVONEL_CHANGE_NOTIFY_ENDPOINTS`: a JSON object of workspace key to
   `https://` URL on the default port, for example `{"pilot-abc123":"https://hooks.example.com/tavonel"}`.
   One invalid entry refuses the whole registry (`CHANGE_NOTIFY_ENDPOINTS_INVALID`).
4. **Hand each workspace its signing key**, derived, never stored:
   `HMAC-SHA256(TAVONEL_CHANGE_NOTIFY_SECRET, "tavonel-change-notify-v1:<workspaceKey>")` as hex
   (`workspaceSigningKey` in `nextjs/lib/change-notify.ts`). Deliver it the way an API key is
   delivered.
5. **Set** `TAVONEL_CHANGE_NOTIFY_ENABLED=1` and redeploy. The cron in `nextjs/vercel.json`
   (`2-57/5 * * * *`) is already there.

## Operating it

- The cron route returns the turn: `enqueued`, `delivered`, `retrying`, `dead`, `errors`. Any error
  makes it `CHANGE_NOTIFY_INCOMPLETE` with HTTP 503 and a `console.error` line; that includes a
  compile-job or active-World row whose digest is not `sha256:` + 64 hex
  (`CHANGE_NOTIFY_JOB_ROW_INVALID`, `CHANGE_NOTIFY_POINTER_ROW_INVALID`). Switched on without a
  usable secret or registry is also a 503 (`CHANGE_NOTIFY_SECRET_MISSING`,
  `CHANGE_NOTIFY_ENDPOINTS_INVALID`). Only `CHANGE_NOTIFY_DISABLED` and `OK` answer 200.
- The sweep reads each registered workspace's newest 50 finished compiles of the last 24 hours on
  its own; a workspace with more than that can push one of its own collections out of the window.
- Six attempts (delays 60, 300, 1,800, 7,200, 21,600 s, at cron granularity), then `state = 'dead'`
  with `dead_letter_receipt` (attempts, last status and error, body sha256). A dead row is never
  resent.
- Withdrawing a workspace from the registry buries its pending rows as
  `CHANGE_NOTIFY_ENDPOINT_NOT_REGISTERED` on the next turn.
- Rotating `TAVONEL_CHANGE_NOTIFY_SECRET` rotates every workspace's key at once, with no overlap
  window. Coordinate with every receiver first.

## Not built

Email notifications (would need a mail-provider secret), a self-serve endpoint form, per-workspace
key rotation, and an OpenAPI `webhooks` entry.
