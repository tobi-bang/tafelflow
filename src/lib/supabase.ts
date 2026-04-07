import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured && import.meta.env.PROD) {
  console.error(
    'TafelFlow: VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY müssen gesetzt sein (z. B. in Vercel → Environment Variables).'
  );
}

/** Nur für den Fall fehlender Keys beim lokalen Start: verhindert sofortigen Crash; API-Aufrufe schlagen fehl bis .env.local gesetzt ist. */
const fallbackUrl = 'https://placeholder.supabase.co';
const fallbackAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.placeholder';

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    'TafelFlow: Supabase-URL/Key fehlen. Lege .env.local mit VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY an (siehe .env.example).'
  );
}

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? url : fallbackUrl,
  isSupabaseConfigured ? anonKey : fallbackAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export async function ensureAnonymousSession(): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase nicht konfiguriert: VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in .env.local setzen.');
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}
