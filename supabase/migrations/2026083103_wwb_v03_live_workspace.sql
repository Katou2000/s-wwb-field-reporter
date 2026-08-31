-- WWB Field Reporter v0.3 live workspace
-- Apply after 2026083101 and 2026083102.

begin;

-- Shared live counters and a durable current-medal value.
alter table public.counter_items
  add column if not exists show_on_live boolean not null default false;

alter table public.session_metrics
  add column if not exists current_medals integer not null default 0;

alter table public.events
  add column if not exists acquired_medals integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.session_metrics'::regclass
      and conname = 'session_metrics_current_medals_nonnegative'
  ) then
    alter table public.session_metrics
      add constraint session_metrics_current_medals_nonnegative
      check (current_medals >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_acquired_medals_nonnegative'
  ) then
    alter table public.events
      add constraint events_acquired_medals_nonnegative
      check (acquired_medals is null or acquired_medals >= 0);
  end if;
end;
$$;

-- Existing sessions inherit their latest payout snapshot, or their starting medals.
update public.session_metrics sm
set current_medals = greatest(coalesce(
  (
    select e.payout_medals
    from public.events e
    where e.session_id = sm.session_id
      and e.event_type::text = 'payout_update'
      and e.voided_at is null
      and e.payout_medals is not null
    order by e.created_at desc
    limit 1
  ),
  (select s.starting_medals from public.sessions s where s.id = sm.session_id),
  0
)::integer, 0);

-- New session_metrics rows start from sessions.starting_medals.
create or replace function public.initialize_session_current_medals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_medals = 0 then
    select greatest(coalesce(s.starting_medals, 0)::integer, 0)
    into new.current_medals
    from public.sessions s
    where s.id = new.session_id;
    new.current_medals := coalesce(new.current_medals, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_v03_initialize_current_medals on public.session_metrics;
create trigger trg_v03_initialize_current_medals
before insert on public.session_metrics
for each row execute function public.initialize_session_current_medals();

revoke execute on function public.initialize_session_current_medals() from public, anon, authenticated;

-- Allow the new independent question stamp while retaining legacy done rows.
do $$
declare
  v_type_kind "char";
  v_type_schema text;
  v_type_name text;
  v_constraint record;
begin
  select t.typtype, n.nspname, t.typname
  into v_type_kind, v_type_schema, v_type_name
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  join pg_namespace n on n.oid = t.typnamespace
  where a.attrelid = 'public.instruction_reactions'::regclass
    and a.attname = 'reaction'
    and not a.attisdropped;

  if v_type_kind = 'e' then
    execute format(
      'alter type %I.%I add value if not exists %L',
      v_type_schema, v_type_name, 'question'
    );
  else
    for v_constraint in
      select conname
      from pg_constraint
      where conrelid = 'public.instruction_reactions'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%reaction%'
    loop
      execute format(
        'alter table public.instruction_reactions drop constraint %I',
        v_constraint.conname
      );
    end loop;

    alter table public.instruction_reactions
      add constraint instruction_reactions_reaction_check
      check (reaction::text in ('seen', 'acknowledged', 'done', 'question'));
  end if;
end;
$$;

-- Remove the old one-reaction-per-user key, regardless of its constraint name.
do $$
declare
  v_constraint record;
  v_index record;
  v_has_primary_key boolean;
begin
  for v_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.instruction_reactions'::regclass
      and c.contype in ('p', 'u')
      and cardinality(c.conkey) = 2
      and 2 = (
        select count(*)
        from unnest(c.conkey) key(attnum)
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname in ('instruction_id', 'user_id')
      )
  loop
    execute format(
      'alter table public.instruction_reactions drop constraint %I',
      v_constraint.conname
    );
  end loop;

  -- Remove an equivalent standalone unique index if the original schema used one.
  for v_index in
    select i.indexrelid::regclass::text as index_name
    from pg_index i
    where i.indrelid = 'public.instruction_reactions'::regclass
      and i.indisunique
      and i.indnkeyatts = 2
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      and 2 = (
        select count(*)
        from unnest(i.indkey::smallint[]) key(attnum)
        join pg_attribute a
          on a.attrelid = i.indrelid and a.attnum = key.attnum
        where a.attname in ('instruction_id', 'user_id')
      )
  loop
    execute 'drop index ' || v_index.index_name;
  end loop;

  alter table public.instruction_reactions
    alter column reaction set not null;

  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.instruction_reactions'::regclass
      and contype = 'p'
  ) into v_has_primary_key;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.instruction_reactions'::regclass
      and c.contype in ('p', 'u')
      and cardinality(c.conkey) = 3
      and 3 = (
        select count(*)
        from unnest(c.conkey) key(attnum)
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname in ('instruction_id', 'user_id', 'reaction')
      )
  ) then
    if v_has_primary_key then
      alter table public.instruction_reactions
        add constraint instruction_reactions_instruction_user_reaction_key
        unique (instruction_id, user_id, reaction);
    else
      alter table public.instruction_reactions
        add constraint instruction_reactions_pkey
        primary key (instruction_id, user_id, reaction);
    end if;
  end if;
end;
$$;

drop policy if exists "v03 members can delete own reactions" on public.instruction_reactions;
create policy "v03 members can delete own reactions"
on public.instruction_reactions for delete to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.instructions i
    where i.id = instruction_reactions.instruction_id
      and public.is_session_member(i.session_id)
  )
);

drop policy if exists "v03 members can read session members" on public.session_members;
create policy "v03 members can read session members"
on public.session_members for select to authenticated
using (public.is_session_member(session_id));

grant select, update on public.counter_items to authenticated;
grant select, update on public.session_metrics to authenticated;
grant select, insert on public.events to authenticated;
grant select, insert, update, delete on public.instruction_reactions to authenticated;
grant select on public.session_members to authenticated;

-- Atomic current-medal adjustment plus an auditable payout snapshot event.
create or replace function public.adjust_current_medals(
  p_session_id uuid,
  p_delta integer default 0,
  p_set_value integer default null
)
returns public.session_metrics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.session_metrics;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_session_member(p_session_id) then
    raise exception 'not a session member' using errcode = '42501';
  end if;

  update public.session_metrics
  set
    current_medals = case
      when p_set_value is null then greatest(current_medals + p_delta, 0)
      else greatest(p_set_value, 0)
    end,
    updated_by = v_user_id,
    updated_at = now()
  where session_id = p_session_id
  returning * into v_result;

  if v_result.session_id is null then
    raise exception 'session metrics not found' using errcode = 'P0002';
  end if;

  insert into public.events (
    session_id, event_type, label, payout_medals, created_by
  ) values (
    p_session_id, 'payout_update', '現在持ちメダル', v_result.current_medals, v_user_id
  );

  return v_result;
end;
$$;

revoke execute on function public.adjust_current_medals(uuid, integer, integer) from public, anon;
grant execute on function public.adjust_current_medals(uuid, integer, integer) to authenticated;

-- Shared live-counter visibility with a four-item session limit.
create or replace function public.set_counter_live_visibility(
  p_counter_id uuid,
  p_show boolean
)
returns public.counter_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_result public.counter_items;
begin
  select session_id into v_session_id
  from public.counter_items
  where id = p_counter_id;

  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_session_id is null or not public.is_session_member(v_session_id) then
    raise exception 'not a session member' using errcode = '42501';
  end if;
  if p_show and (
    select count(*) from public.counter_items
    where session_id = v_session_id
      and show_on_live
      and id <> p_counter_id
  ) >= 4 then
    raise exception 'live counter limit reached';
  end if;

  update public.counter_items
  set show_on_live = p_show, updated_at = now()
  where id = p_counter_id
  returning * into v_result;
  return v_result;
end;
$$;

revoke execute on function public.set_counter_live_visibility(uuid, boolean) from public, anon;
grant execute on function public.set_counter_live_visibility(uuid, boolean) to authenticated;

-- Add live values to the existing recent-session RPC.
drop function if exists public.list_my_sessions();
create function public.list_my_sessions()
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
  ended_at timestamptz,
  starting_medals numeric,
  lend_yen_unit numeric,
  lend_medals_per_unit numeric,
  current_game bigint,
  current_medals bigint,
  cash_investment_yen numeric
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
    s.ended_at,
    s.starting_medals::numeric,
    s.lend_yen_unit::numeric,
    s.lend_medals_per_unit::numeric,
    coalesce(sm.current_game, 0)::bigint,
    coalesce(sm.current_medals, s.starting_medals, 0)::bigint,
    coalesce((
      select sum(e.cash_yen::numeric)
      from public.events e
      where e.session_id = s.id
        and e.event_type::text = 'cash_investment'
        and e.voided_at is null
    ), 0::numeric)
  from public.session_members m
  join public.sessions s on s.id = m.session_id
  left join public.session_metrics sm on sm.session_id = s.id
  where m.user_id = auth.uid()
  order by m.last_opened_at desc, s.started_at desc;
$$;

revoke execute on function public.list_my_sessions() from public, anon;
grant execute on function public.list_my_sessions() to authenticated;

-- session_members is useful for author labels and can change when somebody joins.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'session_members'
  ) then
    alter publication supabase_realtime add table public.session_members;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
