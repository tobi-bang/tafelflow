import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Users, Presentation, ShieldCheck, LogOut } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { requireTeacher } from '../lib/role';

export default function Home() {
  const navigate = useNavigate();
  const [teacherSignedIn, setTeacherSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user || cancelled) return;
      const ok = await requireTeacher();
      if (!cancelled) setTeacherSignedIn(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    setTeacherSignedIn(false);
  };

  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-hidden bg-gradient-to-br from-blue-50 to-indigo-50">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex min-w-0 items-center gap-2">
          <div className="shrink-0 rounded-lg bg-blue-600 p-2">
            <Presentation className="h-6 w-6 text-white" />
          </div>
          <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">TafelFlow</h1>
        </div>
        {teacherSignedIn ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/teacher')}
              className="min-h-11 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 sm:px-4"
            >
              Sitzungen
            </button>
            <button
              type="button"
              onClick={logout}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-600 hover:bg-rose-50 hover:text-rose-700"
              title="Abmelden"
              aria-label="Abmelden"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="hidden text-xs font-medium text-slate-500 sm:block">
            Geschützt für Lehrkräfte · reduziert für SuS
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-10 pt-6 text-center sm:px-6 sm:pb-16 sm:pt-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h2 className="mb-4 text-balance text-3xl font-extrabold leading-tight text-slate-900 sm:mb-6 sm:text-4xl md:text-5xl lg:text-6xl">
            Starte jetzt <span className="text-blue-600">den richtigen Zugang</span>.
          </h2>
          <p className="mx-auto mb-8 max-w-2xl text-pretty text-base text-slate-600 sm:mb-10 sm:text-lg md:text-xl">
            Lehrkräfte verwalten und geben Inhalte frei. Schülerinnen und Schüler sehen nur, was im Unterricht freigeschaltet
            ist.
          </p>

          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 text-left sm:gap-5 md:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate(teacherSignedIn ? '/teacher' : '/login')}
              className="group min-h-[44px] rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:p-7"
            >
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="shrink-0 rounded-2xl bg-blue-600 p-3 text-white">
                  <GraduationCap className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold text-slate-900 sm:text-xl">
                      {teacherSignedIn ? 'Zum Lehrkraft-Bereich' : 'Lehrkraft anmelden'}
                    </span>
                    <ShieldCheck className="h-5 w-5 shrink-0 text-blue-600 opacity-80" />
                  </div>
                  <p className="mt-1 text-sm text-slate-600 sm:text-base">
                    Geschütztes Dashboard: Sitzung erstellen, Inhalte freigeben, sperren und Ergebnisse exportieren.
                  </p>
                  <p className="mt-3 text-xs text-slate-400 sm:text-sm">
                    {teacherSignedIn
                      ? 'Angemeldet · Sitzungen wechseln oder neue Sitzung starten'
                      : 'E-Mail + Passwort · Registrierung über „Noch kein Konto?“'}
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigate('/join')}
              className="group min-h-[44px] rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:p-7"
            >
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="shrink-0 rounded-2xl bg-emerald-600 p-3 text-white">
                  <Users className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-bold text-slate-900 sm:text-xl">Schüler beitreten</div>
                  <p className="mt-1 text-sm text-slate-600 sm:text-base">
                    Raumcode + Name. Du siehst nur freigegebene Bereiche – ohne Verwaltungsfunktionen.
                  </p>
                  <p className="mt-3 text-xs text-slate-400 sm:text-sm">Kein Login nötig</p>
                </div>
              </div>
            </button>
          </div>
        </motion.div>
      </main>

      <footer className="border-t border-slate-200/80 bg-white/90 py-6 sm:py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <p className="text-center text-sm text-slate-500 sm:text-base">© 2026 TafelFlow. TobCreator</p>
        </div>
      </footer>
    </div>
  );
}
