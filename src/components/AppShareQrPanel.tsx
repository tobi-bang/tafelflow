import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode } from 'lucide-react';
import { buildAbsoluteUrl, getAppQrUrlForPath, getDefaultAppQrUrl, isPublicShareablePath } from '../lib/qrAppUrl';

const STORAGE_KEY = 'tafelflow_qr_use_current_page';

function readPreferCurrent(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePreferCurrent(v: boolean) {
  try {
    sessionStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

type Props = {
  /** Kompaktere Darstellung z. B. am Seitenende */
  variant?: 'default' | 'compact';
  /** Standard-Ziel statt app-weit /login (z. B. „/“, „/join“ für SuS-Einstieg). */
  defaultPath?: string;
};

function useQrPixelSize(variant: 'default' | 'compact'): number {
  const read = useCallback(() => {
    if (typeof window === 'undefined') return variant === 'compact' ? 136 : 160;
    const w = window.innerWidth;
    if (w < 360) return variant === 'compact' ? 112 : 128;
    if (w < 420) return variant === 'compact' ? 124 : 144;
    if (w < 640) return variant === 'compact' ? 132 : 156;
    return variant === 'compact' ? 140 : 168;
  }, [variant]);

  const [size, setSize] = useState(read);

  useEffect(() => {
    setSize(read());
    const onResize = () => setSize(read());
    window.addEventListener('resize', onResize, { passive: true });
    const mq = window.matchMedia('(orientation: portrait)');
    mq.addEventListener('change', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      mq.removeEventListener('change', onResize);
    };
  }, [read]);

  return size;
}

/**
 * QR zur App-Weitergabe: standardmäßig Anmeldeseite (/login), optional defaultPath oder aktuelle URL auf öffentlichen Routen.
 */
export default function AppShareQrPanel({ variant = 'default', defaultPath }: Props) {
  const { pathname, search } = useLocation();
  const [useCurrentPage, setUseCurrentPage] = useState(readPreferCurrent);
  const qrSize = useQrPixelSize(variant);

  useEffect(() => {
    setUseCurrentPage(readPreferCurrent());
  }, [pathname, search]);

  const shareable = isPublicShareablePath(pathname);
  const defaultUrl = useMemo(
    () => (defaultPath ? getAppQrUrlForPath(defaultPath) : getDefaultAppQrUrl()),
    [defaultPath],
  );
  const currentUrl = useMemo(() => buildAbsoluteUrl(pathname, search), [pathname, search]);

  const qrValue = useCurrentPage && shareable ? currentUrl : defaultUrl;

  const onToggle = (next: boolean) => {
    setUseCurrentPage(next);
    writePreferCurrent(next);
  };

  const pad = variant === 'compact' ? 'p-4 sm:p-5' : 'p-4 sm:p-6';
  const titleCls = variant === 'compact' ? 'text-base sm:text-lg' : 'text-lg';

  return (
    <section
      className={`max-w-full rounded-2xl border border-slate-200 bg-white shadow-sm ${pad}`}
      aria-labelledby="app-share-qr-heading"
    >
      <div className="flex max-w-full flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:gap-6 sm:text-left">
        <div className="flex w-full max-w-[min(100%,280px)] shrink-0 justify-center sm:w-auto sm:max-w-none sm:justify-start">
          <div className="rounded-2xl border border-slate-100 bg-white p-2 shadow-inner sm:p-3">
            <QRCodeSVG value={qrValue} size={qrSize} level="M" includeMargin />
          </div>
        </div>
        <div className="min-w-0 w-full max-w-full flex-1">
          <div className="mb-2 flex items-center justify-center gap-2 sm:justify-start">
            <QrCode className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
            <h2 id="app-share-qr-heading" className={`font-bold text-slate-900 ${titleCls}`}>
              App per QR teilen
            </h2>
          </div>
          <p className="text-pretty text-sm text-slate-600">
            Standard ist die <strong className="font-semibold text-slate-800">Einstiegs-URL</strong> für dieses Panel (
            <span className="break-all font-mono text-xs text-blue-700">{defaultUrl}</span>
            ) – z. B. Startseite, Beitritt (<code className="text-xs">/join</code>) oder Anmeldung, je nach Seite.
          </p>

          {shareable ? (
            <label className="mt-4 flex min-h-[48px] cursor-pointer touch-manipulation items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-left text-sm text-slate-800">
              <input
                type="checkbox"
                checked={useCurrentPage}
                onChange={(e) => onToggle(e.target.checked)}
                className="mt-1 size-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="min-w-0">
                <span className="font-semibold">Stattdessen diese Seite verlinken</span>
                <span className="mt-1 block break-all font-mono text-xs text-slate-600">{currentUrl}</span>
              </span>
            </label>
          ) : (
            <p className="mt-3 text-pretty text-xs text-slate-500">
              Auf dieser Route ist die aktuelle URL nicht als QR-Ziel vorgesehen – es wird die voreingestellte Adresse
              verwendet.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(qrValue);
                alert('Link kopiert!');
              }}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Link kopieren
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
