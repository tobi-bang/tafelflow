import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { rowToSession } from '../lib/dbMap';
import type { Session } from '../types';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ExternalLink, Presentation, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { requireTeacher } from '../lib/role';

export default function TeacherDashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [newSessionName, setNewSessionName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [authReady, setAuthReady] = useState(false);
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
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { data: { user: u } } = await supabase.auth.getUser();
        if (cancelled || !u) return;
        const uid = u.id;
        const ok = await requireTeacher();
        if (!ok) {
          navigate('/login', { replace: true });
          return;
        }
        setAuthReady(true);
        await loadSessions(uid);

        ch = supabase
          .channel(`teacher-dash-${uid}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'session_members',
              filter: `user_id=eq.${uid}`,
            },
            () => loadSessions(uid)
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
  }, [loadSessions, navigate]);

  const createSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim() || newPin.length < 4) {
      alert('Bitte Namen eingeben und eine PIN mit mindestens 4 Zeichen setzen.');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('create_session', {
        p_name: newSessionName.trim(),
        p_pin: newPin,
      });

      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      const sessionId =
        (row?.out_session_id as string | undefined) ??
        (row?.session_id as string | undefined);
      const roomCode =
        (row?.out_room_code as string | undefined) ??
        (row?.room_code as string | undefined);
      if (!sessionId || !roomCode) throw new Error('Keine Antwort vom Server');

      setNewSessionName('');
      setNewPin('');
      setIsCreating(false);
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) await loadSessions(u.id);
      alert(
        `Sitzung erstellt.\n\nRaumcode für SuS: ${roomCode}\n\nHast du dir die PIN notiert? Sie wird nicht noch einmal angezeigt.`
      );
      navigate(`/session/${sessionId}?board=1`);
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

  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  if (!authReady) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-7xl px-4 py-6 sm:px-6 sm:py-10 md:py-12">
      <header className="mb-8 flex flex-col gap-5 md:mb-12 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold text-slate-900 sm:text-3xl">Lehrkraft-Bereich</h1>
          <p className="text-slate-500 mt-1">
            Geschützt: nur für Lehrkräfte. Hier erstellst und verwaltest du Sitzungen und Freigaben für SuS.
          </p>
        </div>
        <div className="grid w-full grid-cols-1 gap-3 sm:w-auto sm:grid-cols-2 md:flex md:shrink-0 md:flex-wrap">
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            Neue Sitzung
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700 transition-all hover:bg-slate-50"
            title="Abmelden"
          >
            <LogOut className="w-5 h-5" />
            Abmelden
          </button>
        </div>
      </header>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence>
          {sessions.map((session) => (
            <motion.div
              key={session.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="group flex min-w-0 flex-col justify-between rounded-3xl border border-slate-100 bg-white p-4 shadow-sm sm:p-6"
            >
              <div>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <h3 className="min-w-0 break-words text-lg font-bold text-slate-900 sm:text-xl">{session.name}</h3>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
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
                  onClick={() => navigate(`/session/${session.id}?board=1`)}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-medium text-white transition-colors hover:bg-slate-800"
                >
                  Am Board öffnen
                  <ExternalLink className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteSession(session.id)}
                  className="min-h-12 min-w-12 rounded-xl p-3 text-slate-400 transition-all hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Sitzung löschen"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {sessions.length === 0 && !isCreating && (
          <div className="col-span-full rounded-3xl border-2 border-dashed border-slate-200 bg-white px-4 py-16 text-center sm:py-24">
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
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-slate-900/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-6 sm:pb-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-8"
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
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="min-h-12 flex-1 rounded-xl px-4 py-3 font-medium text-slate-600 hover:bg-slate-50"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="min-h-12 flex-1 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white shadow-lg hover:bg-blue-700"
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
