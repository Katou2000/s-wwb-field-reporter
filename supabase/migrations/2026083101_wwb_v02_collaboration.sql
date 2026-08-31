-- WWB Field Reporter v0.2 collaborative session base
-- Review and run this file in the target Supabase project's SQL Editor.
-- This migration is additive and does not disable RLS.

begin;

-- Recent-session support.
alter table public.session_members
  add column if not exists last_opened_at timestamptz not null default now();

create index if not exists idx_session_members_user_last_opened
  on public.session_members(user_id, last_opened_at desc);

-- The creator must be able to read INSERT ... RETURNING immediately.
drop policy if exists "v02 creators can read own sessions" on public.sessions;
create policy "v02 creators can read own sessions"
on public.sessions for select to authenticated
using (created_by = auth.uid());

drop policy if exists "v02 members can read sessions" on public.sessions;
create policy "v02 members can read sessions"
on public.sessions for select to authenticated
using (public.is_session_member(id));

drop policy if exists "v02 members can read metrics" on public.session_metrics;
create policy "v02 members can read metrics"
on public.session_metrics for select to authenticated
using (public.is_session_member(session_id));

drop policy if exists "v02 members can read events" on public.events;
create policy "v02 members can read events"
on public.events for select to authenticated
using (public.is_session_member(session_id));

drop policy if exists "v02 members can read counters" on public.counter_items;
create policy "v02 members can read counters"
on public.counter_items for select to authenticated
using (public.is_session_member(session_id));

drop policy if exists "v02 members can read instructions" on public.instructions;
create policy "v02 members can read instructions"
on public.instructions for select to authenticated
using (public.is_session_member(session_id));

drop policy if exists "v02 members can read reactions" on public.instruction_reactions;
create policy "v02 members can read reactions"
on public.instruction_reactions for select to authenticated
using (
  exists (
    select 1 from public.instructions i
    where i.id = instruction_reactions.instruction_id and public.is_session_member(i.session_id)
  )
);

drop policy if exists "v02 members can read comments" on public.comments;
create policy "v02 members can read comments"
on public.comments for select to authenticated
using (public.is_session_member(session_id));

-- A role describes context, not edit permission. Both members collaborate.
drop policy if exists "v02 members can update sessions" on public.sessions;
create policy "v02 members can update sessions"
on public.sessions for update to authenticated
using (public.is_session_member(id))
with check (public.is_session_member(id));

drop policy if exists "v02 members can update metrics" on public.session_metrics;
create policy "v02 members can update metrics"
on public.session_metrics for update to authenticated
using (public.is_session_member(session_id))
with check (public.is_session_member(session_id));

drop policy if exists "v02 members can create events" on public.events;
create policy "v02 members can create events"
on public.events for insert to authenticated
with check (public.is_session_member(session_id) and created_by = auth.uid());

drop policy if exists "v02 members can update events" on public.events;
create policy "v02 members can update events"
on public.events for update to authenticated
using (public.is_session_member(session_id))
with check (public.is_session_member(session_id));

drop policy if exists "v02 members can create counters" on public.counter_items;
create policy "v02 members can create counters"
on public.counter_items for insert to authenticated
with check (public.is_session_member(session_id) and created_by = auth.uid());

drop policy if exists "v02 members can update counters" on public.counter_items;
create policy "v02 members can update counters"
on public.counter_items for update to authenticated
using (public.is_session_member(session_id))
with check (public.is_session_member(session_id));

drop policy if exists "v02 members can create instructions" on public.instructions;
create policy "v02 members can create instructions"
on public.instructions for insert to authenticated
with check (public.is_session_member(session_id) and created_by = auth.uid());

drop policy if exists "v02 members can update instructions" on public.instructions;
create policy "v02 members can update instructions"
on public.instructions for update to authenticated
using (public.is_session_member(session_id))
with check (public.is_session_member(session_id));

drop policy if exists "v02 members can create reactions" on public.instruction_reactions;
create policy "v02 members can create reactions"
on public.instruction_reactions for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.instructions i
    where i.id = instruction_reactions.instruction_id and public.is_session_member(i.session_id)
  )
);

drop policy if exists "v02 members can update own reactions" on public.instruction_reactions;
create policy "v02 members can update own reactions"
on public.instruction_reactions for update to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.instructions i
    where i.id = instruction_reactions.instruction_id and public.is_session_member(i.session_id)
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.instructions i
    where i.id = instruction_reactions.instruction_id and public.is_session_member(i.session_id)
  )
);

drop policy if exists "v02 members can create comments" on public.comments;
create policy "v02 members can create comments"
on public.comments for insert to authenticated
with check (public.is_session_member(session_id) and created_by = auth.uid());

drop policy if exists "v02 authors can update comments" on public.comments;
create policy "v02 authors can update comments"
on public.comments for update to authenticated
using (public.is_session_member(session_id) and created_by = auth.uid())
with check (public.is_session_member(session_id) and created_by = auth.uid());

-- Authenticated includes Supabase anonymous users.
grant select, insert, update on public.sessions to authenticated;
grant select, update on public.session_members to authenticated;
grant select, update on public.session_metrics to authenticated;
grant select, insert, update on public.events to authenticated;
grant select, insert, update on public.counter_items to authenticated;
grant select, insert, update on public.instructions to authenticated;
grant select, insert, update on public.instruction_reactions to authenticated;
grant select, insert, update on public.comments to authenticated;
grant select on public.change_log to authenticated;

-- Initial join and rejoin both refresh last_opened_at.
create or replace function public.join_session_by_code(
  p_code text,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  select s.id into v_session_id
  from public.sessions s
  where s.share_code = upper(trim(p_code))
    and s.lifecycle_status <> 'finished'
  limit 1;

  if v_session_id is null then raise exception 'session not found or already finished'; end if;

  insert into public.session_members (session_id, user_id, role, display_name, last_opened_at)
  values (v_session_id, v_user_id, 'requester', nullif(trim(p_display_name), ''), now())
  on conflict (session_id, user_id) do update set
    display_name = coalesce(excluded.display_name, public.session_members.display_name),
    last_opened_at = now();

  return v_session_id;
end;
$$;

revoke execute on function public.join_session_by_code(text, text) from public, anon;
grant execute on function public.join_session_by_code(text, text) to authenticated;

-- Recent sessions are restricted to the current auth.uid(). Enum-like fields are
-- cast to text so the function works whether the project uses enums or checks.
create or replace function public.list_my_sessions()
returns table (
  session_id uuid,
  member_role text,
  display_name text,
  joined_at timestamptz,
  last_opened_at timestamptz,
  session_date date,
  store_name text,
  machine_name text,
  machine_number text,
  lifecycle_status text,
  player_status text,
  player_status_message text,
  share_code text,
  started_at timestamptz,
  ended_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id,
    m.role::text,
    m.display_name,
    m.joined_at,
    m.last_opened_at,
    s.session_date,
    s.store_name,
    s.machine_name,
    s.machine_number,
    s.lifecycle_status::text,
    s.player_status::text,
    s.player_status_message,
    s.share_code,
    s.started_at,
    s.ended_at
  from public.session_members m
  join public.sessions s on s.id = m.session_id
  where m.user_id = auth.uid()
  order by m.last_opened_at desc, s.started_at desc;
$$;

revoke execute on function public.list_my_sessions() from public, anon;
grant execute on function public.list_my_sessions() to authenticated;

create or replace function public.touch_session_member(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.session_members set last_opened_at = now()
  where session_id = p_session_id and user_id = auth.uid();
  if not found then raise exception 'not a session member'; end if;
end;
$$;

revoke execute on function public.touch_session_member(uuid) from public, anon;
grant execute on function public.touch_session_member(uuid) to authenticated;

-- Atomic metric controls avoid lost updates between two clients.
create or replace function public.adjust_session_metric(
  p_session_id uuid,
  p_metric text,
  p_delta integer default 0,
  p_set_value integer default null
)
returns public.session_metrics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.session_metrics;
  v_value integer;
begin
  if auth.uid() is null or not public.is_session_member(p_session_id) then
    raise exception 'not a session member';
  end if;
  if p_metric not in ('current_game', 'total_games', 'normal_games', 'at_games', 'bonus_games') then
    raise exception 'unsupported metric';
  end if;
  if p_set_value is not null then v_value := greatest(p_set_value, 0); end if;

  if p_metric = 'current_game' then
    update public.session_metrics set
      current_game = case when p_set_value is null then greatest(current_game + p_delta, 0) else v_value end,
      updated_by = auth.uid(), updated_at = now()
    where session_id = p_session_id returning * into v_result;
  elsif p_metric = 'total_games' then
    update public.session_metrics set
      total_games = case when p_set_value is null then greatest(total_games + p_delta, 0) else v_value end,
      updated_by = auth.uid(), updated_at = now()
    where session_id = p_session_id returning * into v_result;
  elsif p_metric = 'normal_games' then
    update public.session_metrics set
      normal_games = case when p_set_value is null then greatest(normal_games + p_delta, 0) else v_value end,
      updated_by = auth.uid(), updated_at = now()
    where session_id = p_session_id returning * into v_result;
  elsif p_metric = 'at_games' then
    update public.session_metrics set
      at_games = case when p_set_value is null then greatest(at_games + p_delta, 0) else v_value end,
      updated_by = auth.uid(), updated_at = now()
    where session_id = p_session_id returning * into v_result;
  else
    update public.session_metrics set
      bonus_games = case when p_set_value is null then greatest(bonus_games + p_delta, 0) else v_value end,
      updated_by = auth.uid(), updated_at = now()
    where session_id = p_session_id returning * into v_result;
  end if;

  if v_result.session_id is null then raise exception 'session metrics not found'; end if;
  return v_result;
end;
$$;

revoke execute on function public.adjust_session_metric(uuid, text, integer, integer) from public, anon;
grant execute on function public.adjust_session_metric(uuid, text, integer, integer) to authenticated;

-- Atomic counter increments/decrements.
create or replace function public.adjust_counter_item(p_counter_id uuid, p_delta integer)
returns public.counter_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_result public.counter_items;
begin
  select session_id into v_session_id from public.counter_items where id = p_counter_id;
  if v_session_id is null or auth.uid() is null or not public.is_session_member(v_session_id) then
    raise exception 'not a session member';
  end if;
  update public.counter_items set count = greatest(count + p_delta, 0), updated_at = now()
  where id = p_counter_id returning * into v_result;
  return v_result;
end;
$$;

revoke execute on function public.adjust_counter_item(uuid, integer) from public, anon;
grant execute on function public.adjust_counter_item(uuid, integer) to authenticated;

-- Session finish and finish event are committed atomically and idempotently.
create or replace function public.finish_session(p_session_id uuid)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.sessions;
begin
  if auth.uid() is null or not public.is_session_member(p_session_id) then
    raise exception 'not a session member';
  end if;

  select * into v_result from public.sessions where id = p_session_id for update;
  if v_result.id is null then raise exception 'session not found'; end if;
  if v_result.lifecycle_status::text = 'finished' then return v_result; end if;

  update public.sessions set
    lifecycle_status = 'finished',
    player_status = 'finished',
    player_status_message = null,
    player_status_updated_at = now(),
    ended_at = now()
  where id = p_session_id returning * into v_result;

  insert into public.events (session_id, event_type, label, created_by)
  values (p_session_id, 'finish', 'セッション終了', auth.uid());
  return v_result;
end;
$$;

revoke execute on function public.finish_session(uuid) from public, anon;
grant execute on function public.finish_session(uuid) to authenticated;

-- Add tables to Realtime only when not already present.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'sessions', 'session_metrics', 'events', 'counter_items',
    'instructions', 'instruction_reactions', 'comments'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

commit;
