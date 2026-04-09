-- Vorschau für SuS-Beitritt: Soll ein Anzeigename verlangt werden?
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

-- Beitritt: Name nur nötig, wenn ideasRequireDisplayName in permissions true ist
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
