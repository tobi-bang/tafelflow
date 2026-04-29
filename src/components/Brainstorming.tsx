import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { rowToSticky } from '../lib/dbMap';
import type { StickyNote, SessionPermissions } from '../types';
import { Plus, Trash2, Check, Layers, GripVertical, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';

/** Basisbreite der Ideenkarte in px (wird mit display_scale multipliziert). */
const IDEA_CARD_BASE_PX = 320;

/** Tafel-/Präsentationsmodus: eigene Maße (unabhängig vom Arbeitsboard und display_scale). */
const BOARD_PRESENTATION = {
  /** Mindestbreite einer Spalte (Überschrift + Karten) */
  columnMinPx: 280,
  gridGap: 'gap-5 md:gap-6',
  noteText: 'text-[1.0625rem] sm:text-lg md:text-xl leading-snug',
  cardMinH: 'min-h-[5.75rem]',
  cardPad: 'p-4 md:p-5',
  areaPad: 'p-4 md:p-6 lg:p-8',
} as const;

function StickyHeadingMenuList({
  currentHeadingId,
  headings,
  onPick,
}: {
  currentHeadingId: string | null;
  headings: StickyNote[];
  onPick: (headingId: string | null) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="flex w-full min-h-10 items-center px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100"
        onClick={() => onPick(null)}
      >
        Ohne Überschrift
      </button>
      {headings.map((h) => (
        <button
          key={h.id}
          type="button"
          className={`flex w-full min-h-10 items-center px-3 py-2 text-left text-sm hover:bg-slate-100 ${
            h.id === currentHeadingId ? 'bg-blue-50 font-medium text-blue-900' : 'text-slate-800'
          }`}
          onClick={() => onPick(h.id)}
        >
          {h.content}
        </button>
      ))}
    </>
  );
}

interface BrainstormingProps {
  sessionId: string;
  isTeacher: boolean;
  permissions: SessionPermissions;
  presentationMode: boolean;
}

function clampDisplayScale(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 1.35;
  return Math.min(4, Math.max(0.5, n));
}

function StickyHeadingMenu({
  currentHeadingId,
  headings,
  onAssign,
  menuPlacement = 'above',
  compact = false,
}: {
  currentHeadingId: string | null;
  headings: StickyNote[];
  onAssign: (headingId: string | null) => void;
  /** „above“: Menü über dem Button (Board). „below“: nach unten (Tafelmodus, weniger Abschneiden in Spalten). */
  menuPlacement?: 'above' | 'below';
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  const [portalRect, setPortalRect] = useState<{ top: number; left: number; minW: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || menuPlacement !== 'below' || !triggerRef.current) {
      setPortalRect(null);
      return;
    }
    const r = triggerRef.current.getBoundingClientRect();
    setPortalRect({ top: r.bottom + 6, left: r.left, minW: Math.max(184, r.width) });
  }, [open, menuPlacement]);

  useEffect(() => {
    if (!open || menuPlacement !== 'below') return;
    const measure = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      setPortalRect({ top: r.bottom + 6, left: r.left, minW: Math.max(184, r.width) });
    };
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, menuPlacement]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (portalRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);

  const label = useMemo(() => {
    if (!currentHeadingId) return compact ? 'Ohne' : 'Ohne Überschrift';
    const h = headings.find((x) => x.id === currentHeadingId);
    if (!h) return compact ? 'Spalte' : 'Überschrift';
    const t = h.content.trim();
    const limit = compact ? 8 : 14;
    return t.length > limit ? `${t.slice(0, Math.max(1, limit - 2))}…` : t;
  }, [currentHeadingId, headings, compact]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center gap-0.5 border border-slate-400/60 bg-white/85 text-left font-semibold uppercase tracking-wide text-slate-700 shadow-sm backdrop-blur-sm hover:bg-white ${
          compact
            ? 'h-7 max-w-[6.5rem] rounded-md px-1.5 text-[10px]'
            : 'max-w-[10rem] rounded-lg px-1.5 py-1.5 text-[11px]'
        }`}
        title="Unter Überschrift einordnen"
      >
        <Layers className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} shrink-0 opacity-80`} aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className={`${compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} shrink-0 opacity-70 ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && menuPlacement === 'above' && (
        <div
          className="absolute bottom-full left-0 z-[80] mb-1 min-w-[11.5rem] max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <StickyHeadingMenuList
            currentHeadingId={currentHeadingId}
            headings={headings}
            onPick={(id) => {
              onAssign(id);
              setOpen(false);
            }}
          />
        </div>
      )}
      {open &&
        menuPlacement === 'below' &&
        portalRect &&
        createPortal(
          <div
            ref={portalRef}
            className="fixed z-[200] max-h-[min(50vh,20rem)] min-w-[11.5rem] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-2xl"
            style={{
              top: portalRect.top,
              left: portalRect.left,
              minWidth: portalRect.minW,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <StickyHeadingMenuList
              currentHeadingId={currentHeadingId}
              headings={headings}
              onPick={(id) => {
                onAssign(id);
                setOpen(false);
              }}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

export default function Brainstorming({
  sessionId,
  isTeacher,
  permissions,
  presentationMode,
}: BrainstormingProps) {
  const [stickies, setStickies] = useState<StickyNote[]>([]);
  const [newContent, setNewContent] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingHeading, setIsAddingHeading] = useState(false);
  const [headingTitle, setHeadingTitle] = useState('');
  const [selectedColor, setSelectedColor] = useState('#fef08a');
  const [userId, setUserId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; scale: number } | null>(null);

  const canAdd = isTeacher || permissions.addSticky;
  const canMoveAny = isTeacher || permissions.moveSticky;
  const canModerate =
    isTeacher || (permissions.organizeBrainstorm && permissions.moveSticky);

  const showAuthorOnStickies = permissions.ideasRequireDisplayName;
  const defaultIdeaScale = clampDisplayScale(permissions.ideasDefaultScale);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('stickies')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (data) setStickies(data.map((r) => rowToSticky(r as Record<string, unknown>)));
  }, [sessionId]);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`stickies-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stickies',
          filter: `session_id=eq.${sessionId}`,
        },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, load]);

  const visible = useMemo(() => {
    return stickies.filter((s) => s.status === 'published' || isTeacher);
  }, [stickies, isTeacher]);

  const headings = useMemo(
    () => visible.filter((s) => s.stickyType === 'heading'),
    [visible]
  );

  const canResizeSticky = useCallback(
    (s: StickyNote) => {
      if (s.stickyType !== 'note') return isTeacher;
      if (isTeacher) return true;
      return Boolean(permissions.moveSticky && userId && s.authorId === userId);
    },
    [isTeacher, permissions.moveSticky, userId]
  );

  const addSticky = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim() || !canAdd) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const meta = (
      (user.user_metadata as { display_name?: string } | undefined)?.display_name || ''
    ).trim();

    if (!isTeacher && permissions.ideasRequireDisplayName && !meta) {
      alert(
        'Für diese Sitzung ist ein Anzeigename vorgeschrieben. Bitte die Sitzung verlassen und mit Namen erneut beitreten, oder die Lehrkraft deaktiviert die Namenspflicht.'
      );
      return;
    }

    const authorName = isTeacher
      ? meta || 'Lehrkraft'
      : permissions.ideasRequireDisplayName
        ? meta || 'Anonym'
        : '';

    try {
      const { error } = await supabase.from('stickies').insert({
        session_id: sessionId,
        content: newContent.trim(),
        color: selectedColor,
        author_name: authorName || 'Anonym',
        author_id: user.id,
        x: Math.random() * 400 + 50,
        y: Math.random() * 400 + 50,
        status: isTeacher ? 'published' : 'pending',
        sticky_type: 'note',
        display_scale: defaultIdeaScale,
      });
      if (error) {
        console.error(error);
        alert(`Idee konnte nicht gespeichert werden: ${error.message}`);
        return;
      }
      setNewContent('');
      setIsAdding(false);
    } catch (error) {
      console.error('Failed to add sticky:', error);
      alert('Idee konnte nicht gespeichert werden.');
    }
  };

  const addHeading = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!headingTitle.trim() || !isTeacher) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const display =
      (user.user_metadata as { display_name?: string } | undefined)?.display_name || 'Anonym';
    const { error } = await supabase.from('stickies').insert({
      session_id: sessionId,
      content: headingTitle.trim(),
      color: '#cbd5e1',
      author_name: display || 'Lehrkraft',
      author_id: user.id,
      x: 40,
      y: 40 + headings.length * 12,
      status: 'published',
      sticky_type: 'heading',
      display_scale: 1,
    });
    if (error) {
      console.error(error);
      alert(`Überschrift konnte nicht gespeichert werden: ${error.message}`);
      return;
    }
    setHeadingTitle('');
    setIsAddingHeading(false);
  };

  const assignUnderHeading = async (stickyId: string, underHeadingId: string | null) => {
    if (!canModerate) return;
    const prev = stickies;
    setStickies((list) =>
      list.map((s) => (s.id === stickyId ? { ...s, underHeadingId } : s))
    );
    try {
      if (isTeacher) {
        const { error } = await supabase
          .from('stickies')
          .update({ under_heading_id: underHeadingId })
          .eq('id', stickyId);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc('assign_sticky_heading', {
        p_sticky_id: stickyId,
        p_under_heading_id: underHeadingId,
      });
      if (error) throw error;
    } catch (err) {
      console.error(err);
      setStickies(prev);
      alert('Zuordnung zur Überschrift ist fehlgeschlagen. Bitte erneut versuchen.');
    }
  };

  const updateStickyPos = async (id: string, x: number, y: number) => {
    if (!canMoveAny) return;
    const s = stickies.find((st) => st.id === id);
    if (!s) return;
    if (s.stickyType === 'heading' && !isTeacher) return;
    if (s.stickyType === 'note' && !isTeacher && s.authorId !== userId) return;
    await supabase.from('stickies').update({ x, y }).eq('id', id);
  };

  const deleteSticky = async (id: string) => {
    if (!isTeacher) return;
    const prev = stickies;
    setStickies((list) => list.filter((x) => x.id !== id));
    const { error } = await supabase.from('stickies').delete().eq('id', id);
    if (error) {
      console.error(error);
      setStickies(prev);
      alert('Karte konnte nicht gelöscht werden. Nur die Lehrkraft der Sitzung darf löschen (Supabase-RLS).');
    }
  };

  const setStickyDisplayScale = async (id: string, nextScale: number) => {
    const s = stickies.find((st) => st.id === id);
    if (!s || !canResizeSticky(s)) return;
    const clamped = clampDisplayScale(nextScale);
    const { error } = await supabase.from('stickies').update({ display_scale: clamped }).eq('id', id);
    if (error) {
      console.error(error);
      alert('Größe konnte nicht gespeichert werden.');
    }
  };

  const approveSticky = async (id: string) => {
    if (!isTeacher) return;
    await supabase.from('stickies').update({ status: 'published' }).eq('id', id);
  };

  if (presentationMode) {
    const notes = visible.filter((s) => s.stickyType === 'note');
    const orphan = notes.filter((n) => !n.underHeadingId);
    const sortedHeadings = [...headings].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const hasHeadingColumns = sortedHeadings.length > 0;
    const columnGridStyle = {
      gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${BOARD_PRESENTATION.columnMinPx}px), 1fr))`,
    } as const;

    return (
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-gradient-to-b from-slate-100 to-slate-200/90">
        <header className="shrink-0 border-b border-slate-200/90 bg-white/95 px-4 py-3 shadow-sm md:px-6 md:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-800 md:text-lg">Ideen · Tafelansicht</h2>
              <p className="mt-0.5 max-w-2xl text-xs text-slate-500 md:text-sm">
                Spalte pro Karte über „Überschrift“-Wahl. Zum freien Verschieben auf der Fläche und für Resize-Griffe
                am Rand nutze den <span className="font-semibold text-slate-600">Arbeitsmodus</span>.
              </p>
            </div>
            {isTeacher && (
              <button
                type="button"
                onClick={() => setIsAddingHeading(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-slate-900"
              >
                <Layers className="h-4 w-4" aria-hidden />
                Überschrift
              </button>
            )}
          </div>
        </header>

        <div className={`min-h-0 flex-1 overflow-auto ${BOARD_PRESENTATION.areaPad}`}>
          {hasHeadingColumns ? (
            <div
              className={`grid min-h-[min(70vh,720px)] ${BOARD_PRESENTATION.gridGap}`}
              style={columnGridStyle}
            >
              <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-300/60 bg-white shadow-md">
                <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Ohne Spalte</h3>
                </div>
                <div className={`flex min-h-0 flex-1 flex-col ${BOARD_PRESENTATION.gridGap} overflow-y-auto p-4`}>
                  {orphan.map((sticky) => (
                    <React.Fragment key={sticky.id}>
                    <PresentationNoteCard
                      sticky={sticky}
                      showAuthorOnStickies={showAuthorOnStickies}
                      canModerate={canModerate}
                      headings={sortedHeadings}
                      onAssign={(hid) => void assignUnderHeading(sticky.id, hid)}
                      isTeacher={isTeacher}
                      onApprove={() => void approveSticky(sticky.id)}
                      onDelete={() => void deleteSticky(sticky.id)}
                    />
                    </React.Fragment>
                  ))}
                  {orphan.length === 0 && (
                    <p className="py-6 text-center text-sm text-slate-400">Keine Ideen ohne Spalte.</p>
                  )}
                </div>
              </section>

              {sortedHeadings.map((h) => (
                <section
                  key={h.id}
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-300/60 bg-white shadow-md"
                >
                  <div className="shrink-0 border-b border-slate-200 bg-slate-200/90 px-4 py-3">
                    <h3
                      className="font-bold leading-snug text-slate-900"
                      style={{
                        fontSize: `clamp(0.95rem, ${(1.05 * h.displayScale).toFixed(3)}rem, 2.35rem)`,
                      }}
                    >
                      {h.content}
                    </h3>
                  </div>
                  <div className={`flex min-h-0 flex-1 flex-col ${BOARD_PRESENTATION.gridGap} overflow-y-auto p-4`}>
                    {notes
                      .filter((n) => n.underHeadingId === h.id)
                      .map((sticky) => (
                        <React.Fragment key={sticky.id}>
                        <PresentationNoteCard
                          sticky={sticky}
                          showAuthorOnStickies={showAuthorOnStickies}
                          canModerate={canModerate}
                          headings={sortedHeadings}
                          onAssign={(hid) => void assignUnderHeading(sticky.id, hid)}
                          isTeacher={isTeacher}
                          onApprove={() => void approveSticky(sticky.id)}
                          onDelete={() => void deleteSticky(sticky.id)}
                        />
                        </React.Fragment>
                      ))}
                    {notes.filter((n) => n.underHeadingId === h.id).length === 0 && (
                      <p className="py-6 text-center text-sm text-slate-400">Noch keine Ideen in dieser Spalte.</p>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-[1680px] grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6 xl:grid-cols-4 2xl:grid-cols-5">
              {notes.map((sticky) => (
                <React.Fragment key={sticky.id}>
                <PresentationNoteCard
                  sticky={sticky}
                  showAuthorOnStickies={showAuthorOnStickies}
                  canModerate={canModerate}
                  headings={sortedHeadings}
                  onAssign={(hid) => void assignUnderHeading(sticky.id, hid)}
                  isTeacher={isTeacher}
                  onApprove={() => void approveSticky(sticky.id)}
                  onDelete={() => void deleteSticky(sticky.id)}
                />
                </React.Fragment>
              ))}
              {notes.length === 0 && (
                <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white/60 py-16 text-center text-slate-500">
                  Noch keine Ideen. Neue Ideen können über das Plus angelegt werden (sofern erlaubt).
                </div>
              )}
            </div>
          )}
        </div>

        {canAdd && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 rounded-full bg-blue-600 p-4 text-white shadow-xl transition-all hover:scale-110 hover:bg-blue-700 sm:bottom-8 sm:right-8"
          >
            <Plus className="w-6 h-6" />
          </button>
        )}

        {isAdding && (
          <StickyFormModal
            title="Neue Idee hinzufügen"
            value={newContent}
            onChange={setNewContent}
            onSubmit={addSticky}
            onClose={() => setIsAdding(false)}
            selectedColor={selectedColor}
            onPickColor={setSelectedColor}
          />
        )}
        {isAddingHeading && isTeacher && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden bg-slate-900/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-6 sm:pb-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-8"
            >
              <h2 className="text-2xl font-bold mb-6">Überschrift für Ideen</h2>
              <form onSubmit={addHeading}>
                <input
                  autoFocus
                  type="text"
                  value={headingTitle}
                  onChange={(e) => setHeadingTitle(e.target.value)}
                  placeholder="z. B. Vorteile · Nachteile · offene Fragen"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none mb-6"
                />
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setIsAddingHeading(false)}
                    className="flex-1 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-semibold hover:bg-slate-900 shadow-lg"
                  >
                    Anlegen
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-100 p-3 sm:p-6 md:p-8">
      <div className="w-full h-full relative">
        {isTeacher && (
          <button
            type="button"
            onClick={() => setIsAddingHeading(true)}
            className="absolute top-2 left-2 z-40 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 shadow"
          >
            <Layers className="w-4 h-4" />
            Überschrift
          </button>
        )}
        <AnimatePresence>
          {visible.map((sticky) => {
            const canDrag =
              sticky.stickyType === 'heading'
                ? isTeacher && canMoveAny
                : canMoveAny && (isTeacher || sticky.authorId === userId);

            const liveScale =
              resizePreview?.id === sticky.id ? resizePreview.scale : sticky.displayScale;

            return (
              <Fragment key={sticky.id}>
                <DraggableBoardSticky
                  sticky={sticky}
                  displayScale={liveScale}
                  canDrag={canDrag}
                  isTeacher={isTeacher}
                  canModerate={canModerate}
                  canResize={canResizeSticky(sticky)}
                  showAuthorOnStickies={showAuthorOnStickies}
                  headings={headings}
                  onDragEnd={(x, y) => {
                    void updateStickyPos(sticky.id, x, y);
                  }}
                  onDelete={() => deleteSticky(sticky.id)}
                  onApprove={() => approveSticky(sticky.id)}
                  onAssign={(hid) => assignUnderHeading(sticky.id, hid)}
                  onResizePreview={(scale) => {
                    if (scale === null) setResizePreview(null);
                    else setResizePreview({ id: sticky.id, scale });
                  }}
                  onResizeCommit={(scale) => {
                    setResizePreview(null);
                    void setStickyDisplayScale(sticky.id, scale);
                  }}
                />
              </Fragment>
            );
          })}
        </AnimatePresence>
      </div>

      {canAdd && (
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 rounded-full bg-blue-600 p-4 text-white shadow-xl transition-all hover:scale-110 hover:bg-blue-700 sm:bottom-8 sm:right-8"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {isAdding && (
        <StickyFormModal
          title="Neue Idee hinzufügen"
          value={newContent}
          onChange={setNewContent}
          onSubmit={addSticky}
          onClose={() => setIsAdding(false)}
          selectedColor={selectedColor}
          onPickColor={setSelectedColor}
        />
      )}

      {isAddingHeading && isTeacher && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden bg-slate-900/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-6 sm:pb-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-8"
          >
            <h2 className="text-2xl font-bold mb-6">Überschrift für Ideen</h2>
            <form onSubmit={addHeading}>
              <input
                autoFocus
                type="text"
                value={headingTitle}
                onChange={(e) => setHeadingTitle(e.target.value)}
                placeholder="z. B. Vorteile · Nachteile · offene Fragen"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none mb-6"
              />
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setIsAddingHeading(false)}
                  className="flex-1 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-50"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-semibold hover:bg-slate-900 shadow-lg"
                >
                  Anlegen
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function DraggableBoardSticky({
  sticky,
  displayScale,
  canDrag,
  isTeacher,
  canModerate,
  canResize,
  showAuthorOnStickies,
  headings,
  onDragEnd,
  onDelete,
  onApprove,
  onAssign,
  onResizePreview,
  onResizeCommit,
}: {
  sticky: StickyNote;
  displayScale: number;
  canDrag: boolean;
  isTeacher: boolean;
  canModerate: boolean;
  canResize: boolean;
  showAuthorOnStickies: boolean;
  headings: StickyNote[];
  onDragEnd: (x: number, y: number) => void | Promise<void>;
  onDelete: () => void;
  onApprove: () => void;
  onAssign: (headingId: string | null) => void;
  onResizePreview: (scale: number | null) => void;
  onResizeCommit: (scale: number) => void;
}) {
  const dragControls = useDragControls();
  const isHeading = sticky.stickyType === 'heading';

  return (
    <motion.div
      drag={canDrag}
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      onDragEnd={(_, info) => onDragEnd(sticky.x + info.offset.x, sticky.y + info.offset.y)}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1, x: sticky.x, y: sticky.y }}
      exit={{ opacity: 0, scale: 0.85 }}
      className="absolute flex flex-col items-stretch gap-0 select-none"
      style={{ zIndex: isHeading ? 5 : 4 }}
    >
      {canDrag && (
        <div
          className="flex items-center gap-1.5 h-7 px-2 rounded-t-lg bg-slate-800/85 text-white text-xs font-semibold cursor-grab active:cursor-grabbing shrink-0"
          onPointerDown={(e) => {
            e.preventDefault();
            dragControls.start(e);
          }}
          title="Zum Verschieben ziehen"
        >
          <GripVertical className="w-4 h-4 shrink-0 opacity-90" />
          <span className="truncate">{isHeading ? 'Überschrift' : 'Idee'}</span>
        </div>
      )}

      <div
        className={`group/sticky relative shadow-lg ${
          isHeading
            ? 'min-w-[min(300px,calc(100vw-2rem))] max-w-[min(480px,calc(100vw-2rem))] px-5 py-4 rounded-b-xl rounded-tr-xl bg-slate-200 border-2 border-slate-400'
            : `flex min-h-[10.5rem] flex-col overflow-hidden rounded-b-xl rounded-tr-xl border-2 border-slate-300/80 ${
                sticky.status === 'pending' ? 'ring-4 ring-blue-400 ring-opacity-40' : ''
              }`
        }`}
        style={{
          width: isHeading ? undefined : `min(${IDEA_CARD_BASE_PX}px, calc(100vw - 2rem))`,
          backgroundColor: isHeading ? undefined : sticky.color,
          transform: `scale(${displayScale})`,
          transformOrigin: 'top left',
        }}
      >
        {isHeading ? (
          <p
            className="text-slate-900 font-bold break-words"
            style={{
              fontSize: 'calc(1.2rem + 4pt)',
              lineHeight: 1.35,
            }}
          >
            {sticky.content}
          </p>
        ) : (
          <div className="flex min-h-[9.75rem] flex-1 flex-col justify-center px-5 pb-9 pt-5">
            <p
              className="text-slate-900 break-words font-semibold leading-tight tracking-tight"
              style={{
                fontSize: 'clamp(1.35rem, 0.35rem + 2.8vw, 2rem)',
                lineHeight: 1.2,
              }}
            >
              {sticky.content}
            </p>
          </div>
        )}
        {!isHeading && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
            <div className="pointer-events-auto flex min-w-0 items-center gap-1">
            {isTeacher && sticky.status === 'pending' && sticky.stickyType === 'note' && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove();
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/45 text-emerald-700 shadow-sm backdrop-blur-sm transition-colors hover:bg-emerald-100"
                title="Freigeben"
                aria-label="Karte freigeben"
              >
                <Check className="h-4 w-4" />
              </button>
            )}
            {isTeacher && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/45 text-rose-700 shadow-sm backdrop-blur-sm transition-colors hover:bg-rose-100"
                title="Karte löschen"
                aria-label="Karte löschen"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            {sticky.stickyType === 'note' && canModerate && (
              <StickyHeadingMenu
                currentHeadingId={sticky.underHeadingId}
                headings={headings}
                onAssign={onAssign}
                compact
              />
            )}
            </div>
            <div className="pointer-events-none flex min-w-0 flex-1 items-center justify-center px-1">
            {showAuthorOnStickies && sticky.authorName.trim() !== '' && (
              <span className="truncate rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600/80 backdrop-blur-sm">
                {sticky.authorName}
              </span>
            )}
            </div>
            <div className="pointer-events-auto flex shrink-0 items-center justify-center">
            {canResize && (
              <StickyResizeHandle
                displayScale={displayScale}
                onPreview={onResizePreview}
                onCommit={onResizeCommit}
                ariaLabel={isHeading ? 'Größe der Überschrift' : 'Größe der Ideenkarte'}
              />
            )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StickyResizeHandle({
  displayScale,
  onPreview,
  onCommit,
  ariaLabel = 'Größe der Karte',
}: {
  displayScale: number;
  onPreview: (s: number | null) => void;
  onCommit: (s: number) => void;
  ariaLabel?: string;
}) {
  const ref = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startScale: 1,
    pointerId: -1,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    ref.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startScale: displayScale,
      pointerId: e.pointerId,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!ref.current.active || e.pointerId !== ref.current.pointerId) return;
    const dx = e.clientX - ref.current.startX;
    const dy = e.clientY - ref.current.startY;
    const delta = (dx + dy) / 180;
    const next = clampDisplayScale(ref.current.startScale + delta);
    onPreview(next);
  };

  const end = (e: React.PointerEvent) => {
    if (!ref.current.active || e.pointerId !== ref.current.pointerId) return;
    ref.current.active = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const dx = e.clientX - ref.current.startX;
    const dy = e.clientY - ref.current.startY;
    const delta = (dx + dy) / 180;
    const next = clampDisplayScale(ref.current.startScale + delta);
    onPreview(null);
    onCommit(next);
  };

  return (
    <div
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0.5}
      aria-valuemax={4}
      aria-valuenow={displayScale}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      className="flex h-7 w-7 shrink-0 cursor-nwse-resize items-end justify-end rounded-md rounded-br-xl border border-slate-600 bg-slate-800/85 p-1 text-white/90 shadow-sm touch-none transition-colors hover:bg-slate-900"
      title="Größe ziehen"
    >
      <div className="h-2 w-2 rounded-br border-b-2 border-r-2 border-white/90 opacity-95" />
    </div>
  );
}

/** Tafelmodus: Lesekarte, optional Zuordnung/Freigabe/Löschen für Lehrkraft & Moderation. */
function PresentationNoteCard({
  sticky,
  showAuthorOnStickies,
  canModerate = false,
  headings = [],
  onAssign,
  isTeacher = false,
  onApprove,
  onDelete,
}: {
  sticky: StickyNote;
  showAuthorOnStickies: boolean;
  canModerate?: boolean;
  headings?: StickyNote[];
  onAssign?: (headingId: string | null) => void;
  isTeacher?: boolean;
  onApprove?: () => void;
  onDelete?: () => void;
}) {
  const pending = sticky.status === 'pending';
  const showToolbar =
    Boolean(canModerate && onAssign) ||
    Boolean(isTeacher && onDelete) ||
    Boolean(isTeacher && pending && onApprove);

  return (
    <article
      className={`flex w-full min-w-0 flex-col rounded-xl border border-slate-300/70 shadow-md ${BOARD_PRESENTATION.cardMinH} ${BOARD_PRESENTATION.cardPad} ${
        pending ? 'ring-2 ring-amber-400/80 ring-offset-2 ring-offset-white' : ''
      }`}
      style={{ backgroundColor: sticky.color }}
    >
      {pending && (
        <span className="mb-2 inline-flex w-fit rounded-md bg-amber-100/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
          Ausstehend
        </span>
      )}
      <p
        className={`text-slate-900 ${BOARD_PRESENTATION.noteText} font-semibold break-words [text-wrap:pretty]`}
        style={{
          fontSize: `clamp(0.95rem, ${(1.0625 * sticky.displayScale).toFixed(3)}rem, 2.1rem)`,
        }}
      >
        {sticky.content}
      </p>
      {showAuthorOnStickies && sticky.authorName.trim() !== '' && (
        <p className="mt-3 border-t border-black/10 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-600/90">
          {sticky.authorName}
        </p>
      )}
      {showToolbar && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/15 pt-3"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {canModerate && onAssign && (
            <StickyHeadingMenu
              currentHeadingId={sticky.underHeadingId}
              headings={headings}
              onAssign={onAssign}
              menuPlacement="below"
            />
          )}
          {isTeacher && pending && onApprove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onApprove();
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/15 px-2 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-600/25"
              title="Freigeben"
            >
              <Check className="h-4 w-4" />
              Freigeben
            </button>
          )}
          {isTeacher && onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-600/15 px-2 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-600/25"
              title="Karte löschen"
            >
              <Trash2 className="h-4 w-4" />
              Löschen
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function StickyFormModal({
  title,
  value,
  onChange,
  onSubmit,
  onClose,
  selectedColor,
  onPickColor,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  selectedColor: string;
  onPickColor: (c: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden bg-slate-900/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-6 sm:pb-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-8"
      >
        <h2 className="text-2xl font-bold mb-6">{title}</h2>
        <form onSubmit={onSubmit}>
          <textarea
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Schreibe deine Idee hier..."
            className="w-full min-h-40 px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none mb-6 resize-y text-base"
          />
          <div className="mb-6 flex flex-wrap gap-3">
            <ColorOption color="#fef08a" active={selectedColor === '#fef08a'} onClick={() => onPickColor('#fef08a')} />
            <ColorOption color="#bfdbfe" active={selectedColor === '#bfdbfe'} onClick={() => onPickColor('#bfdbfe')} />
            <ColorOption color="#bbf7d0" active={selectedColor === '#bbf7d0'} onClick={() => onPickColor('#bbf7d0')} />
            <ColorOption color="#fecaca" active={selectedColor === '#fecaca'} onClick={() => onPickColor('#fecaca')} />
            <ColorOption color="#ddd6fe" active={selectedColor === '#ddd6fe'} onClick={() => onPickColor('#ddd6fe')} />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 shadow-lg"
            >
              Hinzufügen
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function ColorOption({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-10 h-10 rounded-lg border-2 transition-all ${
        active ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent hover:scale-105'
      }`}
      style={{ backgroundColor: color }}
    />
  );
}
