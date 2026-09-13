-- BAPPA 2026 -- letting go of the data too.
--
-- The piece promises impermanence. A database that quietly keeps every
-- offering forever makes that promise false, however anonymous the rows
-- are -- so at Visarjan what is left of people's offerings goes with him.
--
-- Additive: the first migration is already applied in production and is
-- not edited. Safe to run again.

-- ------------------------------------------------------------------
-- Remembering that it happened
-- ------------------------------------------------------------------

alter table public.bappa_state
  add column if not exists dissolved_at timestamptz;

comment on column public.bappa_state.dissolved_at is
  'When the offerings were let go. Null until Visarjan completes.';

-- ------------------------------------------------------------------
-- The letting go
-- ------------------------------------------------------------------

-- What survives is the number, and only the number: how many people left
-- something with him. That is the aggregate the piece is about and it
-- identifies nobody.
--
-- What goes is every individual offering -- its type, its intensity, the
-- seed derived from what somebody wrote, and the time they wrote it --
-- along with the rate-limit buckets, which are the only rows that were
-- ever derived from an address at all, hashed though they are.
--
-- Idempotent by design: it records the moment on the first call and does
-- nothing on every call after, so it can be reached from a request path
-- without needing to be scheduled or coordinated.
create or replace function public.dissolve_offerings()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  already timestamptz;
begin
  select dissolved_at into already from public.bappa_state where id = 1;
  if already is not null then
    return already;
  end if;

  -- The tally is deliberately not reset. He was made by this many people
  -- and that remains true after he has gone; it is the individual traces
  -- that do not need to outlive him.
  delete from public.offerings;
  delete from public.rate_limits;

  update public.bappa_state
     set dissolved_at = now()
   where id = 1
  returning dissolved_at into already;

  return already;
end;
$$;

-- Same boundary as everything else: the server may do this, the public
-- key may not. FROM PUBLIC is the part that matters -- Postgres grants
-- EXECUTE to PUBLIC by default and anon inherits it, so naming anon
-- alone would leave a stranger able to erase every offering.
revoke all on function public.dissolve_offerings() from public, anon, authenticated;
grant execute on function public.dissolve_offerings() to service_role;
