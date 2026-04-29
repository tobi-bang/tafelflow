import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Plus, Star, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSharedSessionToolState } from '../hooks/useSharedSessionToolState';

export type Criterion = { id: string; label: string };

export type PeerFeedbackEntry = {
  id: string;
  voterId: string;
  ratings: Record<string, number>;
  comment?: string;
};

export type PeerFeedbackPersisted = {
  task: string;
  criteria: Criterion[];
  entries: PeerFeedbackEntry[];
};

const newId = () => crypto.randomUUID();

const emptyFeedback = (): PeerFeedbackPersisted => ({
  task: '',
  criteria: [
    { id: newId(), label: 'Kriterium 1' },
    { id: newId(), label: 'Kriterium 2' },
  ],
  entries: [],
});

interface PeerFeedbackProps {
  sessionId: string;
  isTeacher: boolean;
  presentationMode: boolean;
}

export default function PeerFeedback({ sessionId, isTeacher, presentationMode }: PeerFeedbackProps) {
  const [data, setData] = useSharedSessionToolState<PeerFeedbackPersisted>(
    sessionId,
    'peerfeedback',
    emptyFeedback()
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [draftRatings, setDraftRatings] = useState<Record<string, number>>({});
  const [draftComment, setDraftComment] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!userId) return;
    const existing = data.entries.find((e) => e.voterId === userId);
    if (existing) {
      setDraftRatings({ ...existing.ratings });
      setDraftComment(existing.comment ?? '');
    } else {
      const d: Record<string, number> = {};
      for (const c of data.criteria) d[c.id] = 3;
      setDraftRatings(d);
      setDraftComment('');
    }
  }, [userId, data.entries, data.criteria]);

  const averages = useMemo(() => {
    const out: Record<string, { sum: number; n: number }> = {};
    for (const c of data.criteria) {
      out[c.id] = { sum: 0, n: 0 };
    }
    for (const e of data.entries) {
      for (const c of data.criteria) {
        const r = e.ratings[c.id];
        if (typeof r === 'number' && r >= 1 && r <= 5) {
          out[c.id].sum += r;
          out[c.id].n += 1;
        }
      }
    }
    return out;
  }, [data.entries, data.criteria]);

  const myEntry = userId ? data.entries.find((e) => e.voterId === userId) : undefined;

  const setTask = (t: string) => {
    if (!isTeacher) return;
    setData((d) => ({ ...d, task: t }));
  };

  const setCriterionLabel = (id: string, label: string) => {
    if (!isTeacher) return;
    setData((d) => ({
      ...d,
      criteria: d.criteria.map((c) => (c.id === id ? { ...c, label } : c)),
    }));
  };

  const addCriterion = () => {
    if (!isTeacher || data.criteria.length >= 5) return;
    setData((d) => ({ ...d, criteria: [...d.criteria, { id: newId(), label: `Kriterium ${d.criteria.length + 1}` }] }));
  };

  const removeCriterion = (id: string) => {
    if (!isTeacher || data.criteria.length <= 2) return;
    setData((d) => ({
      ...d,
      criteria: d.criteria.filter((c) => c.id !== id),
      entries: d.entries.map((e) => {
        const { [id]: _, ...rest } = e.ratings;
        return { ...e, ratings: rest };
      }),
    }));
  };

  const submitFeedback = () => {
    if (!userId || isTeacher) return;
    const ratings: Record<string, number> = {};
    for (const c of data.criteria) {
      ratings[c.id] = Math.min(5, Math.max(1, draftRatings[c.id] ?? 3));
    }
    const entry: PeerFeedbackEntry = {
      id: myEntry?.id ?? newId(),
      voterId: userId,
      ratings,
      comment: draftComment.trim() || undefined,
    };
    setData((d) => {
      const without = d.entries.filter((e) => e.voterId !== userId);
      return { ...d, entries: [...without, entry] };
    });
  };

  const titleClass = presentationMode ? 'text-2xl md:text-3xl' : 'text-xl';

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-12 sm:space-y-8">
      {isTeacher && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-800 text-base sm:text-lg">Aufgabe festlegen</h2>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">Aufgabe / Fokus</label>
            <textarea
              value={data.task}
              onChange={(e) => setTask(e.target.value)}
              rows={3}
              placeholder="z. B. Bewerte die Gestaltung des Plakats …"
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium text-slate-600">Kriterien (2–5)</span>
            {data.criteria.map((c) => (
              <div key={c.id} className="flex gap-2">
                <input
                  type="text"
                  value={c.label}
                  onChange={(e) => setCriterionLabel(c.id, e.target.value)}
                  className="flex-1 px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                />
                {data.criteria.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeCriterion(c.id)}
                    className="p-3 rounded-2xl border border-slate-200 text-rose-600 hover:bg-rose-50"
                    aria-label="Kriterium entfernen"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            ))}
            {data.criteria.length < 5 && (
              <button
                type="button"
                onClick={addCriterion}
                className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm hover:underline"
              >
                <Plus className="w-4 h-4" />
                Kriterium hinzufügen
              </button>
            )}
          </div>
        </div>
      )}

      {!isTeacher && data.task.trim() === '' && (
        <p className="text-center text-slate-500 py-12">Die Lehrkraft hat noch keine Peer-Feedback-Aufgabe freigegeben.</p>
      )}

      {(data.task.trim() !== '' || isTeacher) && (
        <>
          <div>
            <h3 className={`font-bold text-slate-900 mb-2 ${titleClass}`}>Aufgabe</h3>
            <p className="text-slate-700 whitespace-pre-wrap">{data.task.trim() || '(Noch kein Text)'}</p>
          </div>

          {!isTeacher && userId && data.task.trim() !== '' && (
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
              <p className="text-sm text-slate-500">
                {myEntry ? 'Du hast bereits Feedback abgegeben – speichern aktualisiert deinen Eintrag.' : 'Bewerte jedes Kriterium (1–5):'}
              </p>
              {data.criteria.map((c) => (
                <div key={c.id}>
                  <div className="font-semibold text-slate-800 mb-2">{c.label}</div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setDraftRatings((r) => ({ ...r, [c.id]: n }))}
                        className={`min-w-[3rem] py-3 px-4 rounded-2xl border-2 font-bold transition-all ${
                          (draftRatings[c.id] ?? 3) === n
                            ? 'border-amber-500 bg-amber-50 text-amber-900'
                            : 'border-slate-200 bg-white hover:border-amber-300'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-2">Kommentar (optional)</label>
                <textarea
                  value={draftComment}
                  onChange={(e) => setDraftComment(e.target.value)}
                  rows={2}
                  placeholder="Kurzes Feedback …"
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                />
              </div>
              <button
                type="button"
                onClick={submitFeedback}
                className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-lg hover:bg-blue-700 transition-colors"
              >
                Feedback absenden
              </button>
            </div>
          )}

          <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
            <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" />
              Durchschnitt pro Kriterium
            </h4>
            <div className="space-y-3">
              {data.criteria.map((c) => {
                const a = averages[c.id];
                const avg = a.n > 0 ? (a.sum / a.n).toFixed(2) : '–';
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
                    <span className="min-w-0 break-words font-medium text-slate-700">{c.label}</span>
                    <span className="text-lg font-bold text-blue-700">{avg}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-slate-500 mt-3">Rückmeldungen: {data.entries.length}</p>
          </div>

          {(isTeacher || data.entries.length > 0) && (
            <div className="bg-slate-50 rounded-3xl border border-slate-200 p-6">
              <h4 className="font-bold text-slate-800 mb-3">Alle Feedbacks</h4>
              <ul className="space-y-4">
                {data.entries.map((e) => (
                  <motion.li
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl border border-slate-200 p-4 text-sm"
                  >
                    <div className="text-xs text-slate-400 font-mono mb-2">{e.voterId.slice(0, 8)}…</div>
                    <div className="space-y-1">
                      {data.criteria.map((c) => (
                        <div key={c.id} className="flex justify-between gap-3">
                          <span className="min-w-0 break-words">{c.label}</span>
                          <span className="font-semibold">{e.ratings[c.id] ?? '–'}/5</span>
                        </div>
                      ))}
                    </div>
                    {e.comment && <p className="mt-2 text-slate-600 border-t border-slate-100 pt-2">{e.comment}</p>}
                  </motion.li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
