-- Encrypted OAuth secret envelopes. Plaintext and encryption keys never enter PostgreSQL.
begin;

create table public.foundation_oauth_secret_envelopes (
  secret_id uuid primary key,
  secret_name text not null check (
    char_length(secret_name) between 3 and 240
    and secret_name ~ '^[A-Za-z0-9._/-]+$'
  ),
  ciphertext_b64 text not null check (
    char_length(ciphertext_b64) between 4 and 131072
    and ciphertext_b64 ~ '^[A-Za-z0-9+/]+={0,2}$'
  ),
  nonce_b64 text not null check (
    char_length(nonce_b64) between 16 and 24
    and nonce_b64 ~ '^[A-Za-z0-9+/]+={0,2}$'
  ),
  auth_tag_b64 text not null check (
    char_length(auth_tag_b64) between 20 and 28
    and auth_tag_b64 ~ '^[A-Za-z0-9+/]+={0,2}$'
  ),
  created_at timestamptz not null default now()
);
create index foundation_oauth_secret_envelopes_created_idx
  on public.foundation_oauth_secret_envelopes (created_at);

alter table public.foundation_oauth_secret_envelopes enable row level security;
revoke all on public.foundation_oauth_secret_envelopes from public, anon, authenticated;
grant select, insert, delete on public.foundation_oauth_secret_envelopes to service_role;

create or replace function public.reject_oauth_secret_envelope_update()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'oauth_secret_envelope_immutable'; end;
$$;
create trigger foundation_oauth_secret_envelope_immutable
  before update on public.foundation_oauth_secret_envelopes
  for each row execute function public.reject_oauth_secret_envelope_update();
revoke all on function public.reject_oauth_secret_envelope_update() from public, anon, authenticated;

commit;
