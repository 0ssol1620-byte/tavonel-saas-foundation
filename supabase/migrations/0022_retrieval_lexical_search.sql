-- Real Postgres FTS for the lexical retrieval path (Wave 2), replacing "lexical: not
-- implemented" with an actual full-text index. search_tokens is populated by the same
-- Korean-particle-aware, synonym-aware tokenizer the excerpt-concatenation fallback uses
-- (nextjs/lib/lexical-tokens.ts) -- 'simple' text search config does no English stemming
-- and no Korean segmentation, so indexing raw text directly would silently under-match;
-- indexing the already-tokenized array keeps this path and the fallback path from scoring
-- the same query differently for the same reason Wave 0 fixed the chunk schema.
begin;

alter table public.foundation_retrieval_units
  add column search_tokens text[] not null default '{}' check (cardinality(search_tokens) <= 5000);

alter table public.foundation_retrieval_units
  add column search_vector tsvector
  generated always as (to_tsvector('simple', array_to_string(search_tokens, ' '))) stored;

create index foundation_retrieval_units_search_vector_idx
  on public.foundation_retrieval_units using gin (search_vector);

commit;
