import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Send, Users, Clock, CheckCircle2 } from 'lucide-react';
import type { StickyNote } from '../types';

type StudentTab = 'send' | 'class';

type Props = {
  stickies: StickyNote[];
  userId: string | null;
  canAdd: boolean;
  showClassIdeas: boolean;
  showAuthorOnStickies: boolean;
  isAdding: boolean;
  onOpenAdd: () => void;
  addModal: React.ReactNode;
};

function headingLabelFor(stickies: StickyNote[], underHeadingId: string | null | undefined): string | null {
  if (!underHeadingId) return null;
  const h = stickies.find((s) => s.id === underHeadingId && s.stickyType === 'heading');
  return h?.content?.trim() || null;
}

function OwnIdeaCard({ sticky }: { sticky: StickyNote }) {
  const published = sticky.status === 'published';
  return (
    <article
      className="rounded-xl border border-slate-200/80 p-3 shadow-sm"
      style={{ backgroundColor: sticky.color }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            published ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
          }`}
        >
          {published ? (
            <>
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              Freigegeben
            </>
          ) : (
            <>
              <Clock className="h-3 w-3" aria-hidden />
              Wartet auf Freigabe
            </>
          )}
        </span>
      </div>
      <p className="text-sm leading-snug text-slate-900 whitespace-pre-wrap break-words">{sticky.content}</p>
    </article>
  );
}

function ClassIdeaCard({
  sticky,
  heading,
  showAuthor,
}: {
  sticky: StickyNote;
  heading: string | null;
  showAuthor: boolean;
}) {
  const author =
    showAuthor && sticky.authorName && sticky.authorName !== 'Anonym' ? sticky.authorName : null;
  return (
    <article
      className="rounded-xl border border-slate-200/70 p-3 shadow-sm"
      style={{ backgroundColor: sticky.color }}
    >
      {heading && (
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">{heading}</p>
      )}
      <p className="text-sm leading-snug text-slate-900 whitespace-pre-wrap break-words">{sticky.content}</p>
      {author && <p className="mt-2 text-xs text-slate-600">{author}</p>}
    </article>
  );
}

export function BrainstormStudentView({
  stickies,
  userId,
  canAdd,
  showClassIdeas,
  showAuthorOnStickies,
  isAdding,
  onOpenAdd,
  addModal,
}: Props) {
  const [tab, setTab] = useState<StudentTab>('send');

  useEffect(() => {
    if (!showClassIdeas && tab === 'class') setTab('send');
  }, [showClassIdeas, tab]);

  const ownNotes = useMemo(
    () =>
      stickies
        .filter((s) => s.stickyType === 'note' && userId && s.authorId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [stickies, userId]
  );

  const classNotes = useMemo(
    () =>
      stickies
        .filter((s) => s.stickyType === 'note' && s.status === 'published')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [stickies]
  );

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-slate-100">
      {showClassIdeas && (
        <nav
          className="flex shrink-0 border-b border-slate-200 bg-white/95 px-2 pt-[env(safe-area-inset-top)]"
          role="tablist"
          aria-label="Ideen"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'send'}
            onClick={() => setTab('send')}
            className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
              tab === 'send'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Send className="h-4 w-4" aria-hidden />
            Senden
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'class'}
            onClick={() => setTab('class')}
            className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
              tab === 'class'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="h-4 w-4" aria-hidden />
            Klassenideen
            {classNotes.length > 0 && (
              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-700">
                {classNotes.length}
              </span>
            )}
          </button>
        </nav>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-24 sm:px-4">
        {tab === 'send' || !showClassIdeas ? (
          <section aria-label="Eigene Ideen">
            {!showClassIdeas && (
              <header className="mb-4">
                <h2 className="text-base font-bold text-slate-800">Eigene Idee senden</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Deine Ideen erscheinen nach Freigabe durch die Lehrkraft auf der Tafel. Klassenideen anderer
                  SuS sind hier nicht sichtbar.
                </p>
              </header>
            )}
            {showClassIdeas && (
              <p className="mb-3 text-xs text-slate-500">
                Sende eine neue Idee oder prüfe den Status deiner Beiträge.
              </p>
            )}
            {ownNotes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center">
                <p className="text-sm text-slate-600">Noch keine eigene Idee eingereicht.</p>
                {canAdd && (
                  <button
                    type="button"
                    onClick={onOpenAdd}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-blue-700"
                  >
                    <Plus className="h-4 w-4" />
                    Idee senden
                  </button>
                )}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {ownNotes.map((s) => (
                  <li key={s.id}>
                    <OwnIdeaCard sticky={s} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section aria-label="Klassenideen">
            <p className="mb-3 text-xs text-slate-500">
              Nur freigegebene Ideen der Klasse — nur lesen, nicht bearbeiten.
            </p>
            {classNotes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center text-sm text-slate-500">
                Noch keine freigegebenen Klassenideen.
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {classNotes.map((s) => (
                  <li key={s.id}>
                    <ClassIdeaCard
                      sticky={s}
                      heading={headingLabelFor(stickies, s.underHeadingId)}
                      showAuthor={showAuthorOnStickies}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {canAdd && tab === 'send' && !isAdding && (
        <button
          type="button"
          onClick={onOpenAdd}
          className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 rounded-full bg-blue-600 p-4 text-white shadow-xl transition-all hover:scale-105 hover:bg-blue-700"
          aria-label="Neue Idee senden"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {addModal}
    </div>
  );
}
