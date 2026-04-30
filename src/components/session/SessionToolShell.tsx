import React from 'react';
import type { SessionTabId } from '../../lib/sessionToolMeta';
import { SESSION_TOOL_META } from '../../lib/sessionToolMeta';
import type { SessionViewRole } from '../../lib/sessionRole';

type Variant = 'page' | 'canvas';

interface SessionToolShellProps {
  tabId: SessionTabId;
  role: SessionViewRole;
  presentationMode?: boolean;
  /** Zusätzliche Schaltflächen im Kopfbereich (z. B. Schnellaktionen) */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** page: scrollbare Werkzeugfläche; canvas: volle Höhe für Tafel/Ideenfläche */
  variant?: Variant;
  /** Für Werkzeuge mit eigener kompakter Toolbar. */
  hideHeader?: boolean;
}

export default function SessionToolShell({
  tabId,
  role,
  presentationMode = false,
  actions,
  children,
  variant = 'page',
  hideHeader = false,
}: SessionToolShellProps) {
  const meta = SESSION_TOOL_META[tabId];
  const description = role === 'teacher' ? meta.descriptionTeacher : meta.descriptionStudent;

  const headerPad =
    variant === 'canvas'
      ? presentationMode
        ? 'py-3 sm:py-3.5 md:py-4'
        : 'py-1.5 sm:py-2 md:py-3'
      : presentationMode
        ? 'py-4 sm:py-5'
        : 'py-3 sm:py-4';
  const titleClass =
    variant === 'canvas'
      ? presentationMode
        ? 'text-xl sm:text-2xl xl:text-3xl'
        : 'text-sm sm:text-base md:text-lg'
      : presentationMode
        ? 'text-xl sm:text-2xl'
        : 'text-lg sm:text-xl';
  const headerX = variant === 'canvas' ? 'px-3 sm:px-4' : 'px-4 sm:px-6';

  return (
    <div className={variant === 'canvas' ? 'flex flex-col h-full min-h-0 bg-slate-50 min-w-0' : 'flex flex-col min-h-0 h-full'}>
      {!hideHeader && (
        <header
          className={`shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-sm ${headerX} ${headerPad} ${
            variant === 'canvas' ? 'shadow-sm z-10' : ''
          }`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0 flex-1">
              <h2 className={`font-bold text-slate-900 leading-tight ${titleClass}`}>{meta.title}</h2>
              <p
                className={`mt-1 text-slate-600 leading-snug max-w-3xl ${
                  presentationMode ? 'text-sm sm:text-base' : 'text-sm'
                } ${
                  variant === 'canvas'
                    ? 'hidden md:block md:line-clamp-2 lg:line-clamp-none'
                    : ''
                }`}
              >
                {description}
              </p>
            </div>
            {actions ? (
              <div className="flex flex-wrap gap-2 shrink-0 items-center justify-end">{actions}</div>
            ) : null}
          </div>
        </header>
      )}

      <div
        className={
          variant === 'canvas'
            ? 'flex-1 min-h-0 overflow-hidden flex flex-col'
            : 'flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 sm:px-6 py-4 sm:py-6 flex flex-col min-h-0'
        }
      >
        {children}
      </div>
    </div>
  );
}
