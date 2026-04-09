-- Lehrkräfte: Post-it-Größe (Präsentations- & Board-Ansicht), 1 = Standard
alter table public.stickies
  add column if not exists display_scale double precision not null default 1;

comment on column public.stickies.display_scale is 'Skalierung der Karte (ca. 0.75–2.5), gesetzt von Lehrkräften.';
