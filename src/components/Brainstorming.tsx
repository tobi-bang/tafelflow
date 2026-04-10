import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { supabase } from '../lib/supabase';
import { rowToSticky } from '../lib/dbMap';
import type { StickyNote, SessionPermissions } from '../types';
import { Plus, Trash2, Check, Layers, GripVertical } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';

/** Basisbreite der Ideenkarte in px (wird mit display_scale multipliziert). */
const IDEA_CARD_BASE_PX = 320;

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
    if (isTeacher) {
      const { error } = await supabase
        .from('stickies')
        .update({ under_heading_id: underHeadingId })
        .eq('id', stickyId);
      if (error) console.error(error);
      return;
    }
    const { error } = await supabase.rpc('assign_sticky_heading', {
      p_sticky_id: stickyId,
      p_under_heading_id: underHeadingId,
    });
    if (error) console.error(error);
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

  const presentationScale = presentationMode ? 'text-lg' : '';

  if (presentationMode) {
    const notes = visible.filter((s) => s.stickyType === 'note');
    const orphan = notes.filter((n) => !n.underHeadingId);
    const sortedHeadings = [...headings].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return (
      <div className="relative w-full h-full overflow-hidden bg-slate-100 flex flex-col">
        <div className="shrink-0 px-6 py-3 flex flex-wrap gap-3 items-center border-b border-slate-200 bg-white/90">
          {isTeacher && (
            <button
              type="button"
              onClick={() => setIsAddingHeading(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-700 text-white font-semibold hover:bg-slate-800"
            >
              <Layers className="w-4 h-4" />
              Überschrift
            </button>
          )}
          {canModerate && (
            <span className="text-sm text-slate-500">
              Ideen per Auswahl einer Spalte zuordnen {isTeacher ? '(Lehrkraft)' : '(Moderation)'}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-4 h-full min-h-[min(60vh,480px)]">
            <div className="min-w-[300px] max-w-[400px] flex flex-col gap-3 rounded-2xl bg-white/80 border border-slate-200 p-4 shadow-sm">
              <h3 className={`font-bold text-slate-500 uppercase tracking-wide ${presentationMode ? 'text-base' : 'text-sm'}`}>
                Sammeln
              </h3>
              <div className="flex flex-col gap-2 overflow-y-auto flex-1">
                {orphan.map((sticky) => (
                  <Fragment key={sticky.id}>
                    <PresentationNoteCard
                      sticky={sticky}
                      presentationScale={presentationScale}
                      isTeacher={isTeacher}
                      canModerate={canModerate}
                      headings={sortedHeadings}
                      onApprove={approveSticky}
                      onDelete={deleteSticky}
                      onAssign={assignUnderHeading}
                      showAuthorOnStickies={showAuthorOnStickies}
                    />
                  </Fragment>
                ))}
                {orphan.length === 0 && (
                  <p className="text-slate-400 text-sm">Noch keine freien Ideen.</p>
                )}
              </div>
            </div>

            {sortedHeadings.map((h) => (
              <div
                key={h.id}
                className="min-w-[320px] max-w-[440px] flex flex-col gap-3 rounded-2xl bg-white/90 border border-slate-200 p-4 shadow-sm"
              >
                <div className="rounded-xl bg-slate-200 px-4 py-3 flex justify-between items-start gap-2">
                  <span
                    className={`font-bold text-slate-900 ${presentationMode ? '' : 'text-lg'}`}
                    style={presentationMode ? { fontSize: 'calc(1.35rem + 3pt)' } : { fontSize: 'calc(1.15rem + 3pt)' }}
                  >
                    {h.content}
                  </span>
                  {isTeacher && (
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteSticky(h.id);
                      }}
                      className="p-2 hover:bg-rose-500/20 rounded-lg text-rose-700 shrink-0 z-10"
                      title="Überschrift löschen"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2 overflow-y-auto flex-1">
                  {notes
                    .filter((n) => n.underHeadingId === h.id)
                    .map((sticky) => (
                      <Fragment key={sticky.id}>
                        <PresentationNoteCard
                          sticky={sticky}
                          presentationScale={presentationScale}
                          isTeacher={isTeacher}
                          canModerate={canModerate}
                          headings={sortedHeadings}
                          onApprove={approveSticky}
                          onDelete={deleteSticky}
                          onAssign={assignUnderHeading}
                          showAuthorOnStickies={showAuthorOnStickies}
                        />
                      </Fragment>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {canAdd && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="absolute bottom-8 right-8 z-40 bg-blue-600 text-white p-4 rounded-full shadow-xl hover:bg-blue-700 transition-all hover:scale-110"
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
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6 z-[100]">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
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
                <div className="flex gap-3">
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
    <div className="relative w-full h-full overflow-hidden bg-slate-100 p-8">
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
          className="absolute bottom-8 right-8 z-40 bg-blue-600 text-white p-4 rounded-full shadow-xl hover:bg-blue-700 transition-all hover:scale-110"
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
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6 z-[100]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
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
              <div className="flex gap-3">
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
        className={`shadow-lg relative ${
          isHeading
            ? 'min-w-[300px] max-w-[480px] px-5 py-4 rounded-b-xl rounded-tr-xl bg-slate-200 border-2 border-slate-400'
            : `rounded-b-xl rounded-tr-xl border-2 border-slate-300/80 ${
                sticky.status === 'pending' ? 'ring-4 ring-blue-400 ring-opacity-40' : ''
              }`
        }`}
        style={{
          width: isHeading ? undefined : IDEA_CARD_BASE_PX,
          backgroundColor: isHeading ? undefined : sticky.color,
          transform: `scale(${displayScale})`,
          transformOrigin: 'top left',
        }}
      >
        <p
          className={`text-slate-900 font-medium break-words mb-2 ${isHeading ? 'font-bold' : ''}`}
          style={{
            fontSize: isHeading ? 'calc(1.2rem + 4pt)' : 'calc(1.05rem + 4pt)',
            lineHeight: 1.35,
          }}
        >
          {sticky.content}
        </p>
        {sticky.stickyType === 'note' && canModerate && (
          <div
            className="mt-2"
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
          >
            <label className="sr-only" htmlFor={`col-${sticky.id}`}>
              Spalte
            </label>
            <select
              id={`col-${sticky.id}`}
              value={sticky.underHeadingId ?? ''}
              onChange={(e) => onAssign(e.target.value || null)}
              className="w-full text-sm rounded-lg border border-slate-300 bg-white/95 px-2 py-2"
            >
              <option value="">Ohne Überschrift</option>
              {headings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.content}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 gap-y-1 items-center mt-3 pt-2 border-t border-black/10">
          <div className="flex items-center gap-0.5 justify-self-start shrink-0">
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
                className="p-2 hover:bg-emerald-500/20 rounded-lg text-emerald-700"
                title="Freigeben"
              >
                <Check className="w-5 h-5" />
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
                className="p-2 hover:bg-rose-500/20 rounded-lg text-rose-700"
                title="Karte löschen"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="min-w-0 flex items-center justify-center px-1">
            {showAuthorOnStickies && sticky.authorName.trim() !== '' && (
              <span className="text-xs font-bold uppercase text-slate-600 opacity-75 truncate text-center">
                {sticky.authorName}
              </span>
            )}
          </div>
          <div className="justify-self-end shrink-0 flex items-center justify-center min-w-9 min-h-9">
            {sticky.stickyType === 'note' && canResize && (
              <StickyResizeHandle
                displayScale={displayScale}
                onPreview={onResizePreview}
                onCommit={onResizeCommit}
              />
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function StickyResizeHandle({
  displayScale,
  onPreview,
  onCommit,
}: {
  displayScale: number;
  onPreview: (s: number | null) => void;
  onCommit: (s: number) => void;
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
      aria-label="Größe der Ideenkarte"
      aria-valuemin={0.5}
      aria-valuemax={4}
      aria-valuenow={displayScale}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      className="w-9 h-9 rounded-lg rounded-br-xl bg-slate-800/90 border border-slate-600 cursor-nwse-resize flex items-end justify-end p-1 shadow-md touch-none shrink-0"
      title="Größe ziehen"
    >
      <div className="w-2.5 h-2.5 rounded-br border-r-2 border-b-2 border-white/90 opacity-95" />
    </div>
  );
}

function PresentationNoteCard({
  sticky,
  presentationScale,
  isTeacher,
  canModerate,
  headings,
  onApprove,
  onDelete,
  onAssign,
  showAuthorOnStickies,
}: {
  sticky: StickyNote;
  presentationScale: string;
  isTeacher: boolean;
  canModerate: boolean;
  headings: StickyNote[];
  onApprove: (id: string) => void;
  onDelete: (id: string) => void;
  onAssign: (id: string, headingId: string | null) => void;
  showAuthorOnStickies: boolean;
}) {
  const noteTextSize = presentationScale ? 'calc(1.2rem + 4pt)' : 'calc(1.05rem + 4pt)';

  return (
    <div className="flex flex-col gap-1 w-full">
      <div
        className={`rounded-xl p-5 border-2 border-slate-200 shadow-sm ${presentationScale} ${
          sticky.status === 'pending' ? 'ring-2 ring-blue-400' : ''
        }`}
        style={{
          backgroundColor: sticky.color,
          transform: `scale(${sticky.displayScale})`,
          transformOrigin: 'top left',
          minWidth: IDEA_CARD_BASE_PX,
        }}
      >
        <p className="text-slate-900 font-medium break-words leading-snug" style={{ fontSize: noteTextSize }}>
          {sticky.content}
        </p>
        {canModerate && (
          <div className="mt-3" onPointerDown={(e) => e.stopPropagation()}>
            <select
              value={sticky.underHeadingId ?? ''}
              onChange={(e) => onAssign(sticky.id, e.target.value || null)}
              className="w-full text-sm rounded-lg border border-slate-300 bg-white/90 px-2 py-2"
            >
              <option value="">Sammeln / keine Spalte</option>
              {headings.map((h) => (
                <option key={h.id} value={h.id}>
                  Unter: {h.content}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 items-center mt-3 pt-2 border-t border-black/10">
          <div className="flex items-center gap-0.5 justify-self-start shrink-0">
            {isTeacher && sticky.status === 'pending' && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove(sticky.id);
                }}
                className="p-2 hover:bg-emerald-500/20 rounded-lg text-emerald-700"
                title="Freigeben"
              >
                <Check className="w-5 h-5" />
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
                  void onDelete(sticky.id);
                }}
                className="p-2 hover:bg-rose-500/20 rounded-lg text-rose-700"
                title="Karte löschen"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="min-w-0 flex items-center justify-center px-1">
            {showAuthorOnStickies && sticky.authorName.trim() !== '' && (
              <span className="text-xs font-bold uppercase text-slate-500 opacity-75 truncate text-center">
                {sticky.authorName}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6 z-[100]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl"
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
          <div className="flex gap-3 mb-6">
            <ColorOption color="#fef08a" active={selectedColor === '#fef08a'} onClick={() => onPickColor('#fef08a')} />
            <ColorOption color="#bfdbfe" active={selectedColor === '#bfdbfe'} onClick={() => onPickColor('#bfdbfe')} />
            <ColorOption color="#bbf7d0" active={selectedColor === '#bbf7d0'} onClick={() => onPickColor('#bbf7d0')} />
            <ColorOption color="#fecaca" active={selectedColor === '#fecaca'} onClick={() => onPickColor('#fecaca')} />
            <ColorOption color="#ddd6fe" active={selectedColor === '#ddd6fe'} onClick={() => onPickColor('#ddd6fe')} />
          </div>
          <div className="flex gap-3">
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
