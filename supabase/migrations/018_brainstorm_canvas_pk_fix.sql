-- Fix: upsert onConflict session_id → UNIQUE/PK erforderlich
-- Idempotent

-- Falls Tabelle ohne PK existiert: Duplikate bereinigen, dann PK setzen
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'brainstorm_canvas'
  ) then
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.brainstorm_canvas'::regclass
        and contype = 'p'
    ) then
      delete from public.brainstorm_canvas a
      using public.brainstorm_canvas b
      where a.ctid < b.ctid
        and a.session_id = b.session_id;

      alter table public.brainstorm_canvas
        add constraint brainstorm_canvas_pkey primary key (session_id);
    end if;
  end if;
end $$;

-- Optional: Hintergrund-Rotation
alter table public.brainstorm_canvas
  add column if not exists bg_rotation double precision not null default 0;

comment on column public.brainstorm_canvas.bg_rotation is 'Rotation der Vorlage in Grad (0–360).';
