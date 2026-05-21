import type { BrainstormAnnotation, ResizeHandleId } from './brainstormCanvasTypes';

const HIT_PAD = 10;

export type AnnotationBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function annotationBounds(a: BrainstormAnnotation): AnnotationBounds {
  if (a.kind === 'text') {
    return {
      left: a.x - HIT_PAD,
      top: a.y - HIT_PAD,
      right: a.x + 220 + HIT_PAD,
      bottom: a.y + 56 + HIT_PAD,
    };
  }
  if (a.kind === 'arrow' && a.x2 != null && a.y2 != null) {
    return {
      left: Math.min(a.x, a.x2) - HIT_PAD,
      top: Math.min(a.y, a.y2) - HIT_PAD,
      right: Math.max(a.x, a.x2) + HIT_PAD,
      bottom: Math.max(a.y, a.y2) + HIT_PAD,
    };
  }
  const w = a.w ?? 0;
  const h = a.h ?? 0;
  return {
    left: Math.min(a.x, a.x + w) - HIT_PAD,
    top: Math.min(a.y, a.y + h) - HIT_PAD,
    right: Math.max(a.x, a.x + w) + HIT_PAD,
    bottom: Math.max(a.y, a.y + h) + HIT_PAD,
  };
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

export function hitTestAnnotation(a: BrainstormAnnotation, px: number, py: number): boolean {
  if (a.kind === 'arrow' && a.x2 != null && a.y2 != null) {
    return distToSegment(px, py, a.x, a.y, a.x2, a.y2) <= HIT_PAD + 4;
  }
  const b = annotationBounds(a);
  return px >= b.left && px <= b.right && py >= b.top && py <= b.bottom;
}

export function findAnnotationAt(
  annotations: BrainstormAnnotation[],
  px: number,
  py: number
): BrainstormAnnotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (hitTestAnnotation(annotations[i], px, py)) return annotations[i];
  }
  return null;
}

export function moveAnnotation(a: BrainstormAnnotation, dx: number, dy: number): BrainstormAnnotation {
  const next = { ...a, x: a.x + dx, y: a.y + dy };
  if (a.x2 != null) next.x2 = a.x2 + dx;
  if (a.y2 != null) next.y2 = a.y2 + dy;
  return next;
}

export function normalizeAnnotationBox(a: BrainstormAnnotation): { x: number; y: number; w: number; h: number } {
  if (a.kind === 'text') {
    return { x: a.x, y: a.y, w: a.w ?? 220, h: a.h ?? 56 };
  }
  const w = a.w ?? 80;
  const h = a.h ?? 80;
  return {
    x: w < 0 ? a.x + w : a.x,
    y: h < 0 ? a.y + h : a.y,
    w: Math.max(12, Math.abs(w)),
    h: Math.max(12, Math.abs(h)),
  };
}

export function resizeAnnotation(
  a: BrainstormAnnotation,
  handle: ResizeHandleId,
  dx: number,
  dy: number,
  proportional: boolean
): BrainstormAnnotation {
  if (a.kind === 'arrow' && a.x2 != null && a.y2 != null) {
    if (handle === 'start') return { ...a, x: a.x + dx, y: a.y + dy };
    if (handle === 'end') return { ...a, x2: a.x2 + dx, y2: a.y2 + dy };
    return a;
  }

  const box = normalizeAnnotationBox(a);
  let x = box.x;
  let y = box.y;
  let w = box.w;
  let h = box.h;

  if (handle === 'se') {
    w += dx;
    h += dy;
  } else if (handle === 'e') {
    w += dx;
  } else if (handle === 's') {
    h += dy;
  } else if (handle === 'sw') {
    x += dx;
    w -= dx;
    h += dy;
  } else if (handle === 'w') {
    x += dx;
    w -= dx;
  } else if (handle === 'ne') {
    y += dy;
    w += dx;
    h -= dy;
  } else if (handle === 'n') {
    y += dy;
    h -= dy;
  } else if (handle === 'nw') {
    x += dx;
    y += dy;
    w -= dx;
    h -= dy;
  }

  w = Math.max(12, w);
  h = Math.max(12, h);

  if (proportional && a.kind !== 'text') {
    const ratio = box.w / Math.max(box.h, 1);
    if (handle === 'e' || handle === 'w') h = w / ratio;
    else if (handle === 'n' || handle === 's') w = h * ratio;
    else {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      const signW = dx >= 0 ? 1 : -1;
      w = Math.max(12, box.w + signW * s);
      h = Math.max(12, w / ratio);
    }
  }

  if (a.kind === 'text') {
    return { ...a, x, y, w, h };
  }
  return { ...a, x, y, w, h };
}

export function rotateAnnotation(a: BrainstormAnnotation, deltaDeg: number): BrainstormAnnotation {
  const r = (a.rotation ?? 0) + deltaDeg;
  return { ...a, rotation: ((r % 360) + 360) % 360 };
}

export function scaleAnnotationFromCenter(
  a: BrainstormAnnotation,
  scale: number,
  proportional: boolean
): BrainstormAnnotation {
  const box = normalizeAnnotationBox(a);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let nw = box.w * scale;
  let nh = box.h * scale;
  if (proportional) {
    const ratio = box.w / Math.max(box.h, 1);
    nh = nw / ratio;
  }
  nw = Math.max(12, nw);
  nh = Math.max(12, nh);
  const nx = cx - nw / 2;
  const ny = cy - nh / 2;
  if (a.kind === 'arrow' && a.x2 != null && a.y2 != null) {
    const mx = (a.x + a.x2) / 2;
    const my = (a.y + a.y2) / 2;
    const half = (Math.hypot(a.x2 - a.x, a.y2 - a.y) / 2) * scale;
    const ang = Math.atan2(a.y2 - a.y, a.x2 - a.x);
    return {
      ...a,
      x: mx - Math.cos(ang) * half,
      y: my - Math.sin(ang) * half,
      x2: mx + Math.cos(ang) * half,
      y2: my + Math.sin(ang) * half,
    };
  }
  return { ...a, x: nx, y: ny, w: nw, h: nh };
}

export function isBrainstormCanvasTableMissing(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('brainstorm_canvas') &&
    (m.includes('schema cache') || m.includes('does not exist') || m.includes('not found') || m.includes('pgrst205'))
  );
}
