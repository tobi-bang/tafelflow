const MODERN_COLOR_RE = /oklch|oklab|lab\(|lch\(|color\(/i;

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

const UNSAFE_STYLE_ATTR_RE = /oklch|oklab|lab\(|lch\(|color\(/i;

let colorProbeCanvas: HTMLCanvasElement | null = null;

function getColorProbeCtx(): CanvasRenderingContext2D | null {
  if (!colorProbeCanvas) {
    colorProbeCanvas = document.createElement('canvas');
    colorProbeCanvas.width = 1;
    colorProbeCanvas.height = 1;
  }
  return colorProbeCanvas.getContext('2d', { willReadFrequently: true });
}

/** Wandelt jede CSS-Farbe in rgb/rgba um – html2canvas versteht keine oklch/lab-Werte. */
export function toSafeCssColor(value: string, fallback: string): string {
  if (!value || value === 'transparent' || value === 'none' || value === 'inherit') return fallback;
  if (!MODERN_COLOR_RE.test(value)) return value;

  const ctx = getColorProbeCtx();
  if (!ctx) return fallback;

  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fallback;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return 'transparent';
    if (a < 255) return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    const el = document.createElement('span');
    el.style.display = 'none';
    el.style.color = value;
    document.body.appendChild(el);
    const resolved = getComputedStyle(el).color;
    document.body.removeChild(el);
    if (!resolved || MODERN_COLOR_RE.test(resolved)) return fallback;
    return resolved;
  }
}

function safeOpacity(value: string): string {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return '1';
  return String(Math.min(1, Math.max(0, n)));
}

function safeBoxShadow(raw: string): string {
  if (!raw || raw === 'none' || MODERN_COLOR_RE.test(raw)) return 'none';
  return raw
    .split(',')
    .map((part) => {
      if (MODERN_COLOR_RE.test(part)) return '';
      return part.replace(/#[0-9a-f]{3,8}/gi, (m) => toSafeCssColor(m, '#000000'));
    })
    .filter(Boolean)
    .join(', ') || 'none';
}

/** Kopiert berechnete Farben als RGB/HEX auf das Klon-Element (ohne Tailwind-Klassen). */
export function inlineSafeStyles(source: Element, clone: Element): void {
  if (!(source instanceof HTMLElement) || !(clone instanceof HTMLElement)) return;
  const cs = getComputedStyle(source);
  const ch = clone as HTMLElement;

  ch.removeAttribute('class');
  if (ch.getAttribute('style') && UNSAFE_STYLE_ATTR_RE.test(ch.getAttribute('style') ?? '')) {
    ch.removeAttribute('style');
  }

  for (const prop of COLOR_PROPS) {
    const raw = cs[prop as keyof CSSStyleDeclaration] as string;
    if (!raw) continue;
    const fb =
      prop === 'color' || prop === 'fill' || prop === 'stroke'
        ? '#0f172a'
        : prop === 'backgroundColor'
          ? 'transparent'
          : '#cbd5e1';
    (ch.style as Record<string, string>)[prop] = toSafeCssColor(raw, fb);
  }

  if (clone instanceof SVGElement) {
    const fill = cs.fill || cs.color;
    const stroke = cs.stroke;
    if (fill) clone.setAttribute('fill', toSafeCssColor(fill, '#0f172a'));
    if (stroke && stroke !== 'none') clone.setAttribute('stroke', toSafeCssColor(stroke, '#0f172a'));
  }

  ch.style.opacity = safeOpacity(cs.opacity);
  ch.style.filter = 'none';
  ch.style.backdropFilter = 'none';
  ch.style.boxShadow = safeBoxShadow(cs.boxShadow);
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
  ch.style.backgroundImage = 'none';
}

export function stripDocumentStyles(doc: Document): void {
  doc.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => n.remove());
  const html = doc.documentElement;
  const body = doc.body;
  if (html) {
    html.style.background = '#ffffff';
    html.style.backgroundColor = '#ffffff';
  }
  if (body) {
    body.style.background = '#ffffff';
    body.style.backgroundColor = '#ffffff';
    body.style.margin = '0';
    body.style.padding = '0';
  }
}

/** Erneute Bereinigung im html2canvas-Klon-Dokument. */
export function sanitizeClonedSubtree(root: Element, sourceRoot: Element): void {
  const sources = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const clones = [root, ...Array.from(root.querySelectorAll('*'))];
  for (let i = 0; i < sources.length && i < clones.length; i++) {
    const src = sources[i];
    const cl = clones[i];
    if (src && cl) inlineSafeStyles(src, cl);
  }
  root.querySelectorAll('*').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.removeAttribute('class');
    node.style.filter = 'none';
    node.style.backdropFilter = 'none';
    if (node.getAttribute('style') && UNSAFE_STYLE_ATTR_RE.test(node.getAttribute('style') ?? '')) {
      const kept: string[] = [];
      for (const part of (node.getAttribute('style') ?? '').split(';')) {
        if (!UNSAFE_STYLE_ATTR_RE.test(part)) kept.push(part);
      }
      if (kept.length) node.setAttribute('style', kept.join(';'));
      else node.removeAttribute('style');
    }
  });
}

/**
 * Klont den Export-Bereich und entfernt problematische CSS-Farbfunktionen.
 * Wird in ein isoliertes iframe-Dokument eingefügt – das sichtbare Canvas bleibt unverändert.
 */
export function buildSanitizedExportClone(root: HTMLElement): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement;
  const sourceNodes = [root, ...Array.from(root.querySelectorAll('*'))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];

  clone.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => n.remove());

  for (let i = 0; i < sourceNodes.length; i++) {
    const src = sourceNodes[i];
    const cl = cloneNodes[i];
    if (src && cl) inlineSafeStyles(src, cl);
  }

  clone.querySelectorAll('img').forEach((img) => {
    img.crossOrigin = 'anonymous';
    const src = img.getAttribute('src');
    if (src && !src.startsWith('data:')) img.setAttribute('src', src);
  });

  clone.style.background = '#ffffff';
  clone.style.backgroundColor = '#ffffff';
  clone.style.position = 'relative';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.pointerEvents = 'none';
  clone.setAttribute('data-export-clone', 'true');
  return clone;
}

export async function waitForExportImages(root: HTMLElement, timeoutMs = 12000): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  if (!imgs.length) return;
  await Promise.race([
    Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
      )
    ),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** @deprecated Nur für Tests – bevorzugt iframe-Export in brainstormExport.ts */
export function createSanitizedExportClone(root: HTMLElement): HTMLElement {
  const clone = buildSanitizedExportClone(root);
  clone.style.position = 'fixed';
  clone.style.left = '-20000px';
  clone.style.zIndex = '-1';
  document.body.appendChild(clone);
  return clone;
}

export function removeExportClone(clone: HTMLElement | null): void {
  if (clone?.isConnected) clone.remove();
}
