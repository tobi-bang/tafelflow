import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Echter Supabase-Client.
 * Ohne ENV rendert `App` zuerst `SupabaseConfigMissing` – die unten stehenden Platzhalter
 * verhindern nur einen Absturz beim Import; sie sind keine echten Endpoints und keine Keys.
 */
export const supabase: SupabaseClient = createClient(
  url || 'https://invalid.invalid',
  anonKey || 'supabase-not-configured-placeholder',
  {
    auth: {
      persistSession: isSupabaseConfigured,
      autoRefreshToken: isSupabaseConfigured,
      detectSessionInUrl: isSupabaseConfigured,
    },
  }
);

export async function ensureAnonymousSession(): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase ist nicht konfiguriert. Setze VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY (z. B. in Vercel oder .env.local).'
    );
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}
