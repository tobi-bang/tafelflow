-- Pictureload: Moderation (pending / approved / rejected) + SELECT/UPDATE RLS + Trigger + Storage-Leseregeln
-- Voraussetzung: Migration 007 (Pictureload) bereits angewendet.

alter table public.pictureload_images
  add column if not exists moderation_status text not null default 'approved'
  check (moderation_status in ('pending', 'approved', 'rejected'));

update public.pictureload_images set moderation_status = 'approved' where moderation_status is null;

drop policy if exists "pictureload_select_member" on public.pictureload_images;
drop policy if exists "pictureload_select_rules" on public.pictureload_images;

create policy "pictureload_select_rules"
  on public.pictureload_images for select
  to authenticated
  using (
    public.is_session_member(session_id, auth.uid())
    and (
      public.is_session_teacher(session_id, auth.uid())
      or moderation_status = 'approved'
    )
  );

create policy "pictureload_update_teacher"
  on public.pictureload_images for update
  to authenticated
  using (public.is_session_teacher(session_id, auth.uid()))
  with check (public.is_session_teacher(session_id, auth.uid()));

create or replace function public.pictureload_images_set_default_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  need_mod boolean := false;
  is_t boolean := false;
begin
  select coalesce((s.permissions->>'pictureloadModeration')::boolean, false)
    into need_mod
  from public.sessions s
  where s.id = new.session_id;

  select public.is_session_teacher(new.session_id, new.author_id) into is_t;

  if is_t then
    new.moderation_status := 'approved';
  elsif need_mod then
    new.moderation_status := 'pending';
  else
    new.moderation_status := 'approved';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pictureload_moderation_bi on public.pictureload_images;
create trigger trg_pictureload_moderation_bi
  before insert on public.pictureload_images
  for each row
  execute function public.pictureload_images_set_default_moderation();

grant update on public.pictureload_images to authenticated;

comment on column public.pictureload_images.moderation_status is 'Pictureload: pending = Wartet auf Freigabe; approved = auf Wand sichtbar; rejected = abgelehnt (nur LK).';

-- Öffentlicher Bucket: Lesen nur für freigegebene Objekte oder Lehrkraft der Session (Pfad: session_id/…)
drop policy if exists "pictureload_storage_select" on storage.objects;

create policy "pictureload_storage_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pictureload'
    and (
      public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
      or exists (
        select 1 from public.pictureload_images i
        where i.storage_path = name
          and i.moderation_status = 'approved'
          and public.is_session_member(i.session_id, auth.uid())
      )
    )
  );
