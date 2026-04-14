-- Pictureload: Bilderwand (Storage + Metadaten + RLS)
-- Nach dem Anwenden in Supabase: Storage → Buckets prüfen; Realtime für pictureload_images aktivieren.

-- ---------------------------------------------------------------------------
-- Tabelle Metadaten
-- ---------------------------------------------------------------------------

create table if not exists public.pictureload_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  storage_path text not null,
  author_id uuid not null,
  author_display_name text,
  content_type text not null default 'image/jpeg',
  created_at timestamptz not null default now(),
  unique (session_id, storage_path)
);

create index if not exists idx_pictureload_session on public.pictureload_images(session_id);
create index if not exists idx_pictureload_created on public.pictureload_images(session_id, created_at desc);

alter table public.pictureload_images enable row level security;

create policy "pictureload_select_member"
  on public.pictureload_images for select
  using (public.is_session_member(session_id, auth.uid()));

create policy "pictureload_insert_rules"
  on public.pictureload_images for insert
  with check (
    public.is_session_member(session_id, auth.uid())
    and author_id = auth.uid()
    and (
      public.is_session_teacher(session_id, auth.uid())
      or exists (
        select 1 from public.sessions s
        where s.id = session_id
          and s.status = 'active'
          and coalesce((s.permissions->>'pictureload')::boolean, true) = true
      )
    )
  );

create policy "pictureload_delete_teacher"
  on public.pictureload_images for delete
  using (public.is_session_teacher(session_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: öffentlicher Bucket (URLs für Galerie), Upload/Delete über RLS
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('pictureload', 'pictureload', true)
on conflict (id) do update set public = excluded.public;

-- Lesen: öffentliche Objekte im Bucket (für getPublicUrl / CDN)
create policy "pictureload_storage_select"
  on storage.objects for select
  using (bucket_id = 'pictureload');

-- Hochladen: Mitglied der Session im ersten Pfadsegment + Berechtigung
create policy "pictureload_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pictureload'
    and split_part(name, '/', 1) <> ''
    and exists (
      select 1 from public.session_members m
      where m.user_id = auth.uid()
        and m.session_id::text = split_part(name, '/', 1)
    )
    and (
      public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
      or exists (
        select 1 from public.sessions s
        where s.id::text = split_part(name, '/', 1)
          and s.status = 'active'
          and coalesce((s.permissions->>'pictureload')::boolean, true) = true
      )
    )
  );

-- Löschen: nur Lehrkraft derselben Session
create policy "pictureload_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pictureload'
    and public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
  );

-- Optional: Lehrkraft darf eigene Fehlversuche überschreiben (nicht nötig für MVP)
-- Kein globales UPDATE nötig

comment on table public.pictureload_images is 'Pictureload: Metadaten zu Bildern in Storage-Bucket pictureload (Pfad session_id/dateiname).';

grant select, insert, delete on public.pictureload_images to authenticated;

-- Realtime (manuell in Dashboard, falls Migration nicht ausreicht):
--   alter publication supabase_realtime add table public.pictureload_images;
