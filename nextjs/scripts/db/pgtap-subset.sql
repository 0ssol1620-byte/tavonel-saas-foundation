-- Minimal pgTAP subset for a disposable local cluster (WO-D24-1).
-- A fast local check only: it implements the functions the repository's supabase/tests files use
-- most, nothing more. db-rehearsal (real pgTAP, real pgvector) is the authority on every PR.
-- Creates no extension and no role. Installed into `public`, which the tests' search_path reaches.
create table if not exists public.__tap (n serial, ok boolean, description text);
create table if not exists public.__tap_plan (planned integer);
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant usage on schema public to %I', r);
      execute format('grant select, insert, delete on public.__tap, public.__tap_plan to %I', r);
      execute format('grant usage on sequence public.__tap_n_seq to %I', r);
    end if;
  end loop;
end $$;

create or replace function public.plan(p integer) returns text language plpgsql as $$
begin delete from public.__tap; delete from public.__tap_plan; insert into public.__tap_plan values (p); return '1..' || p; end $$;
create or replace function public.__emit(pass boolean, description text) returns text language plpgsql as $$
declare v integer;
begin insert into public.__tap(ok, description) values (coalesce(pass,false), description) returning n into v;
  if not coalesce(pass,false) then raise warning 'not ok % - %', v, description; end if;
  return case when coalesce(pass,false) then 'ok ' else 'not ok ' end || v || ' - ' || coalesce(description,''); end $$;
create or replace function public.ok(pass boolean, description text default '') returns text language sql as $$ select public.__emit(pass, description) $$;
create or replace function public.is(have anyelement, want anyelement, description text default '') returns text language plpgsql as $$
begin if have is distinct from want then raise warning 'have: % want: %', have, want; end if;
  return public.__emit(have is not distinct from want, description); end $$;
create or replace function public.isnt(have anyelement, want anyelement, description text default '') returns text language sql as $$ select public.__emit(have is distinct from want, description) $$;

-- throws_ok(sql), (sql, errmsg|errcode, description), (sql, errcode, errmsg, description)
create or replace function public.throws_ok(code text, expected text, description text default '') returns text language plpgsql as $$
begin
  begin execute code;
  exception when others then
    if expected is null or sqlerrm = expected or sqlstate = expected then return public.__emit(true, description); end if;
    raise warning 'threw % (%), wanted %', sqlerrm, sqlstate, expected; return public.__emit(false, description);
  end;
  raise warning 'did not throw, wanted %', expected; return public.__emit(false, description);
end $$;
create or replace function public.throws_ok(code text) returns text language sql as $$ select public.throws_ok(code, null, '') $$;
create or replace function public.throws_ok(code text, errcode text, errmsg text, description text) returns text language plpgsql as $$
begin
  begin execute code;
  exception when others then
    if (errcode is null or sqlstate = errcode) and (errmsg is null or sqlerrm = errmsg) then return public.__emit(true, description); end if;
    raise warning 'threw % (%), wanted % %', sqlerrm, sqlstate, errcode, errmsg; return public.__emit(false, description);
  end;
  raise warning 'did not throw, wanted % %', errcode, errmsg; return public.__emit(false, description);
end $$;
create or replace function public.lives_ok(code text, description text default '') returns text language plpgsql as $$
begin begin execute code; exception when others then raise warning 'died: %', sqlerrm; return public.__emit(false, description); end;
  return public.__emit(true, description); end $$;

create or replace function public.has_table(schema_name name, table_name name, description text default '') returns text language sql as $$
  select public.__emit(to_regclass(quote_ident(schema_name) || '.' || quote_ident(table_name)) is not null, description) $$;
create or replace function public.has_table(table_name name, description text default '') returns text language sql as $$
  select public.__emit(to_regclass(quote_ident(table_name)) is not null, description) $$;
create or replace function public.has_column(schema_name name, table_name name, column_name name, description text default '') returns text language sql as $$
  select public.__emit(exists (select 1 from information_schema.columns c
    where c.table_schema = schema_name and c.table_name = has_column.table_name and c.column_name = has_column.column_name), description) $$;
create or replace function public.has_column(table_name name, column_name name, description text default '') returns text language sql as $$
  select public.__emit(exists (select 1 from information_schema.columns c
    where c.table_schema = any (current_schemas(false)) and c.table_name = has_column.table_name and c.column_name = has_column.column_name), description) $$;

create or replace function public.finish() returns setof text language plpgsql as $$
declare planned integer; ran integer; failed integer;
begin select p.planned into planned from public.__tap_plan p; select count(*), count(*) filter (where not ok) into ran, failed from public.__tap;
  if failed > 0 or ran <> planned then raise exception 'TAP FAIL: planned % ran % failed %', planned, ran, failed; end if;
  return next format('# all %s passed', ran); end $$;
