import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, ensureAnonymousSession } from '../lib/supabase';
import { Presentation, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import AppShareQrPanel from '../components/AppShareQrPanel';

type JoinPreviewRow = {
  session_id?: string;
  session_name?: string;
  room_code?: string;
  ideas_require_display_name?: boolean;
};

export default function StudentJoin() {
  const { roomCode: roomCodeParam, sessionId: sessionIdParam } = useParams<{
    roomCode: string;
    sessionId: string;
  }>();
  const [searchParams] = useSearchParams();
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [studentName, setStudentName] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(null);
  const [resolvedRoomCode, setResolvedRoomCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideasRequireDisplayName, setIdeasRequireDisplayName] = useState<boolean | null>(null);
  const navigate = useNavigate();

  const sessionFromQuery = searchParams.get('session')?.trim() || null;
  const roomFromQuery = searchParams.get('room')?.trim().toUpperCase() || null;
  const roleFromQuery = searchParams.get('role')?.trim().toLowerCase() || '';
  const rolePreset = roleFromQuery === 'teacher' || roleFromQuery === 'student' ? roleFromQuery : null;
  const targetSessionId = sessionIdParam ?? sessionFromQuery;
  const codeFromUrl = roomCodeParam ? roomCodeParam : roomFromQuery;
  const isManual = !codeFromUrl && !targetSessionId;
  const codeForPreview = (isManual ? manualCode : codeFromUrl)?.trim().toUpperCase() || '';
  const roleChoice = useMemo<'student' | 'teacher'>(() => {
    if (rolePreset === 'teacher') return 'teacher';
    return 'student';
  }, [rolePreset]);

  useEffect(() => {
    if (targetSessionId && !roomFromQuery && !roomCodeParam) {
      let cancelled = false;
      setError(null);
      (async () => {
        const { data, error: sessionErr } = await supabase
          .from('sessions')
          .select('id, room_code, name, status, permissions')
          .eq('id', targetSessionId)
          .maybeSingle();
        if (cancelled) return;
        if (sessionErr || !data || data.status === 'archived') {
          setSessionName(null);
          setResolvedSessionId(null);
          setResolvedRoomCode(null);
          setIdeasRequireDisplayName(null);
          setError('Sitzung nicht gefunden oder beendet.');
          return;
        }
        setResolvedSessionId(String(data.id));
        setResolvedRoomCode(String(data.room_code ?? '').toUpperCase());
        setSessionName(String(data.name ?? ''));
        const p = data.permissions as Record<string, unknown> | null;
        setIdeasRequireDisplayName(p?.ideasRequireDisplayName !== false);
      })();
      return () => {
        cancelled = true;
      };
    }

    if (!codeForPreview) {
      setSessionName(null);
      setIdeasRequireDisplayName(null);
      setResolvedSessionId(targetSessionId ?? null);
      setResolvedRoomCode(null);
      if (isManual) setError(null);
      return;
    }

    let cancelled = false;
    setError(null);

    (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_session_join_preview', {
        p_room_code: codeForPreview,
      });
      if (cancelled) return;
      if (rpcError) {
        setSessionName(null);
        setIdeasRequireDisplayName(null);
        setError('Sitzung konnte nicht geladen werden.');
        return;
      }
      const row = (Array.isArray(data) ? data[0] : data) as JoinPreviewRow | null;
      if (row?.session_name) {
        setSessionName(String(row.session_name));
        setResolvedSessionId(typeof row.session_id === 'string' ? row.session_id : targetSessionId ?? null);
        setResolvedRoomCode(codeForPreview);
        // Entspricht SQL coalesce(..., true): nur explizites false = optionaler Name.
        setIdeasRequireDisplayName(row.ideas_require_display_name !== false);
        setError(null);
      } else {
        setSessionName(null);
        setResolvedSessionId(null);
        setResolvedRoomCode(null);
        setIdeasRequireDisplayName(null);
        setError('Sitzung nicht gefunden oder beendet.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [codeForPreview, isManual, roomCodeParam, roomFromQuery, targetSessionId]);

  const joinSettingsReady =
    Boolean(codeForPreview) && sessionName !== null && ideasRequireDisplayName !== null;
  const nameRequired = ideasRequireDisplayName === true;

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roleChoice === 'teacher') {
      if (!resolvedSessionId && !targetSessionId) {
        setError('Für die Lehrkraft-Ansicht fehlt eine gültige Sitzungs-ID.');
        return;
      }
      navigate(`/session/${resolvedSessionId ?? targetSessionId}`);
      return;
    }

    const code = isManual ? manualCode.trim().toUpperCase() : (resolvedRoomCode ?? codeFromUrl);
    if (!code) return;

    const nameTrim = studentName.trim();
    if (nameRequired && !nameTrim) return;

    setLoading(true);
    setError(null);
    try {
      await ensureAnonymousSession();
      try {
        await supabase.auth.updateUser({
          data: { display_name: nameTrim || null },
        });
      } catch (metaErr) {
        console.warn('updateUser display_name:', metaErr);
      }

      const { data, error: joinErr } = await supabase.rpc('join_session_as_student', {
        p_room_code: code,
        p_display_name: nameTrim,
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
            : codeForPreview
              ? 'Raumcode wird geprüft …'
              : 'Gib den Raumcode ein. Je nach Einstellung der Lehrkraft ist ein Anzeigename nötig oder optional.'}
        </p>

        {error && (
          <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-medium mb-6 border border-rose-100">
            {error}
          </div>
        )}

        <form onSubmit={handleJoin} className="space-y-6">
          {targetSessionId && rolePreset === null && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(`/session/${targetSessionId}`)}
                className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50"
              >
                Als Lehrkraft öffnen
              </button>
              <div className="text-xs text-slate-400 font-semibold">oder</div>
              <div className="flex-1 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 font-semibold text-sm text-center">
                Als SuS beitreten
              </div>
            </div>
          )}
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
          {nameRequired && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Anzeigename oder Team</label>
              <input
                autoFocus={!isManual}
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="z. B. Team Blau"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>
          )}
          {!nameRequired && joinSettingsReady && ideasRequireDisplayName === false && (
            <p className="text-sm text-slate-600">
              In dieser Sitzung ist ein Anzeigename optional – du kannst direkt beitreten.
            </p>
          )}

          <button
            type="submit"
            disabled={
              roleChoice === 'teacher'
                ? !(resolvedSessionId || targetSessionId) || loading
                :
              loading ||
              !codeForPreview ||
              !joinSettingsReady ||
              (nameRequired && !studentName.trim())
            }
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Beitreten…' : roleChoice === 'teacher' ? 'Als Lehrkraft öffnen' : 'Sitzung beitreten'}
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
      <div className="w-full max-w-lg shrink-0">
        <AppShareQrPanel variant="compact" defaultPath="/join" />
      </div>
    </div>
  );
}
