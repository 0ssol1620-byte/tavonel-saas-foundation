-- Real Postgres FTS for the lexical retrieval path (Wave 2), replacing "lexical: not
-- implemented" with an actual full-text index. search_tokens is populated by the same
-- Korean-particle-aware, synonym-aware tokenizer the excerpt-concatenation fallback uses
-- (nextjs/lib/lexical-tokens.ts) -- 'simple' text search config does no English stemming
-- and no Korean segmentation, so indexing raw text directly would silently under-match;
-- indexing the already-tokenized array keeps this path and the fallback path from scoring
-- the same query differently for the same reason Wave 0 fixed the chunk schema.
--
-- 2026-09-04: as first written, this migration could not be applied to any PostgreSQL.
--
--   generated always as (to_tsvector('simple', array_to_string(search_tokens, ' '))) stored
--
-- is rejected with "generation expression is not immutable". array_to_string is declared
-- STABLE, not IMMUTABLE: it takes anyarray, and for an arbitrary element type the output
-- function it calls may read a GUC -- timestamps depend on DateStyle and TimeZone. A stored
-- generated column requires an immutable expression, so the ALTER never succeeded anywhere.
-- Nothing caught it because the only test over this file asserted its text.
--
-- This column's element type is text, whose output function is textout, which is immutable.
-- So the expression really is immutable here, and STABLE is the catch-all for element types
-- this column cannot hold. The wrapper states that narrower fact where the planner reads it.
--
-- array_to_tsvector(text[]) is immutable and would need no wrapper, but it is not a
-- substitute: it yields lexemes without positions, and nextjs/lib/lexical-search.ts ranks
-- with ts_rank_cd, a cover-density measure over positions. Adopting it would flatten every
-- document to the same rank -- a change to retrieval behaviour, not a fix to a migration.
begin;

create or replace function public.foundation_lexical_tsvector(p_tokens text[])
returns tsvector
language sql
immutable
parallel safe
as $fn$
  select pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, pg_catalog.array_to_string(p_tokens, ' '))
$fn$;

comment on function public.foundation_lexical_tsvector(text[]) is
  'Immutable tsvector over a pre-tokenized text[]. Exists because array_to_string is STABLE for anyarray while being immutable for text[]; a stored generated column will not accept the unwrapped expression.';

alter table public.foundation_retrieval_units
  add column search_tokens text[] not null default '{}' check (cardinality(search_tokens) <= 5000);

alter table public.foundation_retrieval_units
  add column search_vector tsvector
  generated always as (public.foundation_lexical_tsvector(search_tokens)) stored;

create index foundation_retrieval_units_search_vector_idx
  on public.foundation_retrieval_units using gin (search_vector);

commit;
