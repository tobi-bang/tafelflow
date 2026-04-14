-- Pictureload: Storage-Bucket sicherstellen (ohne ihn fehlt der Client-Upload mit „Bucket not found“).
-- Idempotent: kann auch nach manuellen Dashboard-Änderungen erneut ausgeführt werden.

insert into storage.buckets (id, name, public)
values ('pictureload', 'pictureload', true)
on conflict (id) do update
  set public = excluded.public,
      name = excluded.name;
