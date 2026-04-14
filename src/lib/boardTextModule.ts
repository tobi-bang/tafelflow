/** Abgestufte Schriftgrößen (px) für das Tafel-Textmodul – gut lesbar ab Standort / Smartboard. */
export const TEXT_MODULE_FONT_STEPS = [14, 16, 18, 20, 22, 24, 28, 32, 36, 44] as const;

/** Standard für neue Textmodule und Legacy ohne gespeicherte Größe (vorher effektiv ~14px). */
export const DEFAULT_TEXT_MODULE_FONT_PX = 20;

export function resolveTextModuleFontPx(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TEXT_MODULE_FONT_PX;
  return TEXT_MODULE_FONT_STEPS.reduce(
    (best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best),
    TEXT_MODULE_FONT_STEPS[0]
  );
}

export function stepTextModuleFontPx(currentRaw: unknown, direction: -1 | 1): number {
  const resolved = resolveTextModuleFontPx(currentRaw);
  const idx = TEXT_MODULE_FONT_STEPS.indexOf(resolved as (typeof TEXT_MODULE_FONT_STEPS)[number]);
  const i = idx >= 0 ? idx : TEXT_MODULE_FONT_STEPS.indexOf(DEFAULT_TEXT_MODULE_FONT_PX);
  const next = Math.max(0, Math.min(TEXT_MODULE_FONT_STEPS.length - 1, i + direction));
  return TEXT_MODULE_FONT_STEPS[next];
}
