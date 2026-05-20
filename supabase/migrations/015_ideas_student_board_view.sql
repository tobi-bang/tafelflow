-- SuS: optionale Lesansicht freigegebener Klassenideen auf dem eigenen Gerät

update public.sessions
set permissions = coalesce(permissions, '{}'::jsonb) || '{"ideasStudentBoardView": false}'::jsonb
where permissions is null
   or (permissions->>'ideasStudentBoardView') is null;

comment on column public.sessions.permissions is
  'JSON-Rechte inkl. ideasStudentBoardView (SuS sehen freigegebene Klassenideen, Standard false).';
