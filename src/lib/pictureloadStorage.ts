/**
 * Supabase Storage Bucket für Pictureload.
 * Muss mit `storage.buckets.id` übereinstimmen (siehe `supabase/migrations/007_pictureload.sql`, `009_pictureload_ensure_storage_bucket.sql`).
 *
 * Optional: in `.env.local` setzen, falls der Bucket im Projekt anders heißt:
 *   VITE_SUPABASE_STORAGE_BUCKET_PICTURELOAD=mein_bucket_name
 */
const raw = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET_PICTURELOAD;
export const PICTURELOAD_STORAGE_BUCKET: string =
  typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : 'pictureload';
