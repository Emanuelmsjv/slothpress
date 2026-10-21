-- Slothpress — RLS audit
--
-- A policy that looks right can still leak. This script checks the schema for
-- the failure modes that actually show up in production, and exits with an
-- error naming the problem instead of quietly passing.
--
-- Run it after schema.sql:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/rls-audit.sql
--
-- It changes nothing. It only reads.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Every table has RLS, and RLS is forced
-- ---------------------------------------------------------------------------

do $$
declare
  v_off text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_off
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if v_off is not null then
    raise exception 'Row level security is not enabled on: %', v_off;
  end if;
end
$$;

do $$
declare
  v_not_forced text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_not_forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and not c.relforcerowsecurity;

  if v_not_forced is not null then
    raise exception 'RLS is enabled but not forced on: %', v_not_forced;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. No table is left without a policy. A table with RLS on and no policy is
--    locked down completely, which is safe but almost always a mistake.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
  v_policies int;
begin
  for v_table in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
  loop
    select count(*) into v_policies
      from pg_policy pol
     where pol.polrelid = (c.oid)
       and c.relname = v_table;

    if v_policies = 0 then
      raise exception 'Table public.% has RLS enabled but no policies at all', v_table;
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Write policies need WITH CHECK. USING alone lets a row be updated into
--    a state the policy would have refused.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  select string_agg(pol.polname, ', ' order by pol.polname)
    into v_missing
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and pol.polcmd in ('i', 'u')
     and pol.polwithcheck is null;

  if v_missing is not null then
    raise exception 'Write policies without WITH CHECK: %', v_missing;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Read and delete policies need USING.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  select string_agg(pol.polname, ', ' order by pol.polname)
    into v_missing
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and pol.polcmd in ('r', 'd')
     and pol.polqual is null;

  if v_missing is not null then
    raise exception 'Read or delete policies without USING: %', v_missing;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. auth.uid() should be wrapped in a select.
--
--    A bare auth.uid() is re-evaluated for every row, which turns a feed query
--    into a per-row function call. `(select auth.uid())` is evaluated once.
-- ---------------------------------------------------------------------------

do $$
declare
  v_wrapped text;
begin
  select string_agg(pol.polname, ', ' order by pol.polname)
    into v_wrapped
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and (
       (pol.polqual is not null and pol.polqual::text like '%auth.uid()%' and pol.polqual::text not like '%(select auth.uid())%')
       or (pol.polwithcheck is not null and pol.polwithcheck::text like '%auth.uid()%' and pol.polwithcheck::text not like '%(select auth.uid())%')
     );

  if v_wrapped is not null then
    raise exception 'Policies calling auth.uid() without the (select ...) wrapper: %', v_wrapped;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. No policy may reference its own table.
--
--    That is the 42P17 seam: a policy on `cards` that looks up `cards` makes
--    Postgres decide the policy depends on itself, and the query fails at
--    runtime rather than at policy-creation time. Cross-table lookups go
--    through a security definer function in the private schema instead.
-- ---------------------------------------------------------------------------

do $$
declare
  v_self text;
begin
  select string_agg(pol.polname, ', ' order by pol.polname)
    into v_self
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and (
       (pol.polqual is not null and pol.polqual::text ~ ('\m' || c.relname || '\M'))
       or (pol.polwithcheck is not null and pol.polwithcheck::text ~ ('\m' || c.relname || '\M'))
     );

  if v_self is not null then
    raise exception 'Policies that reference their own table: %', v_self;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Every security definer function must pin its search_path.
--
--    Without it, a function that builds a query as text can be hijacked by
--    anyone who can create objects in the search path.
-- ---------------------------------------------------------------------------

do $$
declare
  v_loose text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_loose
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosecdef
     and (
       p.proconfig is null
       or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
       or exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%' and cfg <> 'search_path=""')
     );

  if v_loose is not null then
    raise exception 'Security definer functions without an empty search_path: %', v_loose;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 8. The anonymous role must not be able to write.
-- ---------------------------------------------------------------------------

do $$
declare
  v_writes text;
begin
  select string_agg(distinct table_name, ', ')
    into v_writes
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  if v_writes is not null then
    raise exception 'The anon role can write to: %', v_writes;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 9. The anonymous role must not be able to call a security definer function.
-- ---------------------------------------------------------------------------

do $$
declare
  v_calls text;
begin
  select string_agg(distinct n.nspname || '.' || p.proname, ', ')
    into v_calls
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join information_schema.role_routine_grants g
      on g.specific_name = p.proname
     and g.routine_schema = n.nspname
   where g.grantee = 'anon'
     and n.nspname in ('public', 'private')
     and p.prosecdef;

  if v_calls is not null then
    raise exception 'The anon role can call security definer functions: %', v_calls;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 10. The counter columns must be maintained by a trigger, not by the client.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  select string_agg(tgname, ', ')
    into v_missing
    from pg_trigger
   where not tgisinternal
     and tgrelid in ('public.cards'::regclass, 'public.card_comments'::regclass, 'public.card_interactions'::regclass)
     and not exists (
       select 1 from pg_proc p where p.proname = 'sync_card_counters'
     );

  if v_missing is not null then
    raise exception 'Counter triggers are missing: %', v_missing;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 11. The feed index has to support keyset pagination, which means the id
--     has to be part of it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_index text;
begin
  select string_agg(i.relname, ', ')
    into v_index
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'cards'
     and (
       select array_agg(a.attname order by a.attname)
         from unnest(x.indkey) k
         join pg_attribute a on a.attrelid = t.oid and a.attnum = k
     ) = array['created_at', 'id'];

  if v_index is null then
    raise exception 'No index on public.cards covering (created_at desc, id desc)';
  end if;
end
$$;

\echo 'RLS audit passed.'
