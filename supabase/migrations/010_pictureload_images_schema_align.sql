-- Pictureload: Tabellenschema an Frontend + Migration 008 angleichen.
-- Sicher, wenn bereits 007+008 vollständig: ADD COLUMN IF NOT EXISTS / OR REPLACE greifen idempotent.

-- ---------------------------------------------------------------------------
-- Spalte moderation_status (fehlt, wenn nur 007 ohne 008 ausgeführt wurde)
-- ---------------------------------------------------------------------------

alter table public.pictureload_images
  add column if not exists moderation_status text;

update public.pictureload_images
set moderation_status = 'approved'
where moderation_status is null
   or moderation_status not in ('pending', 'approved', 'rejected');

alter table public.pictureload_images
  alter column moderation_status set default 'approved';

alter table public.pictureload_images
  alter column moderation_status set not null;

alter table public.pictureload_images
  drop constraint if exists pictureload_images_moderation_status_check;

alter table public.pictureload_images
  add constraint pictureload_images_moderation_status_check
  check (moderation_status in ('pending', 'approved', 'rejected'));

comment on column public.pictureload_images.moderation_status is
  'Pictureload: pending = Wartet auf Freigabe; approved = auf Wand sichtbar; rejected = abgelehnt (nur LK).';

-- ---------------------------------------------------------------------------
-- Trigger: Standard-Moderation bei INSERT (wie 008)
-- ---------------------------------------------------------------------------

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
