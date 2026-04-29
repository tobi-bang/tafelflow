-- TafelFlow Buzzer
-- Im Supabase SQL Editor ausfuehren. Realtime wird am Ende fuer die drei Tabellen aktiviert.

create extension if not exists pgcrypto;

alter table public.sessions
  alter column permissions set default '{
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
  }'::jsonb;

update public.sessions
set permissions = permissions || '{"buzzer": true}'::jsonb
where not (permissions ? 'buzzer');

create table if not exists public.buzzer_sessions (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  round_id uuid not null default gen_random_uuid(),
  status text not null default 'open' check (status in ('open', 'locked')),
  fairness_mode boolean not null default false,
  silent_mode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buzzer_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  unique (session_id, round_id, user_id),
  unique (session_id, round_id, position)
);

create index if not exists idx_buzzer_events_round
  on public.buzzer_events(session_id, round_id, position);

create table if not exists public.buzzer_participants (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  excluded boolean not null default false,
  paused_next_round boolean not null default false,
  last_won_round_id uuid,
  updated_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index if not exists idx_buzzer_participants_session
  on public.buzzer_participants(session_id, display_name);

create or replace function public.ensure_buzzer_session(p_session_id uuid)
returns public.buzzer_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  member_name text;
  result public.buzzer_sessions;
begin
  if uid is null then
    raise exception 'BUZZER_NOT_AUTHENTICATED';
  end if;

  if not public.is_session_member(p_session_id, uid) then
    raise exception 'BUZZER_NOT_MEMBER';
  end if;

  insert into public.buzzer_sessions (session_id)
  values (p_session_id)
  on conflict (session_id) do nothing;

  select nullif(trim(m.display_name), '')
    into member_name
  from public.session_members m
  where m.session_id = p_session_id
    and m.user_id = uid;

  insert into public.buzzer_participants (session_id, user_id, display_name)
  values (p_session_id, uid, member_name)
  on conflict (session_id, user_id) do update
    set display_name = coalesce(excluded.display_name, public.buzzer_participants.display_name),
        updated_at = case
          when coalesce(excluded.display_name, '') is distinct from coalesce(public.buzzer_participants.display_name, '')
            then now()
          else public.buzzer_participants.updated_at
        end;

  select *
    into result
  from public.buzzer_sessions
  where session_id = p_session_id;

  return result;
end;
$$;

create or replace function public.buzzer_buzz(p_session_id uuid, p_display_name text default null)
returns table (
  id uuid,
  session_id uuid,
  round_id uuid,
  user_id uuid,
  display_name text,
  position integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s_status text;
  s_permissions jsonb;
  current_buzzer public.buzzer_sessions;
  participant public.buzzer_participants;
  existing_event public.buzzer_events;
  inserted_event public.buzzer_events;
  next_position integer;
  clean_name text;
begin
  if uid is null then
    raise exception 'BUZZER_NOT_AUTHENTICATED';
  end if;

  select status, permissions
    into s_status, s_permissions
  from public.sessions
  where id = p_session_id;

  if not found then
    raise exception 'BUZZER_SESSION_NOT_FOUND';
  end if;

  if s_status <> 'active' then
    raise exception 'BUZZER_SESSION_INACTIVE';
  end if;

  if not public.is_session_member(p_session_id, uid) then
    raise exception 'BUZZER_NOT_MEMBER';
  end if;

  if coalesce((s_permissions->>'buzzer')::boolean, true) <> true then
    raise exception 'BUZZER_PERMISSION_DENIED';
  end if;

  select *
    into current_buzzer
  from public.ensure_buzzer_session(p_session_id);

  if current_buzzer.status <> 'open' then
    raise exception 'BUZZER_LOCKED';
  end if;

  clean_name := nullif(trim(coalesce(p_display_name, '')), '');
  if clean_name is null then
    select nullif(trim(m.display_name), '')
      into clean_name
    from public.session_members m
    where m.session_id = p_session_id
      and m.user_id = uid;
  end if;
  clean_name := coalesce(clean_name, 'Anonym');

  insert into public.buzzer_participants (session_id, user_id, display_name)
  values (p_session_id, uid, clean_name)
  on conflict (session_id, user_id) do update
    set display_name = excluded.display_name,
        updated_at = now();

  select *
    into participant
  from public.buzzer_participants
  where session_id = p_session_id
    and user_id = uid;

  if participant.excluded then
    raise exception 'BUZZER_EXCLUDED';
  end if;

  if participant.paused_next_round then
    raise exception 'BUZZER_PAUSED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || current_buzzer.round_id::text, 0));

  select *
    into existing_event
  from public.buzzer_events e
  where e.session_id = p_session_id
    and e.round_id = current_buzzer.round_id
    and e.user_id = uid;

  if found then
    return query
      select e.id, e.session_id, e.round_id, e.user_id, e.display_name, e.position, e.created_at
      from public.buzzer_events e
      where e.id = existing_event.id;
    return;
  end if;

  select coalesce(max(e.position), 0) + 1
    into next_position
  from public.buzzer_events e
  where e.session_id = p_session_id
    and e.round_id = current_buzzer.round_id;

  insert into public.buzzer_events (session_id, round_id, user_id, display_name, position)
  values (p_session_id, current_buzzer.round_id, uid, clean_name, next_position)
  returning * into inserted_event;

  return query
    select e.id, e.session_id, e.round_id, e.user_id, e.display_name, e.position, e.created_at
    from public.buzzer_events e
    where e.id = inserted_event.id;
end;
$$;

create or replace function public.buzzer_reset_round(p_session_id uuid)
returns public.buzzer_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  current_buzzer public.buzzer_sessions;
  winner public.buzzer_events;
  result public.buzzer_sessions;
begin
  if not public.is_session_teacher(p_session_id, auth.uid()) then
    raise exception 'BUZZER_TEACHER_ONLY';
  end if;

  select *
    into current_buzzer
  from public.ensure_buzzer_session(p_session_id);

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || current_buzzer.round_id::text, 0));

  select *
    into winner
  from public.buzzer_events e
  where e.session_id = p_session_id
    and e.round_id = current_buzzer.round_id
    and e.position = 1;

  update public.buzzer_participants
  set paused_next_round = false,
      updated_at = now()
  where session_id = p_session_id
    and paused_next_round = true;

  if current_buzzer.fairness_mode and winner.user_id is not null then
    insert into public.buzzer_participants (session_id, user_id, display_name, paused_next_round, last_won_round_id)
    values (p_session_id, winner.user_id, winner.display_name, true, current_buzzer.round_id)
    on conflict (session_id, user_id) do update
      set display_name = excluded.display_name,
          paused_next_round = true,
          last_won_round_id = excluded.last_won_round_id,
          updated_at = now();
  end if;

  update public.buzzer_sessions
  set round_id = gen_random_uuid(),
      status = 'open',
      updated_at = now()
  where session_id = p_session_id
  returning * into result;

  return result;
end;
$$;

create or replace function public.buzzer_clear_all(p_session_id uuid)
returns public.buzzer_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  current_buzzer public.buzzer_sessions;
  result public.buzzer_sessions;
begin
  if not public.is_session_teacher(p_session_id, auth.uid()) then
    raise exception 'BUZZER_TEACHER_ONLY';
  end if;

  select *
    into current_buzzer
  from public.ensure_buzzer_session(p_session_id);

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || current_buzzer.round_id::text, 0));

  delete from public.buzzer_events
  where session_id = p_session_id;

  update public.buzzer_participants
  set excluded = false,
      paused_next_round = false,
      last_won_round_id = null,
      updated_at = now()
  where session_id = p_session_id;

  update public.buzzer_sessions
  set round_id = gen_random_uuid(),
      status = 'open',
      updated_at = now()
  where session_id = p_session_id
  returning * into result;

  return result;
end;
$$;

create or replace function public.buzzer_set_locked(p_session_id uuid, p_locked boolean)
returns public.buzzer_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.buzzer_sessions;
begin
  if not public.is_session_teacher(p_session_id, auth.uid()) then
    raise exception 'BUZZER_TEACHER_ONLY';
  end if;

  perform public.ensure_buzzer_session(p_session_id);

  update public.buzzer_sessions
  set status = case when p_locked then 'locked' else 'open' end,
      updated_at = now()
  where session_id = p_session_id
  returning * into result;

  return result;
end;
$$;

create or replace function public.buzzer_set_participant_excluded(
  p_session_id uuid,
  p_user_id uuid,
  p_excluded boolean
)
returns public.buzzer_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  current_buzzer public.buzzer_sessions;
  participant_name text;
  result public.buzzer_participants;
begin
  if not public.is_session_teacher(p_session_id, auth.uid()) then
    raise exception 'BUZZER_TEACHER_ONLY';
  end if;

  select *
    into current_buzzer
  from public.ensure_buzzer_session(p_session_id);

  select nullif(trim(m.display_name), '')
    into participant_name
  from public.session_members m
  where m.session_id = p_session_id
    and m.user_id = p_user_id;

  insert into public.buzzer_participants (session_id, user_id, display_name, excluded)
  values (p_session_id, p_user_id, participant_name, p_excluded)
  on conflict (session_id, user_id) do update
    set display_name = coalesce(excluded.display_name, public.buzzer_participants.display_name),
        excluded = p_excluded,
        updated_at = now()
  returning * into result;

  if p_excluded then
    perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || current_buzzer.round_id::text, 0));

    delete from public.buzzer_events
    where session_id = p_session_id
      and round_id = current_buzzer.round_id
      and user_id = p_user_id;

    with ranked as (
      select
        id,
        row_number() over (order by position, created_at, id)::integer + 1000000 as new_position
      from public.buzzer_events
      where session_id = p_session_id
        and round_id = current_buzzer.round_id
    )
    update public.buzzer_events e
    set position = ranked.new_position
    from ranked
    where e.id = ranked.id;

    with ranked as (
      select
        id,
        row_number() over (order by position, created_at, id)::integer as new_position
      from public.buzzer_events
      where session_id = p_session_id
        and round_id = current_buzzer.round_id
    )
    update public.buzzer_events e
    set position = ranked.new_position
    from ranked
    where e.id = ranked.id;
  end if;

  return result;
end;
$$;

alter table public.buzzer_sessions enable row level security;
alter table public.buzzer_events enable row level security;
alter table public.buzzer_participants enable row level security;

drop policy if exists "buzzer_sessions_select_member" on public.buzzer_sessions;
create policy "buzzer_sessions_select_member"
  on public.buzzer_sessions for select
  to authenticated
  using (public.is_session_member(session_id, auth.uid()));

drop policy if exists "buzzer_sessions_update_teacher" on public.buzzer_sessions;
create policy "buzzer_sessions_update_teacher"
  on public.buzzer_sessions for update
  to authenticated
  using (public.is_session_teacher(session_id, auth.uid()))
  with check (public.is_session_teacher(session_id, auth.uid()));

drop policy if exists "buzzer_events_select_teacher_or_own" on public.buzzer_events;
create policy "buzzer_events_select_teacher_or_own"
  on public.buzzer_events for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_session_teacher(session_id, auth.uid())
    or exists (
      select 1
      from public.buzzer_sessions bs
      where bs.session_id = public.buzzer_events.session_id
        and bs.silent_mode = false
        and public.is_session_member(public.buzzer_events.session_id, auth.uid())
    )
  );

drop policy if exists "buzzer_participants_select_teacher_or_own" on public.buzzer_participants;
create policy "buzzer_participants_select_teacher_or_own"
  on public.buzzer_participants for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_session_teacher(session_id, auth.uid())
  );

grant select, insert, update, delete on public.buzzer_sessions to authenticated;
grant select, insert, update, delete on public.buzzer_events to authenticated;
grant select, insert, update, delete on public.buzzer_participants to authenticated;

grant execute on function public.ensure_buzzer_session(uuid) to authenticated;
grant execute on function public.buzzer_buzz(uuid, text) to authenticated;
grant execute on function public.buzzer_reset_round(uuid) to authenticated;
grant execute on function public.buzzer_clear_all(uuid) to authenticated;
grant execute on function public.buzzer_set_locked(uuid, boolean) to authenticated;
grant execute on function public.buzzer_set_participant_excluded(uuid, uuid, boolean) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.buzzer_sessions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.buzzer_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.buzzer_participants;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
