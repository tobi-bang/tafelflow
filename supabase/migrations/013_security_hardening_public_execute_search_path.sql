-- TafelFlow: Security-Hardening (Supabase Advisor / Linter)
-- ---------------------------------------------------------------------------
-- Robust: ALTER / REVOKE / GRANT nur, wenn die Funktion im Ziel-Projekt existiert
-- (z. B. fehlt pictureload_images_set_default_moderation, wenn Migration 008/010 nie lief).
--
-- Fehlt pictureload_images_set_default_moderation: Pictureload-Moderations-Trigger ist
-- dann ebenfalls nicht aktiv – App nutzt INSERT trotzdem; ggf. Migration 008 anwenden.
--
-- Deploy: SQL in Supabase ausführen / Migration pushen. Kein App-Redeploy nötig.
-- ---------------------------------------------------------------------------

-- 1) Search Path (mutable) – nur wenn tf_random_room_code existiert
do $$
begin
  if to_regprocedure('public.tf_random_room_code()') is not null then
    execute 'alter function public.tf_random_room_code() set search_path = public';
  end if;
end $$;

-- 2) PUBLIC entziehen, dann minimal vergeben (nur vorhandene Funktionen)
do $$
begin
  if to_regprocedure('public.is_session_member(uuid, uuid)') is not null then
    execute 'revoke all on function public.is_session_member(uuid, uuid) from public';
    execute 'grant execute on function public.is_session_member(uuid, uuid) to authenticated';
  end if;

  if to_regprocedure('public.is_session_teacher(uuid, uuid)') is not null then
    execute 'revoke all on function public.is_session_teacher(uuid, uuid) from public';
    execute 'grant execute on function public.is_session_teacher(uuid, uuid) to authenticated';
  end if;

  if to_regprocedure('public.pictureload_images_set_default_moderation()') is not null then
    execute 'revoke all on function public.pictureload_images_set_default_moderation() from public';
  end if;

  if to_regprocedure('public.handle_new_user()') is not null then
    execute 'revoke all on function public.handle_new_user() from public';
  end if;

  if to_regprocedure('public.tf_random_room_code()') is not null then
    execute 'revoke all on function public.tf_random_room_code() from public';
  end if;

  if to_regprocedure('public.create_session(text, text)') is not null then
    execute 'revoke all on function public.create_session(text, text) from public';
    execute 'grant execute on function public.create_session(text, text) to authenticated';
  end if;

  if to_regprocedure('public.get_session_join_preview(text)') is not null then
    execute 'revoke all on function public.get_session_join_preview(text) from public';
    execute 'grant execute on function public.get_session_join_preview(text) to anon, authenticated';
  end if;

  if to_regprocedure('public.join_session_as_student(text, text)') is not null then
    execute 'revoke all on function public.join_session_as_student(text, text) from public';
    execute 'grant execute on function public.join_session_as_student(text, text) to authenticated';
  end if;

  if to_regprocedure('public.join_session_as_teacher(text, text)') is not null then
    execute 'revoke all on function public.join_session_as_teacher(text, text) from public';
    execute 'grant execute on function public.join_session_as_teacher(text, text) to authenticated';
  end if;

  if to_regprocedure('public.assign_sticky_heading(uuid, uuid)') is not null then
    execute 'revoke all on function public.assign_sticky_heading(uuid, uuid) from public';
    execute 'grant execute on function public.assign_sticky_heading(uuid, uuid) to authenticated';
  end if;

  if to_regprocedure('public.ensure_buzzer_session(uuid)') is not null then
    execute 'revoke all on function public.ensure_buzzer_session(uuid) from public';
    execute 'grant execute on function public.ensure_buzzer_session(uuid) to authenticated';
  end if;

  if to_regprocedure('public.buzzer_buzz(uuid, text)') is not null then
    execute 'revoke all on function public.buzzer_buzz(uuid, text) from public';
    execute 'grant execute on function public.buzzer_buzz(uuid, text) to authenticated';
  end if;

  if to_regprocedure('public.buzzer_reset_round(uuid)') is not null then
    execute 'revoke all on function public.buzzer_reset_round(uuid) from public';
    execute 'grant execute on function public.buzzer_reset_round(uuid) to authenticated';
  end if;

  if to_regprocedure('public.buzzer_clear_all(uuid)') is not null then
    execute 'revoke all on function public.buzzer_clear_all(uuid) from public';
    execute 'grant execute on function public.buzzer_clear_all(uuid) to authenticated';
  end if;

  if to_regprocedure('public.buzzer_set_locked(uuid, boolean)') is not null then
    execute 'revoke all on function public.buzzer_set_locked(uuid, boolean) from public';
    execute 'grant execute on function public.buzzer_set_locked(uuid, boolean) to authenticated';
  end if;

  if to_regprocedure('public.buzzer_set_participant_excluded(uuid, uuid, boolean)') is not null then
    execute 'revoke all on function public.buzzer_set_participant_excluded(uuid, uuid, boolean) from public';
    execute 'grant execute on function public.buzzer_set_participant_excluded(uuid, uuid, boolean) to authenticated';
  end if;

  if to_regprocedure('public.buzzer_remove_participant(uuid, uuid)') is not null then
    execute 'revoke all on function public.buzzer_remove_participant(uuid, uuid) from public';
    execute 'grant execute on function public.buzzer_remove_participant(uuid, uuid) to authenticated';
  end if;
end $$;

-- 3) Storage pictureload: Hilfsfunktion + anon-SELECT nur wenn Tabelle/Spalte existieren
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pictureload_images'
      and column_name = 'moderation_status'
  ) then
    execute $fn$
      create or replace function public.pictureload_storage_path_is_public_approved(p_path text)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select exists (
          select 1
          from public.pictureload_images i
          where i.storage_path = p_path
            and i.moderation_status = 'approved'
        );
      $body$;
    $fn$;

    if to_regprocedure('public.pictureload_storage_path_is_public_approved(text)') is not null then
      execute 'revoke all on function public.pictureload_storage_path_is_public_approved(text) from public';
      execute 'grant execute on function public.pictureload_storage_path_is_public_approved(text) to anon, authenticated';
    end if;

    execute 'drop policy if exists "pictureload_storage_select_anon_approved" on storage.objects';
    execute $pol$
      create policy "pictureload_storage_select_anon_approved"
        on storage.objects for select
        to anon
        using (
          bucket_id = 'pictureload'
          and public.pictureload_storage_path_is_public_approved(name)
        );
    $pol$;
  end if;
end $$;

notify pgrst, 'reload schema';
