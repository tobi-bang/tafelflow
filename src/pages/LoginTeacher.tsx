import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { requireTeacher } from '../lib/role';
import { Presentation, LogIn } from 'lucide-react';
import { motion } from 'motion/react';

export default function LoginTeacher() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) throw signInErr;
      const ok = await requireTeacher();
      if (!ok) {
        await supabase.auth.signOut();
        setError('Kein Lehrkraft-Zugriff. Bitte wende dich an die Admin-Instanz.');
        return;
      }
      navigate('/teacher');
    } catch (err) {
      console.error(err);
      setError('Login fehlgeschlagen. E-Mail/Passwort prüfen.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl border border-slate-100"
      >
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Presentation className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">TafelFlow</h1>
        </div>

        <h2 className="text-2xl font-bold text-center mb-2">Lehrkraft anmelden</h2>
        <p className="text-slate-500 text-center mb-8">
          Geschützter Bereich für Verwaltung, Freigaben und Moderation.
        </p>

        {error && (
          <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-medium mb-6 border border-rose-100">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">E-Mail</label>
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@schule.de"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Passwort</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Anmelden…' : 'Anmelden'}
            {!loading && <LogIn className="w-5 h-5" />}
          </button>
        </form>

        <div className="mt-8 pt-8 border-t border-slate-100 text-center">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-slate-400 hover:text-slate-600 font-medium transition-colors"
          >
            Zurück zur Startseite
          </button>
        </div>
      </motion.div>
    </div>
  );
}

