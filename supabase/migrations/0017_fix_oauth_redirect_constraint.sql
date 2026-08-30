-- PostgreSQL ARE does not accept non-capturing groups and limits interval
-- quantifiers to 255. Replace the affected patterns while preserving the
-- original 500-character application limits with explicit length checks.
begin;

alter table public.foundation_oauth_authorizations
  drop constraint if exists foundation_oauth_authorizations_redirect_uri_check;

alter table public.foundation_oauth_authorizations
  add constraint foundation_oauth_authorizations_redirect_uri_check check (
    redirect_uri ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/api/v1/oauth-connectors/callback/[a-z_]+$'
  );

alter table public.foundation_oauth_authorizations
  drop constraint if exists foundation_oauth_authorizations_pkce_verifier_reference_check;
alter table public.foundation_oauth_authorizations
  add constraint foundation_oauth_authorizations_pkce_verifier_reference_check check (
    char_length(pkce_verifier_reference) between 3 and 500
    and pkce_verifier_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]+$'
  );

alter table public.foundation_oauth_connections
  drop constraint if exists foundation_oauth_connections_client_secret_reference_check;
alter table public.foundation_oauth_connections
  add constraint foundation_oauth_connections_client_secret_reference_check check (
    char_length(client_secret_reference) between 3 and 500
    and client_secret_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]+$'
  );

alter table public.foundation_oauth_connections
  drop constraint if exists foundation_oauth_connections_refresh_token_reference_check;
alter table public.foundation_oauth_connections
  add constraint foundation_oauth_connections_refresh_token_reference_check check (
    char_length(refresh_token_reference) between 3 and 500
    and refresh_token_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]+$'
  );

alter table public.foundation_connections
  drop constraint if exists foundation_connections_secret_reference_check;
alter table public.foundation_connections
  add constraint foundation_connections_secret_reference_check check (
    secret_reference is null or (
      char_length(secret_reference) between 3 and 500
      and secret_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]+$'
    )
  );

alter table public.enterprise_workspaces
  drop constraint if exists enterprise_workspaces_deployment_reference_check;
alter table public.enterprise_workspaces
  add constraint enterprise_workspaces_deployment_reference_check check (
    deployment_reference is null or (
      char_length(deployment_reference) between 3 and 500
      and deployment_reference ~ '^(vercel|gcp|aws|azure|runpod)://[A-Za-z0-9._/@:+-]+$'
    )
  );

alter table public.enterprise_identity_configs
  drop constraint if exists enterprise_identity_configs_secret_reference_check;
alter table public.enterprise_identity_configs
  add constraint enterprise_identity_configs_secret_reference_check check (
    secret_reference is null or (
      char_length(secret_reference) between 3 and 500
      and secret_reference ~ '^(vercel|aws-sm|gcp-sm|azure-kv|vault)://[A-Za-z0-9._/@:+-]+$'
    )
  );

commit;
