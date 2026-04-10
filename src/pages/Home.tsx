import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Users, Presentation, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <header className="p-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Presentation className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">TafelFlow</h1>
        </div>
        <div className="text-xs text-slate-500 font-medium hidden sm:block">
          Lehrkräfte: nur Anmeldung · SuS ohne eigenes Konto
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-12 pb-24 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h2 className="text-4xl md:text-6xl font-extrabold text-slate-900 mb-6 leading-tight">
            Starte jetzt <span className="text-blue-600">den richtigen Zugang</span>.
          </h2>
          <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto mb-10">
            Lehrkräfte verwalten Sitzungen und Freigaben. Neue Lehrkraft-Konten werden nur administrativ angelegt – nicht über diese App.
            Schülerinnen und Schüler arbeiten ohne eigenes Benutzerkonto.
          </p>

          <div className="grid md:grid-cols-2 gap-5 max-w-4xl mx-auto text-left">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="group bg-white border border-slate-200 rounded-3xl p-7 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-start gap-4">
                <div className="bg-blue-600 text-white p-3 rounded-2xl shrink-0">
                  <GraduationCap className="w-7 h-7" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-slate-900">Lehrkraft anmelden</span>
                    <ShieldCheck className="w-5 h-5 text-blue-600 opacity-80" />
                  </div>
                  <p className="text-slate-600 mt-1">
                    Geschütztes Dashboard: Sitzungen, Freigaben, Sperren und Exporte. Nur mit vom Administrator angelegtem Konto.
                  </p>
                  <p className="text-sm text-slate-400 mt-3">E-Mail + Passwort · keine Selbstregistrierung</p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigate('/join')}
              className="group bg-white border border-slate-200 rounded-3xl p-7 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-start gap-4">
                <div className="bg-emerald-600 text-white p-3 rounded-2xl shrink-0">
                  <Users className="w-7 h-7" />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-bold text-slate-900">Schüler beitreten</div>
                  <p className="text-slate-600 mt-1">
                    Raumcode + Name. Du siehst nur freigegebene Bereiche – ohne Verwaltungsfunktionen.
                  </p>
                  <p className="text-sm text-slate-400 mt-3">Kein Benutzerkonto – nur Raumcode</p>
                </div>
              </div>
            </button>
          </div>
        </motion.div>
      </main>

      <footer className="border-t border-slate-200 py-12 bg-white">
        <div className="max-w-7xl mx-auto px-6 text-center text-slate-500">
          <p>© 2026 TafelFlow. TobCreator</p>
        </div>
      </footer>
    </div>
  );
}
