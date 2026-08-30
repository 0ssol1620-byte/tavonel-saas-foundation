begin;

alter table public.foundation_developer_audit_events
  drop constraint if exists foundation_developer_audit_events_action_check;
alter table public.foundation_developer_audit_events
  add constraint foundation_developer_audit_events_action_check check (action in (
    'api_key_created', 'api_key_revoked', 'api_key_rotated',
    'connection_created', 'connection_updated', 'connection_revoked', 'connection_batch_applied',
    'oauth_authorization_started', 'oauth_connection_created', 'oauth_connection_revoked',
    'oauth_connection_synced'
  ));

commit;
