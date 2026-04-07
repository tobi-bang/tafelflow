import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { rowToWord } from '../lib/dbMap';
import type { WordEntry, SessionPermissions } from '../types';
import { Send, Cloud, Trash2, Eraser } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface WordCloudProps {
  sessionId: string;
  isTeacher: boolean;
  permissions: SessionPermissions;
  presentationMode?: boolean;
}

export default function WordCloud({
  sessionId,
  isTeacher,
  permissions,
  presentationMode = false,
}: WordCloudProps) {
  const [words, setWords] = useState<WordEntry[]>([]);
  const [newWord, setNewWord] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = isTeacher || permissions.submitWord;

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('words')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false });
      if (data) setWords(data.map((r) => rowToWord(r as Record<string, unknown>)));
    };
    load();

    const channel = supabase
      .channel(`words-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'words', filter: `session_id=eq.${sessionId}` },
        async () => {
          const { data } = await supabase
            .from('words')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false });
          if (data) setWords(data.map((r) => rowToWord(r as Record<string, unknown>)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const submitWord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWord.trim() || !canSubmit || isSubmitting) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('words').insert({
        session_id: sessionId,
        word: newWord.trim().toLowerCase(),
        author_id: user.id,
      });
      if (error) console.error(error);
      setNewWord('');
    } catch (error) {
      console.error('Failed to submit word:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteWord = async (id: string) => {
    if (!isTeacher) return;
    await supabase.from('words').delete().eq('id', id);
  };

  const clearAllWords = async () => {
    if (!isTeacher) return;
    if (!confirm('Gesamte Wortwolke leeren?')) return;
    const { error } = await supabase.from('words').delete().eq('session_id', sessionId);
    if (error) console.error(error);
  };

  const wordCounts = words.reduce(
    (acc, curr) => {
      acc[curr.word] = (acc[curr.word] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const sortedWords = (Object.entries(wordCounts) as [string, number][]).sort((a, b) => b[1] - a[1]);

  const maxFont = presentationMode ? 120 : 80;
  const fontStep = presentationMode ? 12 : 8;

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 sm:gap-6 flex-1">
      {canSubmit && (
        <div className="max-w-2xl mx-auto w-full flex flex-col sm:flex-row gap-3 sm:items-center">
          <form onSubmit={submitWord} className="flex-1 flex gap-2">
            <input
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder={isTeacher ? 'Begriff (Lehrkraft oder SuS)…' : 'Dein Begriff…'}
              className={`flex-1 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm ${
                presentationMode ? 'px-6 py-5 text-lg' : 'px-6 py-4'
              }`}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className={`bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all shadow-lg disabled:opacity-50 ${
                presentationMode ? 'p-5' : 'p-4'
              }`}
            >
              <Send className={presentationMode ? 'w-8 h-8' : 'w-6 h-6'} />
            </button>
          </form>
          {isTeacher && (
            <button
              type="button"
              onClick={clearAllWords}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-rose-200 text-rose-700 font-semibold hover:bg-rose-50"
            >
              <Eraser className="w-5 h-5" />
              Alle leeren
            </button>
          )}
        </div>
      )}

      <div
        className={`flex-1 bg-white rounded-3xl shadow-sm border border-slate-100 flex flex-wrap items-center justify-center overflow-y-auto content-center ${
          presentationMode ? 'p-10 gap-x-10 gap-y-6' : 'p-8 gap-x-8 gap-y-4'
        }`}
      >
        <AnimatePresence>
          {sortedWords.map(([word, count]) => (
            <motion.div key={word} layout initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} className="relative group">
              <span
                className={`font-bold transition-all cursor-default ${
                  count > 5 ? 'text-blue-600' : count > 3 ? 'text-indigo-500' : count > 1 ? 'text-slate-700' : 'text-slate-400'
                }`}
                style={{ fontSize: `${Math.min(16 + count * fontStep, maxFont)}px` }}
              >
                {word}
              </span>
              {isTeacher && (
                <button
                  type="button"
                  onClick={() => {
                    words.filter((w) => w.word === word).forEach((w) => deleteWord(w.id));
                  }}
                  className="absolute -top-2 -right-2 bg-rose-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {words.length === 0 && (
          <div className="text-center text-slate-300">
            <Cloud className={`mx-auto mb-4 opacity-20 ${presentationMode ? 'w-24 h-24' : 'w-16 h-16'}`} />
            <p className={presentationMode ? 'text-2xl font-medium' : 'text-xl font-medium'}>
              Noch keine Begriffe eingesendet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
