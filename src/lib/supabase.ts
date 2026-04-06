import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLocalDemoSupabase } from './localDemoSupabase';

/** Reiner Browser-Modus: keine Supabase-Cloud nötig (Daten in sessionStorage). */
export const isLocalDemo = import.meta.env.VITE_LOCAL_DEMO === 'true';

export const isSupabaseConfigured =
  isLocalDemo ||
  Boolean(import.meta.env.VITE_SUPABASE_URL?.trim() && import.meta.env.VITE_SUPABASE_ANON_KEY?.trim());

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || 'https://placeholder.supabase.co';
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.placeholder';

if (!isLocalDemo && !isSupabaseConfigured) {
  console.warn(
    'TafelFlow: Weder VITE_LOCAL_DEMO noch Supabase-URL/Key gesetzt. Lege .env.local an (siehe .env.example).'
  );
}

export const supabase: SupabaseClient = isLocalDemo
  ? createLocalDemoSupabase()
  : createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });

export async function ensureAnonymousSession(): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Nicht konfiguriert: VITE_LOCAL_DEMO=true oder Supabase-Keys in .env.local.');
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}
