-- Retrieval Compiler foundation. A RetrievalProfile is a reusable, tenant-scoped recipe
-- (embedding/lexical/fusion/reranker/index config). A compile run turns one promoted
-- Active World (foundation_world_versions) into multi-view retrieval units for one
-- profile; embeddings are profile-scoped so an incompatible profile/dimension can never
-- silently mix with another. All four tables here are strictly derived: deleting every
-- row must not lose anything that cannot be recompiled from the referenced world version.
begin;

create extension if not exists vector;

create table public.foundation_retrieval_profiles (
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$'),
  views text[] not null check (
    cardinality(views) between 1 and 8
    and views <@ array['section', 'claim', 'entity', 'table', 'event', 'graph_neighborhood', 'summary']::text[]
  ),
  embedding jsonb not null check (
    jsonb_typeof(embedding) = 'object'
    and embedding ? 'provider' and embedding ? 'model' and embedding ? 'revision'
    and embedding ? 'dimension' and embedding ? 'normalize'
    and jsonb_typeof(embedding -> 'dimension') = 'number'
    and (embedding ->> 'dimension')::int between 1 and 8192
  ),
  lexical jsonb not null check (jsonb_typeof(lexical) = 'object' and lexical ? 'backend'),
  fusion jsonb not null check (
    jsonb_typeof(fusion) = 'object'
    and fusion ->> 'algorithm' = 'rrf'
    and (fusion ->> 'k')::int between 1 and 1000
  ),
  reranker jsonb check (
    reranker is null
    or (jsonb_typeof(reranker) = 'object' and reranker ? 'provider' and reranker ? 'model' and reranker ? 'revision')
  ),
  index_backend text not null check (index_backend in ('pgvector')),
  index_metric text not null check (index_metric in ('cosine', 'l2', 'inner_product')),
  profile_digest text not null check (profile_digest ~ '^sha256:[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (workspace_key, id)
);

create table public.foundation_retrieval_compile_runs (
  run_id text not null check (run_id ~ '^retrieval-run-[a-f0-9]{32}$'),
  workspace_key text not null,
  collection_id text not null check (collection_id ~ '^collection-[a-f0-9]{32}$'),
  world_manifest_digest text not null check (world_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  retrieval_profile_id text not null,
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  unit_count integer check (unit_count is null or unit_count >= 0),
  embedding_count integer check (embedding_count is null or embedding_count >= 0),
  error_reason text check (error_reason is null or char_length(error_reason) between 1 and 200),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_key, run_id),
  foreign key (workspace_key, collection_id, world_manifest_digest)
    references public.foundation_world_versions (workspace_key, collection_id, manifest_digest)
    on delete restrict,
  foreign key (workspace_key, retrieval_profile_id)
    references public.foundation_retrieval_profiles (workspace_key, id)
    on delete restrict,
  check (status <> 'completed' or (completed_at is not null and unit_count is not null)),
  check (status <> 'failed' or (completed_at is not null and error_reason is not null))
);
create index foundation_retrieval_compile_runs_lookup_idx
  on public.foundation_retrieval_compile_runs (workspace_key, collection_id, world_manifest_digest, retrieval_profile_id, started_at desc);

create table public.foundation_retrieval_units (
  unit_id text not null check (unit_id ~ '^retrieval-unit-[a-f0-9]{32}$'),
  workspace_key text not null,
  compile_run_id text not null check (compile_run_id ~ '^retrieval-run-[a-f0-9]{32}$'),
  unit_type text not null check (unit_type in ('section', 'claim', 'entity', 'table', 'event', 'graph_neighborhood', 'summary')),
  document_id text not null,
  document_version_key text not null check (document_version_key ~ '^[a-f0-9]{64}$'),
  text text not null check (char_length(text) between 1 and 20000),
  page_number1 integer check (page_number1 is null or page_number1 >= 1),
  bbox1000 integer[] check (bbox1000 is null or cardinality(bbox1000) = 4),
  claim_ids text[] not null default '{}',
  entity_ids text[] not null default '{}',
  evidence_ids text[] not null default '{}',
  authority text,
  authority_score numeric(4, 3) check (authority_score is null or authority_score between 0 and 1),
  content_digest text not null check (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (workspace_key, unit_id),
  foreign key (workspace_key, compile_run_id)
    references public.foundation_retrieval_compile_runs (workspace_key, run_id)
    on delete cascade
);
create index foundation_retrieval_units_run_idx
  on public.foundation_retrieval_units (workspace_key, compile_run_id, unit_type);
create index foundation_retrieval_units_document_idx
  on public.foundation_retrieval_units (workspace_key, document_id, document_version_key);

create table public.foundation_retrieval_embeddings (
  workspace_key text not null,
  unit_id text not null,
  retrieval_profile_id text not null,
  dimension integer not null check (dimension between 1 and 8192),
  embedding vector not null check (vector_dims(embedding) = dimension),
  created_at timestamptz not null default now(),
  primary key (workspace_key, unit_id, retrieval_profile_id),
  foreign key (workspace_key, unit_id)
    references public.foundation_retrieval_units (workspace_key, unit_id)
    on delete cascade,
  foreign key (workspace_key, retrieval_profile_id)
    references public.foundation_retrieval_profiles (workspace_key, id)
    on delete restrict
);
create index foundation_retrieval_embeddings_profile_idx
  on public.foundation_retrieval_embeddings (workspace_key, retrieval_profile_id);

alter table public.foundation_retrieval_profiles enable row level security;
alter table public.foundation_retrieval_compile_runs enable row level security;
alter table public.foundation_retrieval_units enable row level security;
alter table public.foundation_retrieval_embeddings enable row level security;

revoke all on public.foundation_retrieval_profiles, public.foundation_retrieval_compile_runs,
  public.foundation_retrieval_units, public.foundation_retrieval_embeddings
  from public, anon, authenticated;

-- Derived/rebuildable data (unlike world promotion or billing) does not need a
-- security-definer RPC to enforce a business invariant on every write; the app's compile
-- job orchestrates run -> units -> embeddings -> completed, and any row here can be
-- deleted and regenerated from the referenced world version without loss.
grant select, insert, update, delete on public.foundation_retrieval_profiles to service_role;
grant select, insert, update, delete on public.foundation_retrieval_compile_runs to service_role;
grant select, insert, delete on public.foundation_retrieval_units to service_role;
grant select, insert, delete on public.foundation_retrieval_embeddings to service_role;

commit;
