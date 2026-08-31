-- WWB Field Reporter v0.2 finish_session recovery migration
-- Apply after 2026083101_wwb_v02_collaboration.sql.

begin;

-- Finish the session and append its finish event in the same transaction.
-- Repeated calls are idempotent: an already-finished session is returned as-is.
-- Drop first so an older function with a different parameter name/return type
-- cannot prevent PostgREST from exposing the p_session_id signature.
drop function if exists public.finish_session(uuid);

create or replace function public.finish_session(p_session_id uuid)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.sessions;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.session_members sm
    where sm.session_id = p_session_id
      and sm.user_id = v_user_id
  ) then
    raise exception 'not a session member' using errcode = '42501';
  end if;

  select *
  into v_result
  from public.sessions
  where id = p_session_id
  for update;

  if v_result.id is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if v_result.lifecycle_status::text = 'finished' then
    return v_result;
  end if;

  update public.sessions
  set
    lifecycle_status = 'finished',
    player_status = 'finished',
    player_status_message = null,
    player_status_updated_at = now(),
    ended_at = now()
  where id = p_session_id
  returning * into v_result;

  insert into public.events (session_id, event_type, label, created_by)
  values (p_session_id, 'finish', 'セッション終了', v_user_id);

  return v_result;
end;
$$;

revoke execute on function public.finish_session(uuid) from public, anon;
grant execute on function public.finish_session(uuid) to authenticated;

-- Ask PostgREST to refresh the RPC signature without waiting for cache polling.
notify pgrst, 'reload schema';

commit;
