import React, {useEffect, useMemo, useState} from 'react';
import {useLocation} from 'react-router-dom';
import {QRCodeSVG} from 'qrcode.react';
import {QrCode} from 'lucide-react';
import {buildAbsoluteUrl, getAppQrUrlForPath, getDefaultAppQrUrl, isPublicShareablePath} from '../lib/qrAppUrl';

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
  /** Standard-Ziel statt app-weit /login (z. B. „/“ auf der Startseite, „/join“ für SuS-Einstieg). */
  defaultPath?: string;
};

/**
 * QR zur App-Weitergabe: standardmäßig Hauptseite (/), optional aktuelle URL auf öffentlichen Routen.
 */
export default function AppShareQrPanel({variant = 'default', defaultPath}: Props) {
  const {pathname, search} = useLocation();
  const [useCurrentPage, setUseCurrentPage] = useState(readPreferCurrent);

  useEffect(() => {
    setUseCurrentPage(readPreferCurrent());
  }, [pathname, search]);

  const shareable = isPublicShareablePath(pathname);
  const defaultUrl = useMemo(
    () => (defaultPath ? getAppQrUrlForPath(defaultPath) : getDefaultAppQrUrl()),
    [defaultPath],
  );
  const currentUrl = useMemo(() => buildAbsoluteUrl(pathname, search), [pathname, search]);

  const qrValue =
    useCurrentPage && shareable ? currentUrl : defaultUrl;

  const onToggle = (next: boolean) => {
    setUseCurrentPage(next);
    writePreferCurrent(next);
  };

  const pad = variant === 'compact' ? 'p-4' : 'p-6';
  const titleCls = variant === 'compact' ? 'text-base' : 'text-lg';

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${pad}`}
      aria-labelledby="app-share-qr-heading"
    >
      <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left sm:gap-6">
        <div className="shrink-0 rounded-2xl border border-slate-100 bg-white p-3 shadow-inner">
          <QRCodeSVG value={qrValue} size={variant === 'compact' ? 140 : 168} level="M" includeMargin />
        </div>
        <div className="mt-4 min-w-0 flex-1 sm:mt-0">
          <div className="mb-2 flex items-center justify-center gap-2 sm:justify-start">
            <QrCode className="h-5 w-5 text-blue-600" aria-hidden />
            <h2 id="app-share-qr-heading" className={`font-bold text-slate-900 ${titleCls}`}>
              App per QR teilen
            </h2>
          </div>
          <p className="text-sm text-slate-600">
            Standard ist die{' '}
            <strong className="font-semibold text-slate-800">voreingestellte Einstiegs-URL</strong> (
            <span className="font-mono text-xs text-blue-700">{defaultUrl}</span>
            ) – in der Regel die <strong className="font-semibold text-slate-800">Anmeldeseite</strong> oder eine auf
            dieser Seite gewählte Haupt-Adresse.
          </p>

          {shareable ? (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-left text-sm text-slate-800 touch-manipulation min-h-[48px]">
              <input
                type="checkbox"
                checked={useCurrentPage}
                onChange={(e) => onToggle(e.target.checked)}
                className="mt-1 size-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="font-semibold">Stattdessen diese Seite verlinken</span>
                <span className="mt-1 block font-mono text-xs text-slate-600 break-all">{currentUrl}</span>
              </span>
            </label>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Auf dieser Route ist die aktuelle URL nicht als QR-Ziel vorgesehen – es wird die Hauptseite verwendet.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(qrValue);
                alert('Link kopiert!');
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px]"
            >
              Link kopieren
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
