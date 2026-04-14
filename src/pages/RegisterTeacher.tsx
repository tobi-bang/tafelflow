import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Presentation, UserPlus } from 'lucide-react';
import { motion } from 'motion/react';
import AppShareQrPanel from '../components/AppShareQrPanel';

function getAuthRedirectUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/auth/callback`;
}

export default function RegisterTeacher() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
        },
      });
      if (signUpErr) throw signUpErr;

      if (data.session) {
        navigate('/login?notice=registered', { replace: true });
        return;
      }

      setInfo(
        'Bestätigungs-E-Mail wurde gesendet (falls E-Mail-Bestätigung aktiv ist). ' +
          'Danach: Rolle „teacher“ in Supabase (profiles) setzen lassen, dann anmelden.'
      );
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Registrierung fehlgeschlagen.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-br from-slate-50 to-blue-50 p-6 py-10">
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

        <h2 className="text-2xl font-bold text-center mb-2">Konto registrieren</h2>
        <p className="text-slate-500 text-center text-sm mb-6">
          Lehrkraft-Zugang: Nach der Registrierung muss in Supabase die Rolle <strong>teacher</strong> für dein Konto
          gesetzt werden (siehe Deployment-Doku), sofern kein automatischer Workflow existiert.
        </p>

        {error && (
          <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-medium mb-4 border border-rose-100">
            {error}
          </div>
        )}
        {info && (
          <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm mb-4 border border-blue-100">{info}</div>
        )}

        <form onSubmit={handleRegister} className="space-y-5">
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
              placeholder="Mindestens 6 Zeichen (Supabase-Vorgabe beachten)"
              minLength={6}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Registrieren…' : 'Registrieren'}
            {!loading && <UserPlus className="w-5 h-5" />}
          </button>
        </form>

        <div className="mt-8 pt-8 border-t border-slate-100 text-center space-y-2">
          <Link to="/login" className="text-blue-600 font-medium hover:underline block">
            Bereits ein Konto? Zur Anmeldung
          </Link>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-slate-400 hover:text-slate-600 font-medium transition-colors"
          >
            Zurück zur Startseite
          </button>
        </div>
      </motion.div>
      <div className="w-full max-w-lg shrink-0">
        <AppShareQrPanel variant="compact" />
      </div>
    </div>
  );
}
