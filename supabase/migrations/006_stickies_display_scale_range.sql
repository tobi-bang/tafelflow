-- display_scale: größere Spanne für lesbare Karten + Resize am Board
alter table public.stickies drop constraint if exists stickies_display_scale_check;
alter table public.stickies add constraint stickies_display_scale_check
  check (display_scale >= 0.5 and display_scale <= 4);

-- Optional: neue Sitzungen erhalten ideasDefaultScale über App (JSON permissions).
-- Bestehende Zeilen: Frontend nutzt Default 1.35 aus normalizeSessionPermissions.
