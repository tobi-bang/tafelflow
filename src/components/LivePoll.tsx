import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSharedSessionToolState } from '../hooks/useSharedSessionToolState';

export type LivePollPersisted = {
  question: string;
  options: string[];
  allowReasons: boolean;
  /** userId -> vote */
  votes: Record<string, { optionIndex: number; reason?: string }>;
};

const emptyPoll = (): LivePollPersisted => ({
  question: '',
  options: ['', ''],
  allowReasons: false,
  votes: {},
});

interface LivePollProps {
  sessionId: string;
  isTeacher: boolean;
  presentationMode: boolean;
}

export default function LivePoll({ sessionId, isTeacher, presentationMode }: LivePollProps) {
  const [data, setData] = useSharedSessionToolState<LivePollPersisted>(
    sessionId,
    'livepoll',
    emptyPoll()
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
  }, []);

  const totalVotes = Object.keys(data.votes).length;

  const counts = useMemo(() => {
    const c = data.options.map(() => 0);
    for (const v of Object.values(data.votes)) {
      if (v.optionIndex >= 0 && v.optionIndex < c.length) c[v.optionIndex] += 1;
    }
    return c;
  }, [data.votes, data.options]);

  const setQuestion = (q: string) => {
    if (!isTeacher) return;
    setData((d) => ({ ...d, question: q }));
  };

  const setOption = (i: number, text: string) => {
    if (!isTeacher) return;
    setData((d) => {
      const options = [...d.options];
      options[i] = text;
      return { ...d, options };
    });
  };

  const addOption = () => {
    if (!isTeacher) return;
    setData((d) => ({ ...d, options: [...d.options, ''] }));
  };

  const removeOption = (i: number) => {
    if (!isTeacher || data.options.length <= 2) return;
    setData((d) => {
      const options = d.options.filter((_, idx) => idx !== i);
      const votes: LivePollPersisted['votes'] = {};
      for (const [uid, v] of Object.entries(d.votes)) {
        if (v.optionIndex === i) continue;
        votes[uid] = {
          ...v,
          optionIndex: v.optionIndex > i ? v.optionIndex - 1 : v.optionIndex,
        };
      }
      return { ...d, options, votes };
    });
  };

  const toggleReasons = () => {
    if (!isTeacher) return;
    setData((d) => ({ ...d, allowReasons: !d.allowReasons }));
  };

  const resetPoll = () => {
    if (!isTeacher) return;
    if (!confirm('Alle Stimmen und Begründungen löschen?')) return;
    setData(emptyPoll());
  };

  const submitVote = useCallback(
    (optionIndex: number) => {
      if (!userId || isTeacher) return;
      const reason = data.allowReasons ? reasonDraft.trim() || undefined : undefined;
      setData((d) => ({
        ...d,
        votes: { ...d.votes, [userId]: { optionIndex, reason } },
      }));
      setReasonDraft('');
    },
    [userId, isTeacher, data.allowReasons, reasonDraft, setData]
  );

  const myVote = userId ? data.votes[userId] : undefined;

  const titleClass = presentationMode ? 'text-2xl md:text-3xl' : 'text-xl';
  const btnClass = presentationMode
    ? 'min-h-[3.5rem] text-lg md:text-xl py-4 px-5'
    : 'min-h-[3rem] text-base py-3 px-4';

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      {isTeacher && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-800 text-base sm:text-lg">Abstimmung vorbereiten</h2>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">Frage</label>
            <input
              type="text"
              value={data.question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="z. B. Welche Lösung ist am sinnvollsten?"
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium text-slate-600">Antwortmöglichkeiten</span>
            {data.options.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => setOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  className="flex-1 px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                />
                {data.options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    className="p-3 rounded-2xl border border-slate-200 text-rose-600 hover:bg-rose-50"
                    aria-label="Option entfernen"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addOption}
              className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm hover:underline"
            >
              <Plus className="w-4 h-4" />
              Option hinzufügen
            </button>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={data.allowReasons}
              onChange={toggleReasons}
              className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-slate-700">Kurze Begründung optional erlauben</span>
          </label>
          <button
            type="button"
            onClick={resetPoll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-slate-800 font-semibold hover:bg-slate-200"
          >
            <RotateCcw className="w-4 h-4" />
            Abstimmung zurücksetzen
          </button>
        </div>
      )}

      {!isTeacher && data.question.trim() === '' && (
        <p className="text-center text-slate-500 py-12">Die Lehrkraft hat noch keine Abstimmung gestartet.</p>
      )}

      {(data.question.trim() !== '' || isTeacher) && (
        <>
          <div>
            <h3 className={`font-bold text-slate-900 mb-6 ${titleClass}`}>
              {data.question.trim() || '(Keine Frage)'}
            </h3>

            {!isTeacher && userId && (
              <div className="space-y-4">
                <p className="text-sm text-slate-500">
                  {myVote != null ? 'Deine Stimme ist gespeichert. Du kannst wählen, um zu ändern.' : 'Tippe eine Antwort:'}
                </p>
                <div className="flex flex-col gap-3">
                  {data.options.map(
                    (label, i) =>
                      label.trim() !== '' && (
                        <button
                          key={i}
                          type="button"
                          onClick={() => submitVote(i)}
                          className={`w-full rounded-2xl border-2 text-left font-semibold transition-all active:scale-[0.99] ${btnClass} ${
                            myVote?.optionIndex === i
                              ? 'border-blue-600 bg-blue-50 text-blue-900'
                              : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          {label}
                        </button>
                      )
                  )}
                </div>
                {data.allowReasons && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-2">Begründung (optional)</label>
                    <textarea
                      value={reasonDraft}
                      onChange={(e) => setReasonDraft(e.target.value)}
                      rows={2}
                      placeholder="Kurz begründen…"
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    />
                  </div>
                )}
              </div>
            )}

            {!isTeacher && !userId && (
              <p className="text-amber-700 text-sm">Bitte warte, Anmeldung wird geladen…</p>
            )}
          </div>

          <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
            <h4 className="font-bold text-slate-800 mb-4">Live-Ergebnis</h4>
            <div className="space-y-4">
              {data.options.map((label, i) => {
                if (!label.trim()) return null;
                const n = counts[i] ?? 0;
                const pct = totalVotes > 0 ? Math.round((n / totalVotes) * 100) : 0;
                return (
                  <div key={i}>
                    <div className="flex justify-between text-sm font-medium text-slate-700 mb-1">
                      <span className="pr-2">{label}</span>
                      <span className="shrink-0 text-slate-500">
                        {n} · {pct}%
                      </span>
                    </div>
                    <div className="h-4 rounded-full bg-slate-100 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-blue-500"
                        initial={false}
                        animate={{ width: `${pct}%` }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-slate-500 mt-4">Stimmen gesamt: {totalVotes}</p>
          </div>

          {data.allowReasons && Object.values(data.votes).some((v) => v.reason) && (
            <div className="bg-slate-50 rounded-3xl border border-slate-200 p-6">
              <h4 className="font-bold text-slate-800 mb-3">Begründungen</h4>
              <ul className="space-y-2 text-sm text-slate-700">
                {Object.entries(data.votes).map(([uid, v]) =>
                  v.reason ? (
                    <li key={uid} className="border-b border-slate-200 pb-2 last:border-0">
                      <span className="text-slate-500 font-mono text-xs">{uid.slice(0, 8)}…</span>: {v.reason}
                    </li>
                  ) : null
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
