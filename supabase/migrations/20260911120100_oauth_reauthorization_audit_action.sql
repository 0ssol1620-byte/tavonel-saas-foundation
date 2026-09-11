-- `oauth_connection_reauthorization_required` becomes a legal developer-audit action, so the
-- withdrawn-grant transition can be audited like every other OAuth connection change.
--
-- Evidence: `D:\CodexProjects\audit-lanes\reports\CA_LANE_REPORT_syncstate.md`, NOT DONE and
-- CROSS-LANE REQUESTS. `markOAuthConnectionReauthorizationRequired`
-- (`nextjs/lib/connector-oauth-store.ts`) is the only writer of
-- `foundation_oauth_connections.status = 'reauthorization_required'`, and it deliberately
-- shipped without an audit write: `foundation_developer_audit_events.action` is a closed CHECK
-- (0012:124, widened once by 0019) whose eleven values name no re-authorization action, so an
-- audit insert would have failed the constraint and -- because the write is fail-closed -- made
-- the transition unreachable again. Reusing `connection_updated` was the other option and was
-- refused: it would put a false action against an OAuth target in the audit ledger.
--
-- The action is added here and the fail-closed audit write is added to that function in the
-- same commit, which is the point of doing them together: the constraint without the writer
-- audits nothing, and the writer without the constraint breaks the flag.
--
-- Same shape as 0019 (drop-if-exists then add), so it is re-runnable and the value list stays
-- readable in one place instead of being assembled from a diff.
begin;

alter table public.foundation_developer_audit_events
  drop constraint if exists foundation_developer_audit_events_action_check;
alter table public.foundation_developer_audit_events
  add constraint foundation_developer_audit_events_action_check check (action in (
    'api_key_created', 'api_key_revoked', 'api_key_rotated',
    'connection_created', 'connection_updated', 'connection_revoked', 'connection_batch_applied',
    'oauth_authorization_started', 'oauth_connection_created', 'oauth_connection_revoked',
    'oauth_connection_synced', 'oauth_connection_reauthorization_required'
  ));

commit;
