import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, ensureAnonymousSession, isSupabaseConfigured } from '../lib/supabase';
import { Presentation, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

export default function StudentJoin() {
  const { roomCode: roomCodeParam } = useParams<{ roomCode: string }>();
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [studentName, setStudentName] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const isManual = !roomCodeParam;
  const codeFromUrl = roomCodeParam ? roomCodeParam : null;

  useEffect(() => {
    if (!codeFromUrl) return;
    if (!isSupabaseConfigured) {
      setError('Supabase nicht konfiguriert – siehe .env.local.');
      return;
    }

    (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_session_join_preview', {
        p_room_code: codeFromUrl,
      });
      if (rpcError) {
        setError('Sitzung konnte nicht geladen werden.');
        return;
      }
      const row = Array.isArray(data) ? data[0] : null;
      if (row?.session_name) setSessionName(String(row.session_name));
      else setError('Sitzung nicht gefunden oder beendet.');
    })();
  }, [codeFromUrl]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = isManual ? manualCode.trim() : codeFromUrl;
    if (!code || !studentName.trim()) return;

    setLoading(true);
    setError(null);
    try {
      if (!isSupabaseConfigured) {
        setError('Supabase nicht konfiguriert (.env.local).');
        return;
      }
      await ensureAnonymousSession();
      await supabase.auth.updateUser({
        data: { display_name: studentName.trim() },
      });

      const { data, error: joinErr } = await supabase.rpc('join_session_as_student', {
        p_room_code: code,
        p_display_name: studentName.trim(),
      });

      if (joinErr) throw joinErr;
      const sessionId = data as string;
      if (!sessionId) throw new Error('Keine Sitzungs-ID');
      navigate(`/session/${sessionId}`);
    } catch (err) {
      console.error(err);
      setError('Beitritt fehlgeschlagen. Raumcode prüfen (oder Sitzung ist beendet).');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-6">
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

        <h2 className="text-2xl font-bold text-center mb-2">Schüler beitreten</h2>
        <p className="text-slate-500 text-center mb-8">
          {sessionName
            ? `Du trittst der Sitzung „${sessionName}“ bei.`
            : 'Gib Raumcode und Anzeigenamen ein (Pseudonym möglich).'}
        </p>

        {error && (
          <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-medium mb-6 border border-rose-100">
            {error}
          </div>
        )}

        <form onSubmit={handleJoin} className="space-y-6">
          {isManual && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Raumcode</label>
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                placeholder="z. B. AB12CD34"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none font-mono uppercase"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Anzeigename (Pseudonym)</label>
            <input
              autoFocus
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="z. B. Team Blau"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Beitreten…' : 'Sitzung beitreten'}
            {!loading && <ArrowRight className="w-5 h-5" />}
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

