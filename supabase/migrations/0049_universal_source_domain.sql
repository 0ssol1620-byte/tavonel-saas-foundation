-- 0049 — Universal Source domain: sources / source_versions / source_representations.
--
-- Why a new ledger rather than columns on `documents`: the product records exactly one artifact
-- chain per upload today, and it records it by listing R2 keys. `immutable/<ws>/<ws>/<doc>/<digest>/
-- sanitized.pdf` and `.../ocr.json` are the whole of what the compile path knows, and the digest in
-- the key is the digest of the CDR *output*. Nothing anywhere says which provider produced which
-- artifact, at which revision, from which parent — so "every derived artifact has sourceVersion +
-- parent digest" (blueprint §48 P0-B) cannot be answered from what exists. These three tables are
-- where that answer is written down, beside the live flow rather than in place of it. No table,
-- policy, key layout or worker behaviour changes in this migration.
--
-- The invariants are enforced here as well as in TypeScript, because at-least-once delivery means
-- two writers can present the same version at once. What the database contributes on the insert
-- path is the keys: the primary keys and the partial unique index on kind = 'original' keep the row
-- that was written first, and `nextjs/lib/source-domain-store.ts` reads that kept row back and
-- refuses when it disagrees with what it was presenting. The triggers below fire BEFORE UPDATE, so
-- they cover the other writer -- one that edits a stored row rather than re-presenting it -- and
-- the lineage trigger fires on insert too:
--   * a source_version_id is bound to one digest and one object key for ever (update),
--   * an `original` representation is never rewritten (update),
--   * a derived representation names parents that exist under the same source version (insert and
--     update).
-- There is no DELETE grant. A source leaves service by being tombstoned, because deleting a row
-- here is deleting the record that a compile ever read those bytes.
begin;

create table public.sources (
  source_id text primary key check (source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  -- No tenant segment exists in the live object layout or the live compile envelope; the
  -- workspace is the tenancy boundary in code today and tenant_id carries the same value.
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  origin_kind text not null check (origin_kind in ('upload', 'connector', 'api', 'database', 'repository')),
  origin_provider text check (origin_provider is null or char_length(origin_provider) between 1 and 128),
  canonical_uri text check (canonical_uri is null or char_length(canonical_uri) between 1 and 2048),
  source_family text not null check (source_family in (
    'document', 'spreadsheet', 'presentation', 'image', 'email', 'structured_data', 'web', 'code',
    'cad_2d', 'cad_3d', 'bim', 'audio', 'video', 'archive', 'database', 'api', 'unknown'
  )),
  created_at timestamptz not null,
  tombstoned_at timestamptz,
  tombstone_reason text,
  recorded_at timestamptz not null default now(),
  check (tombstone_reason is null or tombstoned_at is not null)
);
create index sources_workspace_created_idx on public.sources (workspace_id, created_at desc);

create table public.source_versions (
  source_version_id text primary key check (source_version_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  source_id text not null references public.sources(source_id) on delete restrict,
  immutable_object_key text not null check (char_length(immutable_object_key) between 1 and 1024),
  content_sha256 text not null check (content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  byte_length bigint not null check (byte_length >= 1),
  mime_type text not null check (char_length(mime_type) between 3 and 160),
  source_modified_at timestamptz,
  observed_at timestamptz not null,
  -- Always null in this campaign: every re-upload creates a fresh document row, so no code can
  -- yet say that two versions are versions of one logical source. Same-logical-source detection
  -- is a product decision, not something a migration may assume.
  parent_version_id text references public.source_versions(source_version_id) on delete restrict,
  tombstoned boolean not null default false,
  security_classification text check (security_classification is null or char_length(security_classification) between 1 and 64),
  recorded_at timestamptz not null default now()
);
create index source_versions_source_idx on public.source_versions (source_id, observed_at desc);

create table public.source_representations (
  representation_id text primary key check (representation_id ~ '^rep-[a-f0-9]{32}$'),
  source_version_id text not null references public.source_versions(source_version_id) on delete restrict,
  kind text not null check (kind in ('original', 'native', 'rendered', 'ocr', 'visual', 'normalized', 'canonical_ir')),
  provider_id text not null check (char_length(provider_id) between 1 and 128),
  -- Not defaultable. An artifact whose producing revision is unknown cannot be reproduced, and a
  -- placeholder revision is a receipt that lies.
  provider_revision text not null check (char_length(provider_revision) between 1 and 128),
  content_sha256 text not null check (content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  object_key text not null check (char_length(object_key) between 1 and 1024),
  lossy boolean not null,
  derived_from text[] not null default '{}'::text[] check (array_position(derived_from, null) is null),
  created_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  -- The original is the version's own bytes: no derivation, nothing lost.
  check ((kind = 'original') = (cardinality(derived_from) = 0)),
  check (kind <> 'original' or lossy = false)
);
create index source_representations_version_idx on public.source_representations (source_version_id, kind);
create unique index source_representations_single_original_idx
  on public.source_representations (source_version_id) where kind = 'original';

create or replace function public.reject_source_version_rebinding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.content_sha256 <> old.content_sha256
    or new.immutable_object_key <> old.immutable_object_key
    or new.source_id <> old.source_id then
    raise exception 'source_version_digest_conflict';
  end if;
  return new;
end;
$$;

create trigger source_versions_digest_immutable
  before update on public.source_versions
  for each row execute function public.reject_source_version_rebinding();

create or replace function public.reject_original_representation_rewrite()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.kind = 'original'
    and (new.object_key <> old.object_key or new.content_sha256 <> old.content_sha256 or new.kind <> old.kind) then
    raise exception 'original_representation_immutable';
  end if;
  return new;
end;
$$;

create trigger source_representations_original_immutable
  before update on public.source_representations
  for each row execute function public.reject_original_representation_rewrite();

create or replace function public.assert_source_representation_lineage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from unnest(new.derived_from) as parent_id
    where parent_id = new.representation_id
      or not exists (
        select 1 from public.source_representations parent
        where parent.representation_id = parent_id
          and parent.source_version_id = new.source_version_id
      )
  ) then
    raise exception 'representation_lineage_broken';
  end if;
  return new;
end;
$$;

create trigger source_representations_lineage_resolves
  before insert or update on public.source_representations
  for each row execute function public.assert_source_representation_lineage();

alter table public.sources enable row level security;
alter table public.source_versions enable row level security;
alter table public.source_representations enable row level security;

revoke all on public.sources, public.source_versions, public.source_representations
  from public, anon, authenticated;

revoke all on function public.reject_source_version_rebinding() from public, anon, authenticated;
revoke all on function public.reject_original_representation_rewrite() from public, anon, authenticated;
revoke all on function public.assert_source_representation_lineage() from public, anon, authenticated;

-- Insert and select only. An update reaches the triggers above, and there is no delete: a source
-- is retired by tombstone, never by removing the evidence that it was compiled.
grant select, insert, update on public.sources to service_role;
grant select, insert, update on public.source_versions to service_role;
grant select, insert, update on public.source_representations to service_role;

-- Backfill: `sources` only, and only where the 0001 tenant schema was applied.
--
-- 0001 declares itself "intentionally not applied by this project", and no application code reads
-- `public.documents` or `public.sanitization_proofs` — the live intake path is
-- `foundation_intake_admissions` plus R2 objects. So this block is a no-op wherever 0001 was not
-- applied, and it must not fail there either.
--
-- Only `sources` is backfilled. `documents` carries no byte length, and a `source_versions` row
-- without one would either be a fabricated number or a row that violates its own check. Its
-- `source_sha256` is the pre-CDR quarantine digest, which is not the digest of the immutable
-- object the compiler reads, so binding it to an immutable key would record a digest for bytes
-- that key does not hold. Versions and representations are recorded at observation time by
-- `nextjs/lib/source-domain-store.ts`, where both the digest and the byte length are known.
do $$
begin
  if to_regclass('public.documents') is null then
    raise notice 'source backfill skipped: public.documents does not exist in this project';
    return;
  end if;

  insert into public.sources (source_id, tenant_id, workspace_id, origin_kind, source_family, created_at)
  select
    d.id::text,
    d.workspace_id::text,
    d.workspace_id::text,
    'upload',
    case lower(split_part(d.declared_mime_type, ';', 1))
      when 'application/pdf' then 'document'
      when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'document'
      when 'application/vnd.oasis.opendocument.text' then 'document'
      when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'spreadsheet'
      when 'application/vnd.oasis.opendocument.spreadsheet' then 'spreadsheet'
      when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'presentation'
      when 'application/vnd.oasis.opendocument.presentation' then 'presentation'
      when 'image/jpeg' then 'image'
      when 'image/png' then 'image'
      when 'image/tiff' then 'image'
      when 'image/gif' then 'image'
      when 'application/zip' then 'archive'
      else 'unknown'
    end,
    d.created_at
  from public.documents d
  on conflict (source_id) do nothing;
end;
$$;

commit;
