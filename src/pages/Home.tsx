import React from 'react';
import type { AppUser } from '../types';
import { useNavigate } from 'react-router-dom';
import { isSupabaseConfigured, isLocalDemo } from '../lib/supabase';
import { Monitor, Users, Presentation, ClipboardList, Cloud, Share2 } from 'lucide-react';
import { motion } from 'motion/react';

interface HomeProps {
  user: AppUser | null;
}

export default function Home({ user: _user }: HomeProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {isLocalDemo && (
        <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-900 text-center text-sm py-3 px-4">
          <strong>Lokaler Demo-Modus:</strong> Daten liegen nur in diesem Browser (sessionStorage). Zum späteren Einsatz mit echter Cloud:{' '}
          <code className="bg-emerald-100 px-1 rounded">VITE_LOCAL_DEMO</code> entfernen und Supabase in{' '}
          <code className="bg-emerald-100 px-1 rounded">.env.local</code> eintragen.
        </div>
      )}
      {!isSupabaseConfigured && !isLocalDemo && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-center text-sm py-3 px-4">
          <strong>Hinweis:</strong> Für einen schnellen Test ohne Cloud setze{' '}
          <code className="bg-amber-100 px-1 rounded">VITE_LOCAL_DEMO=true</code> in <code className="bg-amber-100 px-1 rounded">.env.local</code> und starte den Dev-Server neu. Oder trage Supabase-URL und anon-Key ein (siehe{' '}
          <code className="bg-amber-100 px-1 rounded">.env.example</code>).
        </div>
      )}
      <header className="p-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Presentation className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">TafelFlow</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate('/teacher')}
          className="text-slate-600 hover:text-blue-600 font-medium transition-colors"
        >
          Lehrkraft-Bereich
        </button>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-12 pb-24 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h2 className="text-5xl md:text-7xl font-extrabold text-slate-900 mb-6 leading-tight">
            Die interaktive Tafel <br />
            <span className="text-blue-600">für modernes Lernen.</span>
          </h2>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto mb-10">
            {isLocalDemo
              ? 'Du testest lokal im Browser: Raumcode & PIN für die Lehrkraft, SuS mit Raumcode und Pseudonym – ohne Online-Datenbank.'
              : 'Mit Supabase: Raumcode und PIN (anonym, ohne Google). SuS treten mit Raumcode und frei wählbarem Namen bei.'}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              type="button"
              onClick={() => navigate('/teacher')}
              className="w-full sm:w-auto bg-blue-600 text-white px-8 py-4 rounded-2xl text-lg font-semibold hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
            >
              Sitzung erstellen / anmelden
            </button>
            <button
              type="button"
              onClick={() => navigate('/join/manual')}
              className="w-full sm:w-auto bg-white text-slate-700 border border-slate-200 px-8 py-4 rounded-2xl text-lg font-semibold hover:bg-slate-50 transition-all shadow-sm"
            >
              Sitzung beitreten
            </button>
          </div>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 mt-32">
          <FeatureCard
            icon={<Monitor className="w-8 h-8 text-blue-500" />}
            title="Digitale Tafel"
            description="Freies Zeichnen und Schreiben in Echtzeit für alle Teilnehmer."
          />
          <FeatureCard
            icon={<ClipboardList className="w-8 h-8 text-indigo-500" />}
            title="Brainstorming"
            description="Sammle Ideen mit Sticky Notes und gruppiere sie interaktiv."
          />
          <FeatureCard
            icon={<Cloud className="w-8 h-8 text-cyan-500" />}
            title="Wortwolken"
            description="Visualisiere Begriffe und Meinungen live als dynamische Cloud."
          />
          <FeatureCard
            icon={<Users className="w-8 h-8 text-emerald-500" />}
            title="Echtzeit-Umfragen"
            description="Erstelle schnelle Umfragen und sieh die Ergebnisse sofort."
          />
          <FeatureCard
            icon={<Share2 className="w-8 h-8 text-amber-500" />}
            title="QR-Code Beitritt"
            description="SuS scannen den Link zum Raumcode – ohne PIN."
          />
          <FeatureCard
            icon={<Presentation className="w-8 h-8 text-rose-500" />}
            title="Anonym & PIN-geschützt"
            description="Kein Google-Login: Steuerung nur mit Raumcode und PIN."
          />
        </div>
      </main>

      <footer className="border-t border-slate-200 py-12 bg-white">
        <div className="max-w-7xl mx-auto px-6 text-center text-slate-500">
          <p>© 2026 TafelFlow. Entwickelt für Schulen von morgen.</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <motion.div whileHover={{ y: -5 }} className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 text-left">
      <div className="mb-4">{icon}</div>
      <h3 className="text-xl font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600">{description}</p>
    </motion.div>
  );
}
