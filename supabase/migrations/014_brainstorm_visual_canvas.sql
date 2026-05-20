-- Ideen sammeln: visuelle Arbeitsfläche (Hintergrundbild + Lehrer-Annotationen)

create table if not exists public.brainstorm_canvas (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  background_path text,
  bg_x double precision not null default 80,
  bg_y double precision not null default 80,
  bg_scale double precision not null default 1,
  bg_locked boolean not null default false,
  annotations jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.brainstorm_canvas drop constraint if exists brainstorm_canvas_bg_scale_check;
alter table public.brainstorm_canvas add constraint brainstorm_canvas_bg_scale_check
  check (bg_scale >= 0.15 and bg_scale <= 4);

create index if not exists idx_brainstorm_canvas_updated on public.brainstorm_canvas(updated_at desc);

comment on table public.brainstorm_canvas is 'Ideenwand: Hintergrundvorlage und Lehrer-Annotationen pro Sitzung.';
comment on column public.brainstorm_canvas.annotations is 'JSON-Array: text, arrow, rect, circle, highlight';

alter table public.brainstorm_canvas enable row level security;

create policy "brainstorm_canvas_select_member"
  on public.brainstorm_canvas for select
  using (public.is_session_member(session_id, auth.uid()));

create policy "brainstorm_canvas_upsert_teacher"
  on public.brainstorm_canvas for insert
  with check (public.is_session_teacher(session_id, auth.uid()));

create policy "brainstorm_canvas_update_teacher"
  on public.brainstorm_canvas for update
  using (public.is_session_teacher(session_id, auth.uid()))
  with check (public.is_session_teacher(session_id, auth.uid()));

create policy "brainstorm_canvas_delete_teacher"
  on public.brainstorm_canvas for delete
  using (public.is_session_teacher(session_id, auth.uid()));

grant select, insert, update, delete on public.brainstorm_canvas to authenticated;

-- Storage-Bucket für Vorlagen (öffentliche URLs)
insert into storage.buckets (id, name, public)
values ('brainstorm-templates', 'brainstorm-templates', true)
on conflict (id) do update
  set public = excluded.public,
      name = excluded.name;

create policy "brainstorm_storage_select"
  on storage.objects for select
  using (bucket_id = 'brainstorm-templates');

create policy "brainstorm_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brainstorm-templates'
    and split_part(name, '/', 1) <> ''
    and public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
  );

create policy "brainstorm_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brainstorm-templates'
    and public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
  );

-- Realtime (falls noch nicht in Publication):
-- alter publication supabase_realtime add table public.brainstorm_canvas;
