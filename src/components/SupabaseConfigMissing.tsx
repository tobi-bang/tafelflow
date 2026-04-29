import React from 'react';

/**
 * Vollbild-Hinweis, wenn VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlen (Build ohne korrekte ENV).
 */
export default function SupabaseConfigMissing() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-900 p-4 text-slate-100 sm:p-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-600 bg-slate-800/80 p-5 shadow-xl sm:p-8">
        <h1 className="text-xl font-bold text-white mb-2">TafelFlow – Konfiguration fehlt</h1>
        <p className="text-slate-300 text-sm leading-relaxed mb-6">
          Die Verbindung zu Supabase ist nicht eingerichtet. Ohne die folgenden Umgebungsvariablen kann die App nicht
          betrieben werden (kein Demo- oder Ersatzmodus).
        </p>
        <ul className="text-sm font-mono text-amber-200/95 space-y-2 mb-6 bg-slate-950/50 rounded-xl p-4 border border-slate-700">
          <li>VITE_SUPABASE_URL</li>
          <li>VITE_SUPABASE_ANON_KEY</li>
        </ul>
        <div className="text-slate-400 text-sm space-y-3">
          <p>
            <strong className="text-slate-200">Vercel:</strong> Project → Settings → Environment Variables → für Production
            (und Preview) eintragen → erneut deployen.
          </p>
          <p>
            <strong className="text-slate-200">Lokal:</strong> Datei <code className="text-amber-200">.env.local</code>{' '}
            anlegen (siehe <code className="text-amber-200">.env.example</code>) und Dev-Server neu starten.
          </p>
        </div>
      </div>
    </div>
  );
}
