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
  /** Rahmen-/Linienfarbe (Legacy: color) */
  color?: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  fontSize?: number;
  opacity?: number;
  zIndex?: number;
  rotation?: number;
};

export const STICKY_SELECT_PREFIX = 'sticky:';

export function stickySelectId(stickyId: string): string {
  return `${STICKY_SELECT_PREFIX}${stickyId}`;
}

export function parseStickySelectId(id: string | null): string | null {
  if (!id?.startsWith(STICKY_SELECT_PREFIX)) return null;
  return id.slice(STICKY_SELECT_PREFIX.length);
}

export type ResizeHandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'start'
  | 'end';

export const BRAINSTORM_AUTOSAVE_MS = 750;

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
    bgRotation: 0,
    annotations: [],
    updatedAt: new Date().toISOString(),
  };
}

export function sortAnnotationsByZIndex(items: BrainstormAnnotation[]): BrainstormAnnotation[] {
  return [...items].sort((a, b) => (a.zIndex ?? 1) - (b.zIndex ?? 1));
}

export function nextZIndex(items: BrainstormAnnotation[]): number {
  return items.reduce((m, a) => Math.max(m, a.zIndex ?? 1), 0) + 1;
}

export function strokeOf(a: BrainstormAnnotation): string {
  return a.stroke ?? a.color ?? '#1e293b';
}

export function fillOf(a: BrainstormAnnotation): string {
  if (a.fill) return a.fill;
  if (a.kind === 'highlight') return '#facc15';
  if (a.kind === 'text') return '#ffffff';
  return 'transparent';
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
      stroke: typeof o.stroke === 'string' ? o.stroke : undefined,
      fill: typeof o.fill === 'string' ? o.fill : undefined,
      strokeWidth: Number.isFinite(Number(o.strokeWidth)) ? Number(o.strokeWidth) : undefined,
      fontSize: Number.isFinite(Number(o.fontSize)) ? Number(o.fontSize) : undefined,
      opacity: Number.isFinite(Number(o.opacity)) ? Math.min(1, Math.max(0, Number(o.opacity))) : undefined,
      zIndex: Number.isFinite(Number(o.zIndex)) ? Number(o.zIndex) : undefined,
      rotation: Number.isFinite(Number(o.rotation)) ? Number(o.rotation) : undefined,
    });
  }
  return out;
}

export function clampBgScale(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(4, Math.max(0.15, n));
}
