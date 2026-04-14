/**
 * QR-Inhalte für „App teilen“ auf öffentlichen Seiten (nicht der SuS-Beitritts-QR in der Sitzung).
 */

/**
 * App-weiter Standard-QR-Ziel: Anmeldeseite.
 * Einzelne Seiten können mit defaultPath abweichen (z. B. Startseite „/“, SuS-Einstieg „/join“).
 */
export const DEFAULT_APP_ENTRY_PATH = '/login' as const;

export function getDefaultAppQrUrl(): string {
  return new URL(DEFAULT_APP_ENTRY_PATH, window.location.origin).href;
}

export function getAppQrUrlForPath(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return new URL(p, window.location.origin).href;
}

export function normalizeAppPathname(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/** Pfade, die sinnvoll als QR-Ziel geteilt werden können (ohne geschützte Lehrkraft-Bereiche). */
export function isPublicShareablePath(pathname: string): boolean {
  const p = normalizeAppPathname(pathname);
  if (p === '/' || p === '/login' || p === '/register' || p === '/join') return true;
  if (/^\/student\/[^/]+$/i.test(p)) return true;
  return false;
}

/** Aktuelle Router-URL absolut (Origin + Pfad + Query wie von react-router-dom). */
export function buildAbsoluteUrl(pathname: string, search: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${pathname}${search}`;
}
