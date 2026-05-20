-- Ideen sammeln: Storage-Bucket brainstorm-templates sicherstellen
-- Behebt Client-Fehler „Bucket not found“ (404), wenn Migration 014 noch nicht lief.
-- Idempotent: im SQL Editor beliebig oft ausführbar.

insert into storage.buckets (id, name, public)
values ('brainstorm-templates', 'brainstorm-templates', true)
on conflict (id) do update
  set public = excluded.public,
      name = excluded.name;

drop policy if exists "brainstorm_storage_select" on storage.objects;
drop policy if exists "brainstorm_storage_insert" on storage.objects;
drop policy if exists "brainstorm_storage_update" on storage.objects;
drop policy if exists "brainstorm_storage_delete" on storage.objects;

-- Öffentlicher Bucket: Lesen aller Objekte (getPublicUrl / html2canvas)
create policy "brainstorm_storage_select"
  on storage.objects for select
  using (bucket_id = 'brainstorm-templates');

-- Upload: nur Lehrkraft der Session (erstes Pfadsegment = session_id)
create policy "brainstorm_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brainstorm-templates'
    and split_part(name, '/', 1) <> ''
    and public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
  );

-- Überschreiben (optional, gleiche Regel wie Insert)
create policy "brainstorm_storage_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'brainstorm-templates'
    and public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
  )
  with check (
    bucket_id = 'brainstorm-templates'
    and public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
  );

create policy "brainstorm_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brainstorm-templates'
    and public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
  );
