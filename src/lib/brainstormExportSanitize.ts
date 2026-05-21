const MODERN_COLOR_RE = /oklch|lab\(|lch\(|color\(/i;

const COLOR_PROPS = [
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'fill',
  'stroke',
] as const;

function probeRgb(value: string, fallback: string): string {
  if (!value || value === 'transparent' || value === 'none') return fallback;
  if (!MODERN_COLOR_RE.test(value)) return value;
  const el = document.createElement('span');
  el.style.display = 'none';
  el.style.color = value;
  document.body.appendChild(el);
  const resolved = getComputedStyle(el).color;
  document.body.removeChild(el);
  if (!resolved || MODERN_COLOR_RE.test(resolved)) return fallback;
  return resolved;
}

function safeOpacity(value: string): string {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return '1';
  return String(Math.min(1, Math.max(0, n)));
}

/** Kopiert berechnete Farben als RGB/HEX auf das Klon-Element (ohne Tailwind-Klassen). */
export function inlineSafeStyles(source: Element, clone: Element): void {
  if (!(source instanceof HTMLElement) || !(clone instanceof HTMLElement)) return;
  const cs = getComputedStyle(source);
  const ch = clone as HTMLElement;

  ch.removeAttribute('class');
  for (const prop of COLOR_PROPS) {
    const raw = cs[prop as keyof CSSStyleDeclaration] as string;
    if (!raw) continue;
    const fb =
      prop === 'color' || prop === 'fill' || prop === 'stroke'
        ? '#0f172a'
        : prop === 'backgroundColor'
          ? 'transparent'
          : '#cbd5e1';
    (ch.style as Record<string, string>)[prop] = probeRgb(raw, fb);
  }
  ch.style.opacity = safeOpacity(cs.opacity);
  ch.style.filter = 'none';
  ch.style.backdropFilter = 'none';
  ch.style.boxShadow = cs.boxShadow && !MODERN_COLOR_RE.test(cs.boxShadow) ? cs.boxShadow : 'none';
  ch.style.fontSize = cs.fontSize;
  ch.style.fontWeight = cs.fontWeight;
  ch.style.fontFamily = cs.fontFamily || 'system-ui, sans-serif';
  ch.style.lineHeight = cs.lineHeight;
  ch.style.borderWidth = cs.borderWidth;
  ch.style.borderStyle = cs.borderStyle;
  ch.style.borderRadius = cs.borderRadius;
  ch.style.transform = cs.transform;
  ch.style.transformOrigin = cs.transformOrigin;
  ch.style.width = cs.width;
  ch.style.height = cs.height;
  ch.style.minWidth = cs.minWidth;
  ch.style.minHeight = cs.minHeight;
  ch.style.maxWidth = cs.maxWidth;
  ch.style.padding = cs.padding;
  ch.style.margin = '0';
  ch.style.position = cs.position;
  ch.style.left = cs.left;
  ch.style.top = cs.top;
  ch.style.display = cs.display;
  ch.style.flexDirection = cs.flexDirection;
  ch.style.alignItems = cs.alignItems;
  ch.style.justifyContent = cs.justifyContent;
  ch.style.textAlign = cs.textAlign;
  ch.style.whiteSpace = cs.whiteSpace;
  ch.style.wordBreak = cs.wordBreak;
  ch.style.overflow = cs.overflow;
  ch.style.zIndex = cs.zIndex;
}

/**
 * Klont den Export-Bereich, entfernt problematische CSS-Farbfunktionen, hängt ihn off-screen ein.
 * Das Original-DOM bleibt unverändert.
 */
export function createSanitizedExportClone(root: HTMLElement): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement;
  const sourceNodes = [root, ...Array.from(root.querySelectorAll('*'))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];

  for (let i = 0; i < sourceNodes.length; i++) {
    const src = sourceNodes[i];
    const cl = cloneNodes[i];
    if (src && cl) inlineSafeStyles(src, cl);
  }

  clone.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => n.remove());
  clone.style.background = '#ffffff';
  clone.style.backgroundColor = '#ffffff';
  clone.style.position = 'fixed';
  clone.style.left = '-20000px';
  clone.style.top = '0';
  clone.style.zIndex = '-1';
  clone.style.pointerEvents = 'none';
  clone.setAttribute('data-export-clone', 'true');

  document.body.appendChild(clone);
  return clone;
}

export function removeExportClone(clone: HTMLElement | null): void {
  if (clone?.isConnected) clone.remove();
}
