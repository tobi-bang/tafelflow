export const BRAINSTORM_CANVAS_WIDTH = 2800;
export const BRAINSTORM_CANVAS_HEIGHT = 1800;

export type BrainstormAnnotationKind = 'text' | 'arrow' | 'rect' | 'circle' | 'highlight';

export type BrainstormAnnotation = {
  id: string;
  kind: BrainstormAnnotationKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  text?: string;
  color?: string;
  strokeWidth?: number;
};

export type BrainstormCanvasState = {
  sessionId: string;
  backgroundPath: string | null;
  backgroundUrl: string | null;
  bgX: number;
  bgY: number;
  bgScale: number;
  bgLocked: boolean;
  annotations: BrainstormAnnotation[];
  updatedAt: string;
};

export type BrainstormCanvasTool =
  | 'select'
  | 'text'
  | 'arrow'
  | 'rect'
  | 'circle'
  | 'highlight';

export function defaultBrainstormCanvas(sessionId: string): BrainstormCanvasState {
  return {
    sessionId,
    backgroundPath: null,
    backgroundUrl: null,
    bgX: 80,
    bgY: 80,
    bgScale: 1,
    bgLocked: false,
    annotations: [],
    updatedAt: new Date().toISOString(),
  };
}

function isAnnotationKind(v: unknown): v is BrainstormAnnotationKind {
  return v === 'text' || v === 'arrow' || v === 'rect' || v === 'circle' || v === 'highlight';
}

export function parseAnnotations(raw: unknown): BrainstormAnnotation[] {
  if (!Array.isArray(raw)) return [];
  const out: BrainstormAnnotation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const kind = o.kind;
    if (!isAnnotationKind(kind)) continue;
    const id = typeof o.id === 'string' ? o.id : crypto.randomUUID();
    const x = Number(o.x);
    const y = Number(o.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      id,
      kind,
      x,
      y,
      w: Number.isFinite(Number(o.w)) ? Number(o.w) : undefined,
      h: Number.isFinite(Number(o.h)) ? Number(o.h) : undefined,
      x2: Number.isFinite(Number(o.x2)) ? Number(o.x2) : undefined,
      y2: Number.isFinite(Number(o.y2)) ? Number(o.y2) : undefined,
      text: typeof o.text === 'string' ? o.text : undefined,
      color: typeof o.color === 'string' ? o.color : undefined,
      strokeWidth: Number.isFinite(Number(o.strokeWidth)) ? Number(o.strokeWidth) : undefined,
    });
  }
  return out;
}

export function clampBgScale(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(4, Math.max(0.15, n));
}
