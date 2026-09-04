-- 0043 — close the RPC/search_path exposure surfaced by the live Supabase advisor.
--
-- The compile/retrieval tables are service-role owned by design. Supabase default function
-- privileges can still leave EXECUTE on helper/security-definer functions for anon and
-- authenticated, which turns internal primitives into REST RPCs. This migration removes that
-- attack surface and pins search_path for functions that the advisor correctly flags as mutable.
begin;

alter function public.touch_foundation_compile_job() set search_path = public, pg_temp;
alter function public.reject_foundation_compile_event_mutation() set search_path = public, pg_temp;
alter function public.foundation_lexical_tsvector(text[]) set search_path = pg_catalog;

revoke all on function public.enforce_foundation_retrieval_compile_run_active_world() from public, anon, authenticated;
revoke all on function public.enqueue_foundation_compile_job(text,text,uuid,text[],text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.assert_foundation_compile_identity(public.foundation_compile_jobs,text,text[]) from public, anon, authenticated;
revoke all on function public.foundation_canonical_document_ids(text[]) from public, anon, authenticated;
revoke all on function public.foundation_lexical_tsvector(text[]) from public, anon, authenticated;

grant execute on function public.enqueue_foundation_compile_job(text,text,uuid,text[],text,text,integer,integer) to service_role;
grant execute on function public.assert_foundation_compile_identity(public.foundation_compile_jobs,text,text[]) to service_role;
grant execute on function public.foundation_canonical_document_ids(text[]) to service_role;
grant execute on function public.foundation_lexical_tsvector(text[]) to service_role;

commit;
