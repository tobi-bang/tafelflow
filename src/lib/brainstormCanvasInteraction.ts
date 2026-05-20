import type { BrainstormAnnotation } from './brainstormCanvasTypes';

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

export function isBrainstormCanvasTableMissing(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('brainstorm_canvas') &&
    (m.includes('schema cache') || m.includes('does not exist') || m.includes('not found') || m.includes('pgrst205'))
  );
}
