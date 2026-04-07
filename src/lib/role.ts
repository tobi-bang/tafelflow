import { supabase } from './supabase';
import { isLocalDemo } from './supabase';

export type AppRole = 'teacher' | 'student';

export async function getMyRole(): Promise<AppRole | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) return null;
  const r = (data?.role as string | undefined) ?? null;
  if (r === 'teacher' || r === 'student') return r;
  return null;
}

export async function requireTeacher(): Promise<boolean> {
  if (isLocalDemo) return true;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const role = await getMyRole();
  return role === 'teacher';
}

