-- Rollback for migration 20261127040000_scoped_retrieval_search_rpc (WO-PROJ-K2-E2).
--
-- Not a migration: run by hand, as one transaction, against the database where the migration was
-- applied. The ordinary rollback of the scoped retrieval path is NOT this file: it is unsetting
-- TAVONEL_MEMBER_PROJECTION_ENFORCE and redeploying, after which no request calls these functions
-- (flag-off and shadow use only the 0023/0052 RPCs). Run this only after the site is on such a
-- build; a build that still calls them under ENFORCE finds no function, its lexical read fails, and
-- the projected request is refused 503 (fail closed, never served unprojected).
--
-- The functions hold no data and the index is derived, so nothing is lost. A missing object stops
-- the rollback (no `if exists`). Afterwards the catalog fingerprint
-- (nextjs/scripts/db/catalog-fingerprints.sql) equals the one of the chain ending before this
-- migration.
--
-- Recording it: this file deliberately does not edit supabase_migrations.schema_migrations. After it
-- commits, the operator deletes the migration's version row in the same session and writes the
-- version, the time and who ran it into the campaign ledger.
\set ON_ERROR_STOP on
begin;

drop function public.foundation_retrieval_structure_candidates_scoped(text, text, text[], integer);
drop function public.search_foundation_retrieval_units_dense_scoped(text, text, text, double precision[], text, text[], integer);
drop function public.search_foundation_retrieval_units_lexical_scoped(text, text, text[], text[], integer);
drop function public.foundation_retrieval_scope_keys(text, text, text[]);
drop index public.foundation_retrieval_embeddings_scope_key_idx;
drop index public.foundation_retrieval_units_scope_key_idx;

commit;
