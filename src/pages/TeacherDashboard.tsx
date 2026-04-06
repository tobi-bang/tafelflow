import React, { useState, useEffect, useCallback } from 'react';
import { supabase, ensureAnonymousSession, isSupabaseConfigured, isLocalDemo } from '../lib/supabase';
import { rowToSession } from '../lib/dbMap';
import type { Session } from '../types';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ExternalLink, Presentation, KeyRound } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function TeacherDashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [newSessionName, setNewSessionName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [loginCode, setLoginCode] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const navigate = useNavigate();

  const loadSessions = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('session_members')
      .select('sessions(*)')
      .eq('user_id', uid)
      .eq('role', 'teacher');

    if (error) {
      console.error(error);
      return;
    }

    const list = (data ?? [])
      .map((row: { sessions: unknown }) => {
        const s = row.sessions;
        const one = Array.isArray(s) ? s[0] : s;
        return rowToSession(one as Record<string, unknown>);
      })
      .filter((s): s is Session => s !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    setSessions(list);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthReady(true);
      return;
    }

    let ch: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      try {
        await ensureAnonymousSession();
        const { data: { user: u } } = await supabase.auth.getUser();
        if (cancelled || !u) return;
        setAuthReady(true);
        await loadSessions(u.id);

        ch = supabase
          .channel(`teacher-dash-${u.id}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'session_members',
              filter: `user_id=eq.${u.id}`,
            },
            () => loadSessions(u.id)
          )
          .subscribe();
      } catch (e) {
        console.error(e);
        if (!cancelled) setAuthReady(true);
      }
    })();

    return () => {
      cancelled = true;
      if (ch) supabase.removeChannel(ch);
    };
  }, [loadSessions]);

  const createSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      alert('Bitte VITE_LOCAL_DEMO=true oder Supabase-Keys in .env.local setzen und den Server neu starten.');
      return;
    }
    if (!newSessionName.trim() || newPin.length < 4) {
      alert('Bitte Namen eingeben und eine PIN mit mindestens 4 Zeichen setzen.');
      return;
    }

    try {
      await ensureAnonymousSession();
      const { data, error } = await supabase.rpc('create_session', {
        p_name: newSessionName.trim(),
        p_pin: newPin,
      });

      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      const sessionId = row?.session_id as string | undefined;
      const roomCode = row?.room_code as string | undefined;
      if (!sessionId || !roomCode) throw new Error('Keine Antwort vom Server');

      setNewSessionName('');
      setNewPin('');
      setIsCreating(false);
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) await loadSessions(u.id);
      alert(
        `Sitzung erstellt.\n\nRaumcode für SuS: ${roomCode}\n\nHast du dir die PIN notiert? Sie wird nicht noch einmal angezeigt.`
      );
      navigate(`/session/${sessionId}`);
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Erstellen fehlgeschlagen';
      alert(msg);
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm('Sitzung wirklich löschen?')) return;
    const { error } = await supabase.from('sessions').delete().eq('id', id);
    if (error) {
      console.error(error);
      alert('Löschen fehlgeschlagen');
      return;
    }
    const { data: { user: u } } = await supabase.auth.getUser();
    if (u) await loadSessions(u.id);
  };

  const handleTeacherLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setLoginError('Supabase nicht konfiguriert (.env.local).');
      return;
    }
    setLoginError(null);
    if (loginCode.trim().length < 4 || loginPin.length < 4) {
      setLoginError('Raumcode und PIN (mind. 4 Zeichen) eingeben.');
      return;
    }
    setLoginLoading(true);
    try {
      await ensureAnonymousSession();
      const { data, error } = await supabase.rpc('join_session_as_teacher', {
        p_room_code: loginCode.trim(),
        p_pin: loginPin,
      });
      if (error) throw error;
      const sessionId = data as string;
      if (!sessionId) throw new Error('Ungültige Antwort');
      setLoginCode('');
      setLoginPin('');
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) await loadSessions(u.id);
      navigate(`/session/${sessionId}`);
    } catch (err: unknown) {
      console.error(err);
      setLoginError('Raumcode oder PIN ungültig.');
    } finally {
      setLoginLoading(false);
    }
  };

  if (!authReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      {!isSupabaseConfigured && !isLocalDemo && (
        <div className="mb-8 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl p-4 text-sm">
          Weder Demo- noch Supabase-Modus aktiv. Setze <code className="bg-rose-100 px-1 rounded">VITE_LOCAL_DEMO=true</code> oder Supabase-Keys in{' '}
          <code className="bg-rose-100 px-1 rounded">.env.local</code>.
        </div>
      )}
      <header className="flex flex-col gap-6 mb-12 md:flex-row md:justify-between md:items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Lehrkraft-Bereich</h1>
          <p className="text-slate-500 mt-1">
            Anonym: Raumcode und PIN – kein Google-Konto. Speichere Raumcode und PIN sicher; die PIN schützt deine Steuerungsrechte.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-semibold flex items-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 shrink-0"
        >
          <Plus className="w-5 h-5" />
          Neue Sitzung
        </button>
      </header>

      <section className="mb-12 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-slate-800 font-semibold">
          <KeyRound className="w-5 h-5 text-blue-600" />
          Mit bestehender Sitzung anmelden
        </div>
        <form onSubmit={handleTeacherLogin} className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">Raumcode</label>
            <input
              value={loginCode}
              onChange={(e) => setLoginCode(e.target.value.toUpperCase())}
              placeholder="z. B. AB12CD34"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none font-mono uppercase"
              autoComplete="off"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">PIN</label>
            <input
              type="password"
              value={loginPin}
              onChange={(e) => setLoginPin(e.target.value)}
              placeholder="••••"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            disabled={loginLoading}
            className="bg-slate-900 text-white px-6 py-3 rounded-xl font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loginLoading ? '…' : 'Anmelden'}
          </button>
        </form>
        {loginError && <p className="text-rose-600 text-sm mt-3">{loginError}</p>}
      </section>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence>
          {sessions.map((session) => (
            <motion.div
              key={session.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col justify-between group"
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-xl font-bold text-slate-900">{session.name}</h3>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      session.status === 'active'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {session.status}
                  </span>
                </div>
                <p className="text-slate-500 text-sm mb-2">
                  Raumcode:{' '}
                  <span className="font-mono font-bold text-slate-800">{session.room_code}</span>
                </p>
                <p className="text-slate-500 text-sm mb-6">
                  Erstellt am {new Date(session.createdAt).toLocaleDateString('de-DE')}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/session/${session.id}`)}
                  className="flex-1 bg-slate-900 text-white py-3 rounded-xl font-medium hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
                >
                  Öffnen
                  <ExternalLink className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteSession(session.id)}
                  className="p-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {sessions.length === 0 && !isCreating && (
          <div className="col-span-full py-24 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
            <Presentation className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500 text-lg">Noch keine Sitzungen in diesem Browser.</p>
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="text-blue-600 font-semibold mt-2 hover:underline"
            >
              Erste Sitzung starten
            </button>
          </div>
        )}
      </div>

      {isCreating && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
          >
            <h2 className="text-2xl font-bold mb-2">Neue Sitzung</h2>
            <p className="text-slate-500 text-sm mb-6">
              Du erhältst einen Raumcode für SuS. Die PIN schützt deine Lehrkraft-Rechte (notieren!).
            </p>
            <form onSubmit={createSession}>
              <label className="block text-sm font-medium text-slate-700 mb-2">Name der Sitzung</label>
              <input
                autoFocus
                type="text"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="z. B. Mathe 9b"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none mb-4"
              />
              <label className="block text-sm font-medium text-slate-700 mb-2">PIN (min. 4 Zeichen)</label>
              <input
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="Nur für dich – nicht für SuS"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none mb-6"
                autoComplete="new-password"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-50"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-xl font-semibold hover:bg-blue-700 shadow-lg"
                >
                  Erstellen
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

    </div>
  );
}
