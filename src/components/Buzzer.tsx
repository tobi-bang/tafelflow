import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  BellRing,
  CheckCircle2,
  Crown,
  Dice5,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Unlock,
  UserCheck,
  UsersRound,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { rowToBuzzerEvent, rowToBuzzerParticipant, rowToBuzzerSession } from '../lib/dbMap';
import type { BuzzerEvent, BuzzerParticipant, BuzzerSession, SessionPermissions } from '../types';

interface BuzzerProps {
  sessionId: string;
  isTeacher: boolean;
  permissions: SessionPermissions;
  presentationMode?: boolean;
}

type RealtimeState = 'connecting' | 'connected' | 'error';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

function displayNameFor(userId: string, participants: BuzzerParticipant[], fallback = 'Anonym'): string {
  return participants.find((p) => p.userId === userId)?.displayName || fallback;
}

function buzzerErrorMessage(message: string | undefined): string {
  const raw = (message || '').trim();
  if (!raw) return 'Der Buzzer konnte nicht gespeichert werden.';
  if (raw.includes('BUZZER_LOCKED')) return 'Der Buzzer ist gerade gesperrt.';
  if (raw.includes('BUZZER_EXCLUDED')) return 'Du bist für diese Runde gesperrt.';
  if (raw.includes('BUZZER_PAUSED')) return 'Fairness-Modus: Du pausierst in dieser Runde.';
  if (raw.includes('BUZZER_PERMISSION_DENIED')) return 'Der Buzzer ist für SuS nicht freigeschaltet.';
  if (raw.includes('BUZZER_SESSION_INACTIVE')) return 'Die Sitzung ist gerade nicht aktiv.';
  if (raw.includes('relation') && raw.includes('buzzer_')) {
    return 'Die Buzzer-Tabellen fehlen noch in Supabase. Bitte die Migration 011_buzzer.sql ausführen.';
  }
  return raw;
}

function playShortBuzz() {
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    setTimeout(() => void ctx.close(), 320);
  } catch {
    /* audio feedback is optional */
  }
}

export default function Buzzer({
  sessionId,
  isTeacher,
  permissions,
  presentationMode = false,
}: BuzzerProps) {
  const [buzzerSession, setBuzzerSession] = useState<BuzzerSession | null>(null);
  const [events, setEvents] = useState<BuzzerEvent[]>([]);
  const [participants, setParticipants] = useState<BuzzerParticipant[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [randomPick, setRandomPick] = useState<BuzzerEvent | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting');
  const [winnerPulse, setWinnerPulse] = useState(false);
  const lastWinnerIdRef = useRef<string | null>(null);

  const winner = events[0] ?? null;
  const studentLeader =
    !isTeacher && buzzerSession?.silentMode === false ? events.find((event) => event.position === 1) ?? null : null;
  const ownEvent = useMemo(
    () => events.find((event) => event.userId === currentUserId) ?? null,
    [currentUserId, events]
  );
  const currentParticipant = useMemo(
    () => participants.find((participant) => participant.userId === currentUserId) ?? null,
    [currentUserId, participants]
  );
  const queue = winner ? events.slice(1) : events;

  const load = useCallback(async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUserId(user?.id ?? null);

    if (user) {
      const { data: member } = await supabase
        .from('session_members')
        .select('display_name')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle();
      const name = typeof member?.display_name === 'string' && member.display_name.trim() ? member.display_name.trim() : null;
      setDisplayName(name);
    }

    const { data: sessionRow, error: sessionError } = await supabase
      .from('buzzer_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (sessionError) {
      setError(buzzerErrorMessage(sessionError.message));
      return;
    }

    if (!sessionRow) {
      setBuzzerSession(null);
      setEvents([]);
      setParticipants([]);
      return;
    }

    const nextSession = rowToBuzzerSession(sessionRow as Record<string, unknown>);
    setBuzzerSession(nextSession);

    const [{ data: eventRows, error: eventsError }, { data: participantRows, error: participantsError }] = await Promise.all([
      supabase
        .from('buzzer_events')
        .select('*')
        .eq('session_id', sessionId)
        .eq('round_id', nextSession.roundId)
        .order('position', { ascending: true }),
      supabase
        .from('buzzer_participants')
        .select('*')
        .eq('session_id', sessionId)
        .order('display_name', { ascending: true, nullsFirst: false }),
    ]);

    if (eventsError || participantsError) {
      setError(buzzerErrorMessage(eventsError?.message || participantsError?.message));
      return;
    }

    setEvents((eventRows ?? []).map((row) => rowToBuzzerEvent(row as Record<string, unknown>)));

    let nextParticipants = (participantRows ?? []).map((row) => rowToBuzzerParticipant(row as Record<string, unknown>));
    if (isTeacher) {
      const { data: memberRows } = await supabase
        .from('session_members')
        .select('session_id,user_id,display_name,role')
        .eq('session_id', sessionId)
        .eq('role', 'student');
      const byUser = new Map(nextParticipants.map((participant) => [participant.userId, participant]));
      for (const member of memberRows ?? []) {
        const userId = String((member as Record<string, unknown>).user_id ?? '');
        if (!userId || byUser.has(userId)) continue;
        byUser.set(userId, {
          sessionId,
          userId,
          displayName:
            typeof (member as Record<string, unknown>).display_name === 'string'
              ? String((member as Record<string, unknown>).display_name)
              : null,
          excluded: false,
          pausedNextRound: false,
          lastWonRoundId: null,
          updatedAt: '',
        });
      }
      nextParticipants = Array.from(byUser.values()).sort((a, b) =>
        (a.displayName || 'Anonym').localeCompare(b.displayName || 'Anonym', 'de')
      );
    }
    setParticipants(nextParticipants);
  }, [isTeacher, sessionId]);

  const ensureAndLoad = useCallback(async () => {
    const { error: ensureError } = await supabase.rpc('ensure_buzzer_session', { p_session_id: sessionId });
    if (ensureError) {
      setError(buzzerErrorMessage(ensureError.message));
      return;
    }
    await load();
  }, [load, sessionId]);

  useEffect(() => {
    void ensureAndLoad();
  }, [ensureAndLoad]);

  useEffect(() => {
    setRealtimeState('connecting');
    const channel = supabase
      .channel(`buzzer-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buzzer_sessions', filter: `session_id=eq.${sessionId}` },
        () => void load()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buzzer_events', filter: `session_id=eq.${sessionId}` },
        () => void load()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buzzer_participants', filter: `session_id=eq.${sessionId}` },
        () => void load()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeState('connected');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeState('error');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, sessionId]);

  useEffect(() => {
    if (!isTeacher || !winner) {
      lastWinnerIdRef.current = winner?.id ?? null;
      return;
    }
    if (lastWinnerIdRef.current === null) {
      lastWinnerIdRef.current = winner.id;
      return;
    }
    if (lastWinnerIdRef.current !== winner.id) {
      lastWinnerIdRef.current = winner.id;
      setWinnerPulse(true);
      playShortBuzz();
      const t = window.setTimeout(() => setWinnerPulse(false), 1100);
      return () => window.clearTimeout(t);
    }
  }, [isTeacher, winner]);

  const buzz = async () => {
    if (!permissions.buzzer || busy) return;
    setBusy('buzz');
    setError(null);
    setInfo(null);
    const { error: buzzError } = await supabase.rpc('buzzer_buzz', {
      p_session_id: sessionId,
      p_display_name: displayName,
    });
    if (buzzError) {
      setError(buzzerErrorMessage(buzzError.message));
    } else {
      setInfo('Dein Buzz wurde gespeichert.');
      await load();
    }
    setBusy(null);
  };

  const setLocked = async (locked: boolean) => {
    setBusy('lock');
    setError(null);
    const { error: lockError } = await supabase.rpc('buzzer_set_locked', {
      p_session_id: sessionId,
      p_locked: locked,
    });
    if (lockError) setError(buzzerErrorMessage(lockError.message));
    await load();
    setBusy(null);
  };

  const resetRound = async () => {
    setBusy('round');
    setError(null);
    setRandomPick(null);
    const { error: resetError } = await supabase.rpc('buzzer_reset_round', { p_session_id: sessionId });
    if (resetError) setError(buzzerErrorMessage(resetError.message));
    await load();
    setBusy(null);
  };

  const clearAll = async () => {
    if (!confirm('Alle Buzzer-Ereignisse, Pausen und Sperren in diesem Tool zurücksetzen?')) return;
    setBusy('all');
    setError(null);
    setRandomPick(null);
    const { error: clearError } = await supabase.rpc('buzzer_clear_all', { p_session_id: sessionId });
    if (clearError) setError(buzzerErrorMessage(clearError.message));
    await load();
    setBusy(null);
  };

  const setExcluded = async (userId: string, excluded: boolean) => {
    setBusy(userId);
    setError(null);
    const { error: excludedError } = await supabase.rpc('buzzer_set_participant_excluded', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_excluded: excluded,
    });
    if (excludedError) setError(buzzerErrorMessage(excludedError.message));
    await load();
    setBusy(null);
  };

  const updateMode = async (patch: Partial<Pick<BuzzerSession, 'fairnessMode' | 'silentMode'>>) => {
    if (!buzzerSession) return;
    setBusy('mode');
    setError(null);
    const payload: Record<string, boolean> = {};
    if (typeof patch.fairnessMode === 'boolean') payload.fairness_mode = patch.fairnessMode;
    if (typeof patch.silentMode === 'boolean') payload.silent_mode = patch.silentMode;
    const { error: modeError } = await supabase.from('buzzer_sessions').update(payload).eq('session_id', sessionId);
    if (modeError) setError(buzzerErrorMessage(modeError.message));
    await load();
    setBusy(null);
  };

  const pickRandom = () => {
    if (events.length === 0) return;
    const picked = events[Math.floor(Math.random() * events.length)];
    setRandomPick(picked);
  };

  if (isTeacher) {
    return (
      <div className={`mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-6 ${presentationMode ? 'text-lg' : ''}`}>
        {error && <StatusBox tone="error" message={error} />}
        {realtimeState !== 'connected' && (
          <StatusBox
            tone="warn"
            message={
              realtimeState === 'connecting'
                ? 'Realtime verbindet sich gerade.'
                : 'Realtime ist nicht verbunden. Die Anzeige kann verzögert sein.'
            }
          />
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <section
            className={`rounded-lg border bg-white p-5 shadow-sm transition-all sm:p-7 ${
              winnerPulse ? 'border-emerald-400 ring-4 ring-emerald-200' : 'border-slate-200'
            }`}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-wider text-slate-400">Erster Buzzer</p>
                <h2 className={`${presentationMode ? 'text-4xl md:text-6xl' : 'text-3xl md:text-5xl'} font-black text-slate-950`}>
                  {winner ? winner.displayName : 'Noch niemand'}
                </h2>
              </div>
              <div
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${
                  buzzerSession?.status === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {buzzerSession?.status === 'open' ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {buzzerSession?.status === 'open' ? 'Offen' : 'Gesperrt'}
              </div>
            </div>

            {winner ? (
              <motion.div
                key={winner.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid gap-3 sm:grid-cols-3"
              >
                <Metric label="Position" value={`#${winner.position}`} icon={<Crown className="h-5 w-5" />} />
                <Metric label="Zeitpunkt" value={formatTime(winner.createdAt)} icon={<BellRing className="h-5 w-5" />} />
                <Metric label="Runde" value={buzzerSession?.roundId.slice(0, 8) || '-'} icon={<RefreshCw className="h-5 w-5" />} />
              </motion.div>
            ) : (
              <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-slate-500">
                <div>
                  <BellRing className="mx-auto mb-3 h-10 w-10" />
                  <p className="font-semibold">Warte auf den ersten Buzz.</p>
                </div>
              </div>
            )}

            {randomPick && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-950">
                <p className="text-sm font-bold uppercase tracking-wider text-blue-700">Ausgelost</p>
                <p className="text-2xl font-black">{randomPick.displayName}</p>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-900">
              <UsersRound className="h-5 w-5 text-blue-600" />
              Steuerung
            </h3>
            <div className="grid grid-cols-1 gap-2">
              <ControlButton
                label="Runde zurücksetzen"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={() => void resetRound()}
                disabled={Boolean(busy)}
              />
              <ControlButton
                label={buzzerSession?.status === 'open' ? 'Buzzer sperren' : 'Buzzer öffnen'}
                icon={buzzerSession?.status === 'open' ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                onClick={() => void setLocked(buzzerSession?.status === 'open')}
                disabled={Boolean(busy || !buzzerSession)}
              />
              <ControlButton
                label="Alle zurücksetzen"
                icon={<RefreshCw className="h-4 w-4" />}
                onClick={() => void clearAll()}
                disabled={Boolean(busy)}
              />
              <ControlButton
                label="Aus Warteliste losen"
                icon={<Dice5 className="h-4 w-4" />}
                onClick={pickRandom}
                disabled={events.length === 0}
              />
            </div>

            <div className="mt-5 grid gap-2">
              <ModeToggle
                label="Fairness-Modus"
                description="Gewinner pausiert automatisch in der nächsten Runde."
                active={buzzerSession?.fairnessMode === true}
                onClick={() => void updateMode({ fairnessMode: !(buzzerSession?.fairnessMode === true) })}
                disabled={Boolean(busy || !buzzerSession)}
                icon={<UserCheck className="h-4 w-4" />}
              />
              <ModeToggle
                label="Stillmodus"
                description="SuS sehen nur den eigenen Status, nicht die Gewinnerliste."
                active={buzzerSession?.silentMode === true}
                onClick={() => void updateMode({ silentMode: !(buzzerSession?.silentMode === true) })}
                disabled={Boolean(busy || !buzzerSession)}
                icon={buzzerSession?.silentMode ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              />
            </div>
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="font-bold text-slate-900">Warteschlange</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">{events.length}</span>
            </div>
            <div className="space-y-2">
              {events.length === 0 && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Noch keine Buzzes in dieser Runde.</p>}
              {events.map((event) => (
                <div
                  key={event.id}
                  className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3 ${
                    event.position === 1 ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white">
                    {event.position}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{event.displayName}</p>
                    <p className="text-xs text-slate-500">{formatTime(event.createdAt)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void setExcluded(event.userId, true)}
                    disabled={busy === event.userId}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Ban className="h-4 w-4" />
                    Sperren
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="font-bold text-slate-900">SuS in diesem Tool</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">{participants.length}</span>
            </div>
            <div className="space-y-2">
              {participants.length === 0 && (
                <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Sobald SuS den Buzzer öffnen, erscheinen sie hier.</p>
              )}
              {participants.map((participant) => (
                <div
                  key={participant.userId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{participant.displayName || 'Anonym'}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold">
                      {participant.excluded && <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">gesperrt</span>}
                      {participant.pausedNextRound && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">pausiert</span>}
                      {!participant.excluded && !participant.pausedNextRound && (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">aktiv</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void setExcluded(participant.userId, !participant.excluded)}
                    disabled={busy === participant.userId}
                    className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                      participant.excluded
                        ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                        : 'border-rose-200 text-rose-700 hover:bg-rose-50'
                    }`}
                  >
                    {participant.excluded ? <UserCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                    {participant.excluded ? 'Freigeben' : 'Sperren'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  const canBuzz =
    permissions.buzzer &&
    buzzerSession?.status === 'open' &&
    !ownEvent &&
    !currentParticipant?.excluded &&
    !currentParticipant?.pausedNextRound &&
    !busy;

  let studentMessage = 'Bereit zum Buzzern.';
  let studentTone: 'neutral' | 'success' | 'warn' | 'error' = 'neutral';
  if (!permissions.buzzer) {
    studentMessage = 'Der Buzzer ist für dich nicht freigeschaltet.';
    studentTone = 'warn';
  } else if (currentParticipant?.excluded) {
    studentMessage = 'Du bist für diese Runde gesperrt.';
    studentTone = 'error';
  } else if (currentParticipant?.pausedNextRound) {
    studentMessage = 'Fairness-Modus: Du pausierst in dieser Runde.';
    studentTone = 'warn';
  } else if (buzzerSession?.status === 'locked') {
    studentMessage = 'Der Buzzer ist gerade gesperrt.';
    studentTone = 'warn';
  } else if (ownEvent?.position === 1) {
    studentMessage = 'Du hast gebuzzert.';
    studentTone = 'success';
  } else if (ownEvent && ownEvent.position > 1) {
    studentMessage =
      studentLeader && studentLeader.userId !== currentUserId
        ? `Zu spät - ${studentLeader.displayName} war schneller.`
        : 'Zu spät - jemand anderes war schneller.';
    studentTone = 'warn';
  } else if (studentLeader) {
    studentMessage = `Gerade vorne: ${studentLeader.displayName}. Du kannst dich noch in die Warteliste buzzern.`;
    studentTone = 'neutral';
  } else if (info) {
    studentMessage = info;
    studentTone = 'success';
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-12rem)] w-full max-w-2xl flex-col items-center justify-center gap-5 px-2 text-center">
      {error && <StatusBox tone="error" message={error} />}
      {realtimeState !== 'connected' && (
        <StatusBox
          tone="warn"
          message={realtimeState === 'connecting' ? 'Realtime verbindet sich gerade.' : 'Realtime ist nicht verbunden.'}
        />
      )}

      <div className="w-full rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-400">{displayName || 'Dein Buzzer'}</p>
        <button
          type="button"
          onClick={() => void buzz()}
          disabled={!canBuzz}
          className={`mx-auto flex aspect-square w-full max-w-[21rem] flex-col items-center justify-center rounded-full border-8 text-white shadow-xl transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
            canBuzz
              ? 'border-red-300 bg-red-600 hover:bg-red-700'
              : ownEvent?.position === 1
                ? 'border-emerald-200 bg-emerald-600'
                : 'border-slate-200 bg-slate-500'
          }`}
        >
          {busy === 'buzz' ? <Loader2 className="mb-4 h-14 w-14 animate-spin" /> : <BellRing className="mb-4 h-16 w-16" />}
          <span className="text-4xl font-black sm:text-5xl">{busy === 'buzz' ? '...' : 'Buzzern'}</span>
        </button>

        <div
          className={`mt-6 rounded-lg border p-4 text-base font-bold ${
            studentTone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : studentTone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : studentTone === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            {studentTone === 'success' ? <CheckCircle2 className="h-5 w-5" /> : null}
            {studentTone === 'error' ? <XCircle className="h-5 w-5" /> : null}
            {studentTone === 'warn' ? <ShieldAlert className="h-5 w-5" /> : null}
            <span>{studentMessage}</span>
          </div>
          {ownEvent && <p className="mt-2 text-sm font-semibold opacity-80">Deine Position: #{ownEvent.position}</p>}
        </div>
      </div>
    </div>
  );
}

function StatusBox({ tone, message }: { tone: 'error' | 'warn'; message: string }) {
  return (
    <div
      className={`w-full rounded-lg border p-3 text-sm font-semibold ${
        tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      {message}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-black text-slate-950">{value}</p>
    </div>
  );
}

function ControlButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

function ModeToggle({
  label,
  description,
  active,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[56px] items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0">
          <span className="block font-bold">{label}</span>
          <span className="block text-xs opacity-75">{description}</span>
        </span>
      </span>
      <span className={`h-6 w-11 shrink-0 rounded-full p-1 ${active ? 'bg-blue-600' : 'bg-slate-300'}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${active ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}
