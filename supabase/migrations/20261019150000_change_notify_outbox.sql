-- Change-notification outbox (G8 CHANGE-NOTIFY, DECISION-REGISTER S6-15).
--
-- One row per change a workspace is told about: a finished compile whose candidate differs from
-- the World the workspace's AI reads. The row is the delivery's durable state -- attempts, the
-- next attempt's time, and the outcome -- so at-least-once survives a worker dying mid-send.
--
--   * delivery_id is the primary key and is derived from (workspace, collection, candidate digest)
--     by nextjs/lib/change-notify.ts, so enqueueing the same change twice is one row.
--   * A claim is `update ... where attempt = N and state = 'pending'`: two overlapping cron turns
--     cannot both send one attempt. Nothing here executes; the app owns the schedule.
--   * 'dead' is the dead letter. It keeps its receipt (attempts, last error, body digest) and is
--     never resent.
--   * event is the public payload exactly as sent, bounded and credential-free. The signing key is
--     derived at send time and is never stored.
--
-- Read and written only by the server credential. Production applies this only together with the
-- TAVONEL_CHANGE_NOTIFY_ENABLED switch; until then the app never reaches the table.
begin;

create table if not exists public.foundation_change_notifications (
  delivery_id text primary key check (delivery_id ~ '^dlv_[a-f0-9]{32}$'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  event jsonb not null check (
    jsonb_typeof(event) = 'object'
    and octet_length(event::text) <= 4096
    and event::text !~* '"(secret|password|token|credential|signature|private[_-]?key)"[[:space:]]*:'
  ),
  state text not null default 'pending' check (state in ('pending', 'delivered', 'dead')),
  attempt integer not null default 0 check (attempt between 0 and 20),
  available_at timestamptz not null default now(),
  last_status integer check (last_status is null or last_status between 100 and 599),
  last_error text check (last_error is null or last_error ~ '^[A-Z0-9_]{2,64}$'),
  dead_letter_receipt jsonb check (dead_letter_receipt is null or (jsonb_typeof(dead_letter_receipt) = 'object' and octet_length(dead_letter_receipt::text) <= 2048)),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  dead_at timestamptz,
  -- The payload names its own row: a row can only carry the event of the workspace it belongs to.
  constraint foundation_change_notifications_event_identity check (
    event->>'deliveryId' = delivery_id and event->>'workspaceKey' = workspace_key
  ),
  constraint foundation_change_notifications_outcome check (
    (state = 'delivered') = (delivered_at is not null)
    and (state = 'dead') = (dead_at is not null and dead_letter_receipt is not null)
  )
);

-- The worker's due query: pending rows, oldest scheduled first.
create index if not exists foundation_change_notifications_due_idx
  on public.foundation_change_notifications (available_at)
  where state = 'pending';

create index if not exists foundation_change_notifications_workspace_idx
  on public.foundation_change_notifications (workspace_key, created_at desc);

alter table public.foundation_change_notifications enable row level security;
revoke all on public.foundation_change_notifications from public, anon, authenticated, service_role;
grant select, insert, update on public.foundation_change_notifications to service_role;

commit;
