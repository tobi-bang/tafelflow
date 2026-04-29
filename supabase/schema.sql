-- TafelFlow: Supabase Schema + RLS (in SQL Editor des Projekts ausführen)
-- Voraussetzung: Authentication → Anonymous sign-ins aktivieren

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('teacher', 'student')),
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  pin_hash text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'locked', 'archived')),
  presentation_mode boolean not null default false,
  permissions jsonb not null default '{
    "writeBoard": true,
    "drawBoard": true,
    "addSticky": true,
    "moveSticky": true,
    "organizeBrainstorm": true,
    "answerPoll": true,
    "submitWord": true,
    "livePoll": true,
    "peerFeedback": true,
    "pictureload": true,
    "pictureloadModeration": false,
    "buzzer": true,
    "ideasRequireDisplayName": true,
    "ideasDefaultScale": 1.35
  }'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.session_members (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('teacher', 'student')),
  display_name text,
  primary key (session_id, user_id)
);

create index if not exists idx_session_members_user on public.session_members(user_id);

create table if not exists public.board_objects (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  type text not null,
  data jsonb not null default '[]'::jsonb,
  color text not null default '#000000',
  author_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_board_session on public.board_objects(session_id);

create table if not exists public.stickies (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  content text not null,
  color text not null,
  author_name text not null default 'Anonym',
  author_id uuid not null,
  x double precision not null default 0,
  y double precision not null default 0,
  status text not null default 'pending' check (status in ('pending', 'published')),
  sticky_type text not null default 'note' check (sticky_type in ('note', 'heading')),
  under_heading_id uuid references public.stickies(id) on delete set null,
  display_scale double precision not null default 1 check (display_scale >= 0.5 and display_scale <= 4),
  created_at timestamptz not null default now()
);

create index if not exists idx_stickies_heading on public.stickies(under_heading_id);

create index if not exists idx_stickies_session on public.stickies(session_id);

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question text not null,
  type text not null default 'single',
  options jsonb default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_polls_session on public.polls(session_id);

create table if not exists public.poll_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  poll_id uuid not null references public.polls(id) on delete cascade,
  author_id uuid not null,
  answer text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_poll_resp_session on public.poll_responses(session_id);
create index if not exists idx_poll_resp_poll on public.poll_responses(poll_id);

create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  word text not null,
  author_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_words_session on public.words(session_id);

create table if not exists public.pictureload_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  storage_path text not null,
  author_id uuid not null,
  author_display_name text,
  content_type text not null default 'image/jpeg',
  moderation_status text not null default 'approved' check (moderation_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (session_id, storage_path)
);

create index if not exists idx_pictureload_session on public.pictureload_images(session_id);
create index if not exists idx_pictureload_created on public.pictureload_images(session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen (SECURITY DEFINER für konsistente Prüfung)
-- ---------------------------------------------------------------------------

create or replace function public.is_session_member(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.session_members m
    where m.session_id = p_session_id and m.user_id = p_user_id
  );
$$;

create or replace function public.is_session_teacher(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.session_members m
    where m.session_id = p_session_id and m.user_id = p_user_id and m.role = 'teacher'
  );
$$;

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

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.tf_random_room_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..8 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.create_session(p_name text, p_pin text)
returns table (session_id uuid, room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  code text;
  attempts int := 0;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher') then
    raise exception 'Nur Lehrkräfte dürfen Sitzungen erstellen';
  end if;
  if length(trim(p_name)) < 1 then
    raise exception 'Name erforderlich';
  end if;
  if length(p_pin) < 4 then
    raise exception 'PIN mindestens 4 Zeichen';
  end if;

  loop
    code := public.tf_random_room_code();
    exit when not exists (select 1 from public.sessions s where s.room_code = code);
    attempts := attempts + 1;
    if attempts > 50 then
      raise exception 'Raumcode konnte nicht erzeugt werden';
    end if;
  end loop;

  insert into public.sessions (room_code, pin_hash, name, status, presentation_mode, permissions)
  values (
    code,
    crypt(p_pin, gen_salt('bf')),
    trim(p_name),
    'active',
    false,
    '{"writeBoard":true,"drawBoard":true,"addSticky":true,"moveSticky":true,"organizeBrainstorm":true,"answerPoll":true,"submitWord":true,"livePoll":true,"peerFeedback":true,"pictureload":true,"pictureloadModeration":false,"buzzer":true,"ideasRequireDisplayName":true,"ideasDefaultScale":1.35}'::jsonb
  )
  returning id into new_id;

  insert into public.session_members (session_id, user_id, role, display_name)
  values (new_id, auth.uid(), 'teacher', 'Lehrkraft');

  return query select new_id, code;
end;
$$;

create or replace function public.get_session_join_preview(p_room_code text)
returns table (session_id uuid, session_name text, ideas_require_display_name boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := upper(trim(p_room_code));
begin
  return query
  select
    s.id,
    s.name,
    coalesce((s.permissions->>'ideasRequireDisplayName')::boolean, true)
  from public.sessions s
  where upper(trim(s.room_code)) = c
    and s.status = 'active'
  limit 1;
end;
$$;

create or replace function public.join_session_as_student(p_room_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  c text := upper(trim(p_room_code));
  require_name boolean;
  dn text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;

  select
    s.id,
    coalesce((s.permissions->>'ideasRequireDisplayName')::boolean, true)
  into sid, require_name
  from public.sessions s
  where upper(trim(s.room_code)) = c
    and s.status = 'active'
  limit 1;

  if sid is null then
    raise exception 'Sitzung nicht gefunden';
  end if;

  if require_name and length(trim(coalesce(p_display_name, ''))) < 1 then
    raise exception 'Name erforderlich';
  end if;

  dn := case
    when require_name then trim(p_display_name)
    else nullif(trim(coalesce(p_display_name, '')), '')
  end;

  insert into public.session_members (session_id, user_id, role, display_name)
  values (sid, auth.uid(), 'student', dn)
  on conflict (session_id, user_id) do update
    set display_name = excluded.display_name,
        role = case when session_members.role = 'teacher' then 'teacher' else 'student' end;

  return sid;
end;
$$;

create or replace function public.join_session_as_teacher(p_room_code text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  ph text;
  c text := upper(trim(p_room_code));
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;

  select s.id, s.pin_hash into sid, ph from public.sessions s where upper(trim(s.room_code)) = c limit 1;
  if sid is null then
    raise exception 'Sitzung nicht gefunden';
  end if;
  if ph is null or not (ph = crypt(p_pin, ph)) then
    raise exception 'Falscher Raumcode oder PIN';
  end if;

  insert into public.session_members (session_id, user_id, role, display_name)
  values (sid, auth.uid(), 'teacher', 'Lehrkraft')
  on conflict (session_id, user_id) do update
    set role = 'teacher';

  return sid;
end;
$$;

create or replace function public.assign_sticky_heading(
  p_sticky_id uuid,
  p_under_heading_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  st text;
begin
  select session_id, sticky_type into sid, st from public.stickies where id = p_sticky_id;
  if sid is null or st <> 'note' then
    raise exception 'Ungültige Karte';
  end if;
  if p_under_heading_id is not null then
    if not exists (
      select 1 from public.stickies h
      where h.id = p_under_heading_id and h.session_id = sid and h.sticky_type = 'heading'
    ) then
      raise exception 'Ungültige Überschrift';
    end if;
  end if;

  if public.is_session_teacher(sid, auth.uid()) then
    update public.stickies set under_heading_id = p_under_heading_id where id = p_sticky_id;
    return;
  end if;

  if exists (
    select 1 from public.sessions s
    where s.id = sid and s.status = 'active'
      and coalesce((s.permissions->>'organizeBrainstorm')::boolean, false) = true
      and coalesce((s.permissions->>'moveSticky')::boolean, false) = true
  ) and public.is_session_member(sid, auth.uid()) then
    update public.stickies set under_heading_id = p_under_heading_id where id = p_sticky_id;
    return;
  end if;

  raise exception 'Keine Berechtigung';
end;
$$;

-- ---------------------------------------------------------------------------
-- Auth: Profilzeile für jeden neuen auth.users-Eintrag (Registrierung, Anonymous)
-- Standardrolle student – Lehrkraft: role in profiles auf teacher setzen (SQL/Table Editor)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Realtime: Unter Database → Replication in Supabase die Tabellen aktivieren
-- oder einzeln (bei Fehler „already member“ ignorieren):
--   alter publication supabase_realtime add table public.sessions;
--   ... board_objects, stickies, polls, poll_responses, words, pictureload_images,
--   buzzer_sessions, buzzer_events, buzzer_participants
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.sessions enable row level security;
alter table public.profiles enable row level security;
alter table public.session_members enable row level security;
alter table public.board_objects enable row level security;
alter table public.stickies enable row level security;
alter table public.polls enable row level security;
alter table public.poll_responses enable row level security;
alter table public.words enable row level security;
alter table public.pictureload_images enable row level security;

-- sessions
create policy "sessions_select_member"
  on public.sessions for select
  using (
    public.is_session_teacher(id, auth.uid())
    or (
      public.is_session_member(id, auth.uid())
      and status = 'active'
    )
  );

create policy "sessions_update_teacher"
  on public.sessions for update
  using (public.is_session_teacher(id, auth.uid()))
  with check (public.is_session_teacher(id, auth.uid()));

create policy "sessions_delete_teacher"
  on public.sessions for delete
  using (public.is_session_teacher(id, auth.uid()));

-- session_members: nur eigene Zeilen lesen; Lehrkräfte dürfen alle Mitglieder derselben Session sehen (optional vereinfacht: nur eigene)
create policy "session_members_select_own_or_teacher"
  on public.session_members for select
  using (
    user_id = auth.uid()
    or public.is_session_teacher(session_id, auth.uid())
  );

-- Kein direktes INSERT/UPDATE/DELETE für Clients (nur RPCs security definer)
-- Keine Policies = kein direkter Zugriff

-- board_objects
create policy "board_select_member"
  on public.board_objects for select
  using (public.is_session_member(session_id, auth.uid()));

create policy "board_insert_rules"
  on public.board_objects for insert
  with check (
    public.is_session_member(session_id, auth.uid())
    and author_id = auth.uid()
    and (
      public.is_session_teacher(session_id, auth.uid())
      or (
        exists (
          select 1 from public.sessions s
          where s.id = session_id
            and s.status = 'active'
            and coalesce((s.permissions->>'drawBoard')::boolean, false) = true
        )
      )
    )
  );

create policy "board_delete_teacher"
  on public.board_objects for delete
  using (public.is_session_teacher(session_id, auth.uid()));

-- stickies
create policy "stickies_select_member"
  on public.stickies for select
  using (public.is_session_member(session_id, auth.uid()));

create policy "stickies_insert_rules"
  on public.stickies for insert
  with check (
    public.is_session_member(session_id, auth.uid())
    and author_id = auth.uid()
    and coalesce(sticky_type, 'note') = 'note'
    and (
      public.is_session_teacher(session_id, auth.uid())
      or (
        exists (
          select 1 from public.sessions s
          where s.id = session_id
            and s.status = 'active'
            and coalesce((s.permissions->>'addSticky')::boolean, false) = true
        )
      )
    )
  );

create policy "stickies_insert_teacher_headings"
  on public.stickies for insert
  with check (
    public.is_session_teacher(session_id, auth.uid())
    and author_id = auth.uid()
    and sticky_type = 'heading'
  );

create policy "stickies_update_rules"
  on public.stickies for update
  using (
    public.is_session_teacher(session_id, auth.uid())
    or (
      public.is_session_member(session_id, auth.uid())
      and author_id = auth.uid()
      and sticky_type = 'note'
      and exists (
        select 1 from public.sessions s
        where s.id = session_id
          and s.status = 'active'
          and coalesce((s.permissions->>'moveSticky')::boolean, false) = true
      )
    )
  )
  with check (
    public.is_session_teacher(session_id, auth.uid())
    or (
      sticky_type = 'note'
      and author_id = auth.uid()
    )
  );

create policy "stickies_delete_teacher"
  on public.stickies for delete
  using (public.is_session_teacher(session_id, auth.uid()));

-- polls
create policy "polls_select_member"
  on public.polls for select
  using (public.is_session_member(session_id, auth.uid()));

create policy "polls_write_teacher"
  on public.polls for insert
  with check (
    public.is_session_teacher(session_id, auth.uid())
  );

create policy "polls_update_teacher"
  on public.polls for update
  using (public.is_session_teacher(session_id, auth.uid()))
  with check (public.is_session_teacher(session_id, auth.uid()));

create policy "polls_delete_teacher"
  on public.polls for delete
  using (public.is_session_teacher(session_id, auth.uid()));

-- poll_responses
create policy "poll_resp_select_own_or_teacher"
  on public.poll_responses for select
  using (
    author_id = auth.uid()
    or public.is_session_teacher(session_id, auth.uid())
  );

create policy "poll_resp_insert_student"
  on public.poll_responses for insert
  with check (
    author_id = auth.uid()
    and public.is_session_member(session_id, auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = session_id
        and s.status = 'active'
        and coalesce((s.permissions->>'answerPoll')::boolean, false) = true
    )
    and exists (select 1 from public.polls p where p.id = poll_id and p.session_id = session_id and p.active = true)
  );

create policy "poll_resp_delete_teacher"
  on public.poll_responses for delete
  using (public.is_session_teacher(session_id, auth.uid()));

-- words
create policy "words_select_member"
  on public.words for select
  using (public.is_session_member(session_id, auth.uid()));

create policy "words_insert_rules"
  on public.words for insert
  with check (
    public.is_session_member(session_id, auth.uid())
    and author_id = auth.uid()
    and (
      public.is_session_teacher(session_id, auth.uid())
      or exists (
        select 1 from public.sessions s
        where s.id = session_id
          and s.status = 'active'
          and coalesce((s.permissions->>'submitWord')::boolean, false) = true
      )
    )
  );

create policy "words_delete_teacher"
  on public.words for delete
  using (public.is_session_teacher(session_id, auth.uid()));

-- pictureload_images
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

create policy "pictureload_update_teacher"
  on public.pictureload_images for update
  to authenticated
  using (public.is_session_teacher(session_id, auth.uid()))
  with check (public.is_session_teacher(session_id, auth.uid()));

-- Pictureload: Storage-Bucket (öffentliche URLs für Galerie)
insert into storage.buckets (id, name, public)
values ('pictureload', 'pictureload', true)
on conflict (id) do update set public = excluded.public;

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

create policy "pictureload_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pictureload'
    and public.is_session_teacher(split_part(name, '/', 1)::uuid, auth.uid())
  );

-- RPCs für authentifizierte User aufrufbar
grant usage on schema public to authenticated;
grant usage on schema public to anon;

-- Standard: authenticated darf auf Tabellen zugreifen, RLS begrenzt sichtbare Zeilen
grant select, insert, update, delete on all tables in schema public to authenticated;

grant execute on function public.create_session(text, text) to authenticated;
grant execute on function public.join_session_as_student(text, text) to authenticated;
grant execute on function public.join_session_as_teacher(text, text) to authenticated;
grant execute on function public.get_session_join_preview(text) to anon, authenticated;
grant execute on function public.assign_sticky_heading(uuid, uuid) to authenticated;

-- profiles (Rollen): User darf sich selbst lesen. Neue Zeilen legt Trigger handle_new_user (role=student) an;
-- Lehrkraft: role = teacher per SQL/Table Editor setzen (oder eigener Admin-Prozess).
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

grant select on public.profiles to authenticated;
