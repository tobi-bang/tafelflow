import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { requireTeacher } from '../lib/role';
import { Presentation, LogIn } from 'lucide-react';
import { motion } from 'motion/react';

export default function LoginTeacher() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sessionBlocked, setSessionBlocked] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const errQ = searchParams.get('error');
    const notice = searchParams.get('notice');
    if (!errQ && !notice) return;
    if (errQ) setError(decodeURIComponent(errQ));
    if (notice === 'no_teacher') {
      setInfo(
        'Dieses Konto hat keine Lehrkraft-Rolle. Nur der Administrator kann in Supabase die Rolle „teacher“ setzen (Tabelle profiles).'
      );
    }
    const next = new URLSearchParams(searchParams);
    next.delete('error');
    next.delete('notice');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session?.user) return;
      const ok = await requireTeacher();
      if (!cancelled && ok) {
        navigate('/teacher', { replace: true });
        return;
      }
      if (!cancelled && session.user) {
        setSessionBlocked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSignOutOther = async () => {
    await supabase.auth.signOut();
    setSessionBlocked(false);
    setInfo(null);
    setError(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) throw signInErr;
      const ok = await requireTeacher();
      if (!ok) {
        await supabase.auth.signOut();
        setError(
          'Kein Lehrkraft-Zugriff. Neue Konten werden nur administrativ angelegt – bitte den Administrator kontaktieren.'
        );
        return;
      }
      navigate('/teacher', { replace: true });
    } catch (err) {
      console.error(err);
      setError('Login fehlgeschlagen. E-Mail und Passwort prüfen oder den Administrator kontaktieren.');
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

        <h2 className="text-2xl font-bold text-center mb-2">Anmeldung Lehrkräfte</h2>
        <p className="text-slate-500 text-center text-sm mb-2">
          Nur für bestehende, vom Administrator angelegte Konten. Es gibt keine öffentliche Selbstregistrierung.
        </p>
        <p className="text-slate-400 text-center text-xs mb-8">
          Schülerinnen und Schüler nutzen die App ohne eigenes Konto über „Schüler beitreten“.
        </p>

        {sessionBlocked && (
          <div className="bg-amber-50 text-amber-900 p-4 rounded-xl text-sm font-medium mb-4 border border-amber-200">
            <p className="mb-3">Du bist angemeldet, aber ohne Lehrkraft-Rolle – das Dashboard ist nicht erreichbar.</p>
            <button
              type="button"
              onClick={handleSignOutOther}
              className="w-full py-2.5 rounded-xl bg-white border border-amber-300 font-semibold hover:bg-amber-100/50"
            >
              Abmelden und mit anderem Konto anmelden
            </button>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-medium mb-6 border border-rose-100">
            {error}
          </div>
        )}
        {info && (
          <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm mb-6 border border-blue-100">{info}</div>
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
              autoComplete="email"
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
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || sessionBlocked}
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
