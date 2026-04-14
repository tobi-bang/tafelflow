import { supabase } from './supabase';
import { moduleRegistry } from './moduleRegistry';
import type { SessionTabId } from './sessionToolMeta';
import type { BoardModule, BoardModuleData } from '../types';

export async function createBoardModule(sessionId: string, type: string, pageId?: string): Promise<string> {
  const definition = moduleRegistry[type];
  if (!definition) throw new Error(`Modultyp "${type}" ist nicht registriert.`);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Nicht angemeldet.');

  const { data: existing, error: existingErr } = await supabase
    .from('board_objects')
    .select('data')
    .eq('session_id', sessionId)
    .eq('type', 'module')
    .order('created_at', { ascending: true });
  if (existingErr) throw existingErr;

  const modules = (existing ?? []).map((row) => (row as { data?: Record<string, unknown> }).data ?? {});
  const modulesOnPage = pageId
    ? modules.filter((raw) => String((raw.data as Record<string, unknown> | undefined)?.pageId ?? 'default') === pageId)
    : modules;
  const moduleCount = modulesOnPage.length;
  const topZ = modules.reduce((max, raw) => {
    const z = Number((raw.data as Record<string, unknown> | undefined)?.zIndex ?? 1);
    return Number.isFinite(z) ? Math.max(max, z) : max;
  }, 1);

  const moduleData: BoardModule = {
    id: '',
    type,
    x: 80 + moduleCount * 24,
    y: 120 + moduleCount * 20,
    width: definition.defaultSize.width,
    height: definition.defaultSize.height,
    locked: false,
    data: {
      pageId: pageId ?? 'default',
      zIndex: topZ + 1,
      title: definition.title,
      editableByStudents: false,
      ...(definition.defaultData ?? {}),
    } as BoardModuleData,
  };

  const payload = {
    session_id: sessionId,
    type: 'module',
    data: moduleData,
    color: '#0f172a',
    author_id: user.id,
  };

  const { data, error } = await supabase.from('board_objects').insert(payload).select('id').single();
  if (error) throw error;
  return String((data as { id: string }).id);
}

export function tabToModuleType(tab: SessionTabId): string | null {
  if (tab in moduleRegistry) return tab;
  return null;
}
