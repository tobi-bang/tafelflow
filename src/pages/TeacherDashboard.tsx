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

  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
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
      <header className="flex flex-col gap-6 mb-12 md:flex-row md:justify-between md:items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Lehrkraft-Bereich</h1>
          <p className="text-slate-500 mt-1">
            Geschützt: nur für Lehrkräfte. Hier erstellst und verwaltest du Sitzungen und Freigaben für SuS.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-semibold flex items-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
          >
            <Plus className="w-5 h-5" />
            Neue Sitzung
          </button>
          <button
            type="button"
            onClick={logout}
            className="bg-white text-slate-700 border border-slate-200 px-5 py-3 rounded-2xl font-semibold flex items-center gap-2 hover:bg-slate-50 transition-all"
            title="Abmelden"
          >
            <LogOut className="w-5 h-5" />
            Abmelden
          </button>
        </div>
      </header>

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
