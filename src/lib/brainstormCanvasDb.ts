import { supabase } from './supabase';
import {
  clampBgScale,
  defaultBrainstormCanvas,
  parseAnnotations,
  type BrainstormAnnotation,
  type BrainstormCanvasState,
} from './brainstormCanvasTypes';
import { publicUrlForBrainstormPath } from './brainstormStorage';

export function rowToBrainstormCanvas(row: Record<string, unknown>): BrainstormCanvasState {
  const sessionId = String(row.session_id ?? '');
  const path = typeof row.background_path === 'string' && row.background_path.trim() !== '' ? row.background_path : null;
  return {
    sessionId,
    backgroundPath: path,
    backgroundUrl: path ? publicUrlForBrainstormPath(path) : null,
    bgX: Number.isFinite(Number(row.bg_x)) ? Number(row.bg_x) : 80,
    bgY: Number.isFinite(Number(row.bg_y)) ? Number(row.bg_y) : 80,
    bgScale: clampBgScale(row.bg_scale),
    bgLocked: Boolean(row.bg_locked),
    annotations: parseAnnotations(row.annotations),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

export async function fetchBrainstormCanvas(sessionId: string): Promise<BrainstormCanvasState> {
  const { data, error } = await supabase
    .from('brainstorm_canvas')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return defaultBrainstormCanvas(sessionId);
  return rowToBrainstormCanvas(data as Record<string, unknown>);
}

export type BrainstormCanvasPatch = Partial<{
  backgroundPath: string | null;
  bgX: number;
  bgY: number;
  bgScale: number;
  bgLocked: boolean;
  annotations: BrainstormAnnotation[];
}>;

export async function upsertBrainstormCanvas(sessionId: string, patch: BrainstormCanvasPatch): Promise<void> {
  const row: Record<string, unknown> = {
    session_id: sessionId,
    updated_at: new Date().toISOString(),
  };
  if (patch.backgroundPath !== undefined) row.background_path = patch.backgroundPath;
  if (patch.bgX !== undefined) row.bg_x = patch.bgX;
  if (patch.bgY !== undefined) row.bg_y = patch.bgY;
  if (patch.bgScale !== undefined) row.bg_scale = clampBgScale(patch.bgScale);
  if (patch.bgLocked !== undefined) row.bg_locked = patch.bgLocked;
  if (patch.annotations !== undefined) row.annotations = patch.annotations;

  const { error } = await supabase.from('brainstorm_canvas').upsert(row, { onConflict: 'session_id' });
  if (error) throw new Error(error.message);
}
