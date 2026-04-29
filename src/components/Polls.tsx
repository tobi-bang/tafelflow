import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { rowToPoll, rowToPollResponse } from '../lib/dbMap';
import type { Poll, PollResponse, SessionPermissions } from '../types';
import { Plus, Trash2, Users, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';

interface PollsProps {
  sessionId: string;
  isTeacher: boolean;
  permissions: SessionPermissions;
  presentationMode?: boolean;
}

export default function Polls({
  sessionId,
  isTeacher,
  permissions,
  presentationMode = false,
}: PollsProps) {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [responses, setResponses] = useState<Record<string, PollResponse[]>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newOptions, setNewOptions] = useState(['', '']);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [extraOptionByPoll, setExtraOptionByPoll] = useState<Record<string, string>>({});

  const canAnswer = permissions.answerPoll;

  const loadPollsAndResponses = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserId(user?.id ?? null);

    const { data: pollRows } = await supabase
      .from('polls')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    const pollList = (pollRows ?? []).map((r) => rowToPoll(r as Record<string, unknown>));
    setPolls(pollList);

    const { data: respRows } = await supabase
      .from('poll_responses')
      .select('*')
      .eq('session_id', sessionId);

    const byPoll: Record<string, PollResponse[]> = {};
    for (const p of pollList) byPoll[p.id] = [];
    for (const r of respRows ?? []) {
      const pr = rowToPollResponse(r as Record<string, unknown>);
      if (!byPoll[pr.pollId]) byPoll[pr.pollId] = [];
      byPoll[pr.pollId].push({ ...pr, pollId: pr.pollId });
    }
    setResponses(byPoll);
  }, [sessionId]);

  useEffect(() => {
    loadPollsAndResponses();

    const ch = supabase
      .channel(`polls-all-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'polls', filter: `session_id=eq.${sessionId}` },
        () => loadPollsAndResponses()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'poll_responses', filter: `session_id=eq.${sessionId}` },
        () => loadPollsAndResponses()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [sessionId, loadPollsAndResponses]);

  const createPoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestion.trim() || !isTeacher) return;

    const opts = newOptions.filter((o) => o.trim() !== '');
    const { error } = await supabase.from('polls').insert({
      session_id: sessionId,
      question: newQuestion.trim(),
      type: 'single',
      options: opts,
      active: true,
    });
    if (error) console.error(error);
    setNewQuestion('');
    setNewOptions(['', '']);
    setIsCreating(false);
  };

  const submitResponse = async (pollId: string, answer: string) => {
    if (!canAnswer) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('poll_responses').insert({
      session_id: sessionId,
      poll_id: pollId,
      author_id: user.id,
      answer,
    });
    if (error) console.error(error);
  };

  const deletePoll = async (id: string) => {
    if (!isTeacher) return;
    await supabase.from('polls').delete().eq('id', id);
  };

  const togglePollState = async (id: string, active: boolean) => {
    if (!isTeacher) return;
    await supabase.from('polls').update({ active: !active }).eq('id', id);
  };

  const clearPollResponses = async (pollId: string) => {
    if (!isTeacher) return;
    if (!confirm('Alle Stimmen dieser Umfrage löschen?')) return;
    const { error } = await supabase.from('poll_responses').delete().eq('poll_id', pollId);
    if (error) console.error(error);
  };

  const addPollOption = async (pollId: string) => {
    const text = (extraOptionByPoll[pollId] || '').trim();
    if (!isTeacher || !text) return;
    const poll = polls.find((p) => p.id === pollId);
    if (!poll) return;
    const next = [...(poll.options || []), text];
    const { error } = await supabase.from('polls').update({ options: next }).eq('id', pollId);
    if (error) console.error(error);
    setExtraOptionByPoll((prev) => ({ ...prev, [pollId]: '' }));
  };

  const qClass = presentationMode ? 'text-2xl md:text-3xl' : 'text-xl';
  const optClass = presentationMode ? 'text-lg md:text-xl py-5 md:py-6' : 'text-base p-4';
  const wrapClass = presentationMode ? 'max-w-5xl' : 'max-w-3xl';

  return (
    <div className={`${wrapClass} mx-auto w-full space-y-6 sm:space-y-8`}>
      {isTeacher && (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="w-full py-4 border-2 border-dashed border-slate-300 rounded-3xl text-slate-500 font-bold hover:border-blue-400 hover:text-blue-600 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Neue Umfrage erstellen
        </button>
      )}

      <div className="space-y-6">
        {polls.map((poll) => (
          <motion.div
            key={poll.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm sm:p-6 md:p-8"
          >
            <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row">
              <h3 className={`min-w-0 break-words font-bold leading-tight text-slate-900 ${qClass}`}>{poll.question}</h3>
              {isTeacher && (
                <div className="flex flex-wrap gap-2 shrink-0 justify-end">
                  <button
                    type="button"
                    onClick={() => clearPollResponses(poll.id)}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-semibold"
                    title="Alle Antworten löschen"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span className="hidden sm:inline">Reset</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePollState(poll.id, poll.active)}
                    className={`px-3 py-2 rounded-xl text-sm font-semibold ${poll.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}
                  >
                    {poll.active ? 'Aktiv' : 'Beendet'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePoll(poll.id)}
                    className="p-2 hover:bg-rose-50 text-rose-600 rounded-xl"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {poll.options?.map((option, idx) => {
                const pollResponses = responses[poll.id] || [];
                const count = pollResponses.filter((r) => r.answer === option).length;
                const total = pollResponses.length;
                const percent = total > 0 ? (count / total) * 100 : 0;
                const hasVoted = currentUserId ? pollResponses.some((r) => r.authorId === currentUserId) : false;

                return (
                  <div key={idx} className="relative">
                    <button
                      type="button"
                      disabled={!poll.active || !canAnswer || hasVoted}
                      onClick={() => submitResponse(poll.id, option)}
                      className={`w-full rounded-2xl border text-left font-semibold transition-all relative overflow-hidden z-10 ${optClass} ${
                        hasVoted && pollResponses.find((r) => r.authorId === currentUserId)?.answer === option
                          ? 'border-blue-600 bg-blue-50/50'
                          : 'border-slate-200 hover:border-blue-400'
                      }`}
                    >
                      <div className="relative z-10 flex items-center justify-between gap-4">
                        <span className="min-w-0 break-words">{option}</span>
                        {isTeacher && (
                          <span className={`text-slate-400 shrink-0 ${presentationMode ? 'text-lg' : ''}`}>
                            {count} Stimmen
                          </span>
                        )}
                      </div>
                      {isTeacher && (
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percent}%` }}
                          className="absolute inset-0 bg-blue-100/50 z-0"
                        />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <div
              className={`mt-6 flex items-center gap-4 text-slate-400 font-medium ${presentationMode ? 'text-base' : 'text-sm'}`}
            >
              <div className="flex items-center gap-1">
                <Users className={presentationMode ? 'w-5 h-5' : 'w-4 h-4'} />
                {responses[poll.id]?.length || 0} Teilnahmen
              </div>
            </div>

            {isTeacher && poll.active && (
              <div className="mt-6 flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  type="text"
                  value={extraOptionByPoll[poll.id] ?? ''}
                  onChange={(e) =>
                    setExtraOptionByPoll((prev) => ({ ...prev, [poll.id]: e.target.value }))
                  }
                  placeholder="Weitere Antwortmöglichkeit (live ergänzen)…"
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => addPollOption(poll.id)}
                  className="px-4 py-3 rounded-xl bg-slate-800 text-white font-semibold hover:bg-slate-900 shrink-0"
                >
                  Option hinzufügen
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-slate-900/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-6 sm:pb-6">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-8">
            <h2 className="text-2xl font-bold mb-6">Umfrage erstellen</h2>
            <form onSubmit={createPoll}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">Frage</label>
                <input
                  autoFocus
                  type="text"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="z. B. Was ist das Ergebnis von 5×5?"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">Optionen</label>
                {newOptions.map((opt, idx) => (
                  <div key={idx} className="mb-2 flex gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => {
                        const updated = [...newOptions];
                        updated[idx] = e.target.value;
                        setNewOptions(updated);
                      }}
                      placeholder={`Option ${idx + 1}`}
                      className="flex-1 px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                ))}
                <button type="button" onClick={() => setNewOptions([...newOptions, ''])} className="text-blue-600 text-sm font-bold mt-2 hover:underline">
                  + Option hinzufügen
                </button>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={() => setIsCreating(false)} className="min-h-12 flex-1 rounded-xl py-3 font-medium text-slate-600 hover:bg-slate-50">
                  Abbrechen
                </button>
                <button type="submit" className="min-h-12 flex-1 rounded-xl bg-blue-600 py-3 font-semibold text-white shadow-lg hover:bg-blue-700">
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
