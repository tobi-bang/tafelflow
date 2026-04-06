-- Nach initiales Schema ausführen (SQL Editor oder Supabase CLI).
-- Präsentationsmodus, Ideen-Überschriften, SuS-Moderation, Umfrage-Auswertung löschen.

alter table public.sessions add column if not exists presentation_mode boolean not null default false;

alter table public.stickies add column if not exists sticky_type text not null default 'note';
alter table public.stickies add constraint stickies_sticky_type_check
  check (sticky_type in ('note', 'heading'));

alter table public.stickies add column if not exists under_heading_id uuid references public.stickies(id) on delete set null;

create index if not exists idx_stickies_heading on public.stickies(under_heading_id);

-- poll_responses: Lehrkraft darf Antworten löschen (Umfrage zurücksetzen)
drop policy if exists "poll_resp_delete_teacher" on public.poll_responses;
create policy "poll_resp_delete_teacher"
  on public.poll_responses for delete
  using (public.is_session_teacher(session_id, auth.uid()));

-- stickies: insert – SuS nur normale Karten (keine Überschriften)
drop policy if exists "stickies_insert_rules" on public.stickies;
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

-- Lehrkraft: auch Überschriften (heading) anlegen
drop policy if exists "stickies_insert_teacher_headings" on public.stickies;
create policy "stickies_insert_teacher_headings"
  on public.stickies for insert
  with check (
    public.is_session_teacher(session_id, auth.uid())
    and author_id = auth.uid()
    and sticky_type = 'heading'
  );

-- Karten verschieben: Lehrkraft oder eigene Karte (moveSticky).
-- Fremde Karten zu Überschriften: nur über RPC assign_sticky_heading (Moderation).
drop policy if exists "stickies_update_rules" on public.stickies;
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

-- RPC: sichere Zuordnung zu Überschrift (inkl. SuS-Moderation)
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

grant execute on function public.assign_sticky_heading(uuid, uuid) to authenticated;

-- Wörter: Lehrkraft darf auch bei ausgeschaltetem submitWord (z. B. nur vorne am Board) Wörter hinzufügen
drop policy if exists "words_insert_rules" on public.words;
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
