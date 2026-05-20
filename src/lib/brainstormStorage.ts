import { supabase } from './supabase';

/**
 * Standard: `brainstorm-templates` (siehe Migration 014 / 016).
 * Nur setzen, wenn der Bucket im Supabase-Dashboard anders heißt:
 *   VITE_SUPABASE_STORAGE_BUCKET_BRAINSTORM=mein_bucket
 */
const raw = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET_BRAINSTORM;
export const BRAINSTORM_STORAGE_BUCKET: string =
  typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : 'brainstorm-templates';

export const BRAINSTORM_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const BRAINSTORM_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

const BUCKET_SETUP_HINT =
  `Storage-Bucket „${BRAINSTORM_STORAGE_BUCKET}“ fehlt in Supabase. ` +
  'Bitte im SQL Editor die Migration supabase/migrations/016_ensure_brainstorm_templates_bucket.sql ausführen ' +
  '(oder unter Storage → New bucket denselben Namen anlegen, öffentlich).';

function wrapStorageError(message: string): Error {
  const lower = message.toLowerCase();
  if (lower.includes('bucket not found') || lower.includes('bucket_not_found')) {
    return new Error(BUCKET_SETUP_HINT);
  }
  return new Error(message);
}

export function publicUrlForBrainstormPath(path: string): string {
  const { data } = supabase.storage.from(BRAINSTORM_STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function extFromMime(mime: string, fileName = ''): string | null {
  const m = (mime || '').toLowerCase().trim();
  const fn = fileName.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  if (m === 'image/png') return '.png';
  if (m === 'image/webp') return '.webp';
  if (!m || m === 'application/octet-stream') {
    if (fn.endsWith('.jpg') || fn.endsWith('.jpeg')) return '.jpg';
    if (fn.endsWith('.png')) return '.png';
    if (fn.endsWith('.webp')) return '.webp';
  }
  return null;
}

export function storageContentType(file: File, ext: string): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

export async function uploadBrainstormBackground(sessionId: string, file: File): Promise<{ path: string; publicUrl: string }> {
  if (file.size > BRAINSTORM_IMAGE_MAX_BYTES) {
    throw new Error('Das Bild ist zu groß (max. 8 MB).');
  }
  const ext = extFromMime(file.type, file.name);
  if (!ext) {
    throw new Error('Nur JPG, PNG oder WEBP sind erlaubt.');
  }
  const path = `${sessionId}/background-${Date.now()}${ext}`;
  const { error } = await supabase.storage.from(BRAINSTORM_STORAGE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: storageContentType(file, ext),
  });
  if (error) throw wrapStorageError(error.message);
  return { path, publicUrl: publicUrlForBrainstormPath(path) };
}

export async function removeBrainstormBackgroundFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BRAINSTORM_STORAGE_BUCKET).remove([path]);
  if (error) throw wrapStorageError(error.message);
}
