-- Pictureload: nicht-destruktive Bildbearbeitung als Metadaten.
-- Die Originaldatei im Storage bleibt unverändert; die Darstellung wird aus diesen Werten berechnet.

alter table public.pictureload_images
  add column if not exists rotation integer not null default 0,
  add column if not exists scale numeric not null default 1,
  add column if not exists offset_x numeric not null default 0,
  add column if not exists offset_y numeric not null default 0,
  add column if not exists crop_data jsonb;

update public.pictureload_images
set
  rotation = coalesce(rotation, 0),
  scale = coalesce(scale, 1),
  offset_x = coalesce(offset_x, 0),
  offset_y = coalesce(offset_y, 0);

alter table public.pictureload_images
  alter column rotation set default 0,
  alter column scale set default 1,
  alter column offset_x set default 0,
  alter column offset_y set default 0,
  alter column rotation set not null,
  alter column scale set not null,
  alter column offset_x set not null,
  alter column offset_y set not null;

comment on column public.pictureload_images.rotation is
  'Pictureload: nicht-destruktive Bildbearbeitung, Rotation in Grad.';
comment on column public.pictureload_images.scale is
  'Pictureload: nicht-destruktive Bildbearbeitung, Zoomfaktor.';
comment on column public.pictureload_images.offset_x is
  'Pictureload: nicht-destruktive Bildbearbeitung, horizontale Verschiebung in Pixeln.';
comment on column public.pictureload_images.offset_y is
  'Pictureload: nicht-destruktive Bildbearbeitung, vertikale Verschiebung in Pixeln.';
comment on column public.pictureload_images.crop_data is
  'Pictureload: optionale Zuschneide-/Ausschnittdaten als JSON.';
