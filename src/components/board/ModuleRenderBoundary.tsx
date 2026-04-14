import type { ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

function ModuleErrorFallback() {
  return (
    <div className="h-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      Modul konnte nicht geladen werden. Bitte Typ/Registry prüfen.
    </div>
  );
}

/** Fehlergrenze für registrierte Modul-Inhalte – verhindert Absturz der gesamten Tafel. */
export function ModuleRenderBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={ModuleErrorFallback} onError={(err) => console.error('Module render failed:', err)}>
      {children}
    </ErrorBoundary>
  );
}
