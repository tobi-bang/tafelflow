import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { requireTeacher } from '../lib/role';
import { Presentation, LogIn } from 'lucide-react';
import { motion } from 'motion/react';

function safeRedirectTarget(value: string | null): string {
  const target = value?.trim() || '/teacher';
  if (!target.startsWith('/') || target.startsWith('//')) return '/teacher';
  if (target.startsWith('/login') || target.startsWith('/register') || target.startsWith('/auth/callback')) {
    return '/teacher';
  }
  return target;
}

export default function LoginTeacher() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sessionBlocked, setSessionBlocked] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const redirectTarget = safeRedirectTarget(searchParams.get('redirect'));

  useEffect(() => {
    const errQ = searchParams.get('error');
    const notice = searchParams.get('notice');
    if (!errQ && !notice) return;
    if (errQ) setError(decodeURIComponent(errQ));
    if (notice === 'no_teacher') {
      setInfo('Dieses Konto hat keine Lehrkraft-Rolle. Bitte in Supabase profiles.role = teacher setzen oder Support kontaktieren.');
    }
    if (notice === 'registered') {
      setInfo('Registrierung erfolgreich. Wenn nötig E-Mail bestätigen. Anschließend Rolle „teacher“ setzen lassen, dann anmelden.');
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
        navigate(redirectTarget, { replace: true });
        return;
      }
      if (!cancelled && session.user) {
        setSessionBlocked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, redirectTarget]);

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
        setError('Kein Lehrkraft-Zugriff. Die Rolle „teacher“ fehlt in der Datenbank (profiles) – bitte Admin informieren.');
        return;
      }
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      console.error(err);
      setError('Login fehlgeschlagen. E-Mail/Passwort prüfen.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh w-full max-w-full flex-col items-center justify-center overflow-x-hidden bg-gradient-to-br from-slate-50 to-blue-50 px-4 py-6 sm:p-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-5 shadow-2xl sm:p-8"
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
              className="min-h-12 w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-blue-500"
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
              className="min-h-12 w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || sessionBlocked}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-base font-bold text-white shadow-lg transition-all hover:bg-blue-700 disabled:opacity-50 sm:py-4 sm:text-lg"
          >
            {loading ? 'Anmelden…' : 'Anmelden'}
            {!loading && <LogIn className="w-5 h-5" />}
          </button>
        </form>

        <div className="mt-8 pt-8 border-t border-slate-100 text-center space-y-2">
          <Link to="/register" className="text-blue-600 font-medium hover:underline block">
            Noch kein Konto? Registrieren
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
    </div>
  );
}
