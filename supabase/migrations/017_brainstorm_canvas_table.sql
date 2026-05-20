-- Ideenwand: Tabelle brainstorm_canvas + RLS + Realtime-Hinweis
-- Behebt: „Could not find the table public.brainstorm_canvas in the schema cache“
-- Idempotent – im Supabase SQL Editor ausführen.

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

comment on table public.brainstorm_canvas is 'Ideenwand: Hintergrundvorlage + Lehrer-Annotationen (JSON) pro Sitzung.';
comment on column public.brainstorm_canvas.annotations is 'Array: {id, kind, x, y, w?, h?, x2?, y2?, text?, color?}';

alter table public.brainstorm_canvas enable row level security;

drop policy if exists "brainstorm_canvas_select_member" on public.brainstorm_canvas;
drop policy if exists "brainstorm_canvas_upsert_teacher" on public.brainstorm_canvas;
drop policy if exists "brainstorm_canvas_update_teacher" on public.brainstorm_canvas;
drop policy if exists "brainstorm_canvas_delete_teacher" on public.brainstorm_canvas;

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

-- Storage-Bucket (falls 016 noch nicht lief)
insert into storage.buckets (id, name, public)
values ('brainstorm-templates', 'brainstorm-templates', true)
on conflict (id) do update
  set public = excluded.public,
      name = excluded.name;

-- Realtime (einmalig; bei „already member“ ignorieren):
-- alter publication supabase_realtime add table public.brainstorm_canvas;
