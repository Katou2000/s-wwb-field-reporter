-- WWB Field Reporter v0.4 visibility / image sharing / cleanup
-- Apply after 2026083103_wwb_v03_live_workspace.sql.

begin;

-- 1) Event tags are user-defined metadata shown on the upper-right of log cards.
alter table public.events
  add column if not exists tag text;

-- 2) Session image metadata. Actual files live in Supabase Storage.
create table if not exists public.session_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  storage_path text not null unique,
  caption text,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_session_images_session_created
  on public.session_images(session_id, created_at desc);

alter table public.session_images enable row level security;

drop policy if exists "v04 members can read session images" on public.session_images;
create policy "v04 members can read session images"
on public.session_images for select to authenticated
using (public.is_session_member(session_id));

drop policy if exists "v04 members can create session images" on public.session_images;
create policy "v04 members can create session images"
on public.session_images for insert to authenticated
with check (public.is_session_member(session_id) and uploaded_by = auth.uid());

drop policy if exists "v04 members can delete session images" on public.session_images;
create policy "v04 members can delete session images"
on public.session_images for delete to authenticated
using (public.is_session_member(session_id));

grant select, insert, delete on public.session_images to authenticated;

-- 3) Private image bucket. Client-side compression keeps typical files small.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wwb-session-images',
  'wwb-session-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage paths are <session_uuid>/<object_uuid>.<ext>. Compare as text so
-- unrelated bucket object names can never fail on a UUID cast.
create or replace function public.can_access_session_storage(p_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.session_members m
    where m.user_id = auth.uid()
      and m.session_id::text = split_part(p_name, '/', 1)
  );
$$;

revoke execute on function public.can_access_session_storage(text) from public, anon;
grant execute on function public.can_access_session_storage(text) to authenticated;

drop policy if exists "v04 members can read image objects" on storage.objects;
create policy "v04 members can read image objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'wwb-session-images'
  and public.can_access_session_storage(name)
);

drop policy if exists "v04 members can upload image objects" on storage.objects;
create policy "v04 members can upload image objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'wwb-session-images'
  and public.can_access_session_storage(name)
);

drop policy if exists "v04 members can delete image objects" on storage.objects;
create policy "v04 members can delete image objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'wwb-session-images'
  and public.can_access_session_storage(name)
);

-- 4) Creator-only hard delete for a finished session.
-- Storage objects are removed by the authenticated client immediately before this RPC.
create or replace function public.hard_delete_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_creator uuid;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select created_by, lifecycle_status::text
  into v_creator, v_status
  from public.sessions
  where id = p_session_id;

  if v_creator is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_creator <> v_user_id then
    raise exception 'only session creator can hard delete' using errcode = '42501';
  end if;
  if v_status <> 'finished' then
    raise exception 'session must be finished before hard delete';
  end if;

  delete from public.sessions where id = p_session_id;
  -- record_change() may have written a final audit row after DELETE.
  delete from public.change_log where session_id = p_session_id;
end;
$$;

revoke execute on function public.hard_delete_session(uuid) from public, anon;
grant execute on function public.hard_delete_session(uuid) to authenticated;

-- 5) Realtime image metadata.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'session_images'
  ) then
    alter publication supabase_realtime add table public.session_images;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
