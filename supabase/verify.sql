-- Did the migration take, and did the right version of it take?
--
-- Paste into the Supabase SQL editor and run. Entirely read-only: it
-- asks the catalogs what is true rather than attempting anything, so it
-- cannot leave a stray offering behind or move the tally.
--
-- Every row prints its own verdict. Anything reading FAIL means the
-- database is not in the state the application expects -- in almost
-- every case because an older copy of the migration was run, and the fix
-- is to run the current one again (it is safe to re-run).

with checks(sort, label, got, want) as (
  values
    -- ---- the tables ----
    (1, 'offerings table exists',
        (to_regclass('public.offerings') is not null)::text, 'true'),
    (2, 'bappa_state table exists',
        (to_regclass('public.bappa_state') is not null)::text, 'true'),
    (3, 'rate_limits table exists',
        (to_regclass('public.rate_limits') is not null)::text, 'true'),

    -- ---- row level security ----
    (4, 'RLS on offerings',
        (select relrowsecurity::text from pg_class where oid = 'public.offerings'::regclass), 'true'),
    (5, 'RLS on bappa_state',
        (select relrowsecurity::text from pg_class where oid = 'public.bappa_state'::regclass), 'true'),
    (6, 'RLS on rate_limits',
        (select relrowsecurity::text from pg_class where oid = 'public.rate_limits'::regclass), 'true'),

    -- ---- what the public key may do ----
    -- The browser holds this key by design. It must be able to watch him
    -- and able to do nothing else.
    (7, 'anon may READ offerings (people watch with this)',
        has_table_privilege('anon', 'public.offerings', 'SELECT')::text, 'true'),
    (8, 'anon may INSERT offerings',
        has_table_privilege('anon', 'public.offerings', 'INSERT')::text, 'false'),
    (9, 'anon may UPDATE the tally',
        has_table_privilege('anon', 'public.bappa_state', 'UPDATE')::text, 'false'),
    (10, 'anon may READ rate_limits',
        has_table_privilege('anon', 'public.rate_limits', 'SELECT')::text, 'false'),

    -- The one that mattered. These are SECURITY DEFINER and bypass every
    -- policy above, and Postgres grants EXECUTE to PUBLIC by default --
    -- so revoking from anon by name alone leaves this reading true.
    (11, 'anon may CALL leave_offering',
        has_function_privilege('anon', 'public.leave_offering(text,text,real,bigint)', 'EXECUTE')::text, 'false'),
    (12, 'anon may CALL bump_rate',
        has_function_privilege('anon', 'public.bump_rate(text,integer)', 'EXECUTE')::text, 'false'),

    -- ---- what the server may do ----
    (13, 'service_role may CALL leave_offering',
        has_function_privilege('service_role', 'public.leave_offering(text,text,real,bigint)', 'EXECUTE')::text, 'true'),
    (14, 'service_role may CALL bump_rate',
        has_function_privilege('service_role', 'public.bump_rate(text,integer)', 'EXECUTE')::text, 'true'),

    -- ---- realtime ----
    -- Without this the browser holds a socket and is told nothing.
    (15, 'realtime publishes offerings',
        (exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public'
                    and tablename = 'offerings'))::text, 'true'),

    -- ---- shape ----
    -- `seq bigserial unique` already indexes seq; a second index on it
    -- doubles the write cost of every offering for nothing.
    (16, 'indexes on offerings (pkey + seq, no duplicate)',
        (select count(*)::text from pg_indexes
          where schemaname = 'public' and tablename = 'offerings'), '2'),

    -- ---- state ----
    (17, 'tally and rows agree',
        ((select offerings_count from public.bappa_state where id = 1)
          = (select count(*) from public.offerings))::text, 'true')
)
select
  case when got is not distinct from want then 'PASS' else 'FAIL' end as status,
  label,
  got as found,
  want as expected
from checks
order by (got is not distinct from want), sort;
