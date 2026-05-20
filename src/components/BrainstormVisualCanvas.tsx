import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ImagePlus,
  Lock,
  Unlock,
  Type,
  ArrowRight,
  Square,
  Circle,
  Highlighter,
  Trash2,
  Download,
  FileImage,
  FileText,
  ZoomIn,
  ZoomOut,
  Layers,
  Undo2,
  MousePointer2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchBrainstormCanvas, rowToBrainstormCanvas, upsertBrainstormCanvas } from '../lib/brainstormCanvasDb';
import {
  BRAINSTORM_CANVAS_HEIGHT,
  BRAINSTORM_CANVAS_WIDTH,
  defaultBrainstormCanvas,
  type BrainstormAnnotation,
  type BrainstormCanvasState,
  type BrainstormCanvasTool,
} from '../lib/brainstormCanvasTypes';
import {
  BRAINSTORM_ACCEPT,
  removeBrainstormBackgroundFile,
  uploadBrainstormBackground,
} from '../lib/brainstormStorage';
import {
  downloadBrainstormCanvasPdf,
  downloadBrainstormCanvasPng,
  waitForBrainstormExportRoot,
} from '../lib/brainstormExport';

type Props = {
  sessionId: string;
  isTeacher: boolean;
  onAddHeading?: () => void;
  children: React.ReactNode;
};

function clientToCanvas(
  clientX: number,
  clientY: number,
  canvasEl: HTMLElement,
  scrollEl: HTMLElement | null
): { x: number; y: number } {
  const rect = canvasEl.getBoundingClientRect();
  const scrollLeft = scrollEl?.scrollLeft ?? 0;
  const scrollTop = scrollEl?.scrollTop ?? 0;
  return {
    x: clientX - rect.left + scrollLeft,
    y: clientY - rect.top + scrollTop,
  };
}

function AnnotationSvg({ items }: { items: BrainstormAnnotation[] }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      width={BRAINSTORM_CANVAS_WIDTH}
      height={BRAINSTORM_CANVAS_HEIGHT}
      aria-hidden
    >
      <defs>
        <marker id="brainstorm-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#1e293b" />
        </marker>
      </defs>
      {items.map((a) => {
        const stroke = a.color ?? '#1e293b';
        const sw = a.strokeWidth ?? 2;
        if (a.kind === 'arrow' && a.x2 != null && a.y2 != null) {
          return (
            <line
              key={a.id}
              x1={a.x}
              y1={a.y}
              x2={a.x2}
              y2={a.y2}
              stroke={stroke}
              strokeWidth={sw}
              markerEnd="url(#brainstorm-arrowhead)"
            />
          );
        }
        if (a.kind === 'rect' && a.w != null && a.h != null) {
          return (
            <rect
              key={a.id}
              x={Math.min(a.x, a.x + a.w)}
              y={Math.min(a.y, a.y + a.h)}
              width={Math.abs(a.w)}
              height={Math.abs(a.h)}
              fill="none"
              stroke={stroke}
              strokeWidth={sw}
            />
          );
        }
        if (a.kind === 'circle' && a.w != null && a.h != null) {
          const rx = Math.abs(a.w) / 2;
          const ry = Math.abs(a.h) / 2;
          return (
            <ellipse
              key={a.id}
              cx={a.x + a.w / 2}
              cy={a.y + a.h / 2}
              rx={rx}
              ry={ry}
              fill="none"
              stroke={stroke}
              strokeWidth={sw}
            />
          );
        }
        if (a.kind === 'highlight' && a.w != null && a.h != null) {
          return (
            <rect
              key={a.id}
              x={Math.min(a.x, a.x + a.w)}
              y={Math.min(a.y, a.y + a.h)}
              width={Math.abs(a.w)}
              height={Math.abs(a.h)}
              fill="#facc15"
              fillOpacity={0.35}
              stroke="#eab308"
              strokeWidth={1}
            />
          );
        }
        return null;
      })}
    </svg>
  );
}

function TextAnnotations({
  items,
  isTeacher,
  onEdit,
}: {
  items: BrainstormAnnotation[];
  isTeacher: boolean;
  onEdit: (id: string, text: string) => void;
}) {
  return (
    <>
      {items
        .filter((a) => a.kind === 'text')
        .map((a) => (
          <div
            key={a.id}
            className="pointer-events-auto absolute max-w-[280px] rounded-lg border border-slate-300/80 bg-white/95 px-3 py-2 text-base font-medium text-slate-900 shadow-sm"
            style={{ left: a.x, top: a.y, zIndex: 3 }}
            contentEditable={isTeacher}
            suppressContentEditableWarning
            onBlur={(e) => onEdit(a.id, (e.currentTarget.textContent ?? '').trim() || 'Text')}
          >
            {a.text ?? 'Text'}
          </div>
        ))}
    </>
  );
}

export function BrainstormVisualCanvas({ sessionId, isTeacher, onAddHeading, children }: Props) {
  const [canvas, setCanvas] = useState<BrainstormCanvasState>(() => defaultBrainstormCanvas(sessionId));
  const [tool, setTool] = useState<BrainstormCanvasTool>('select');
  const [draft, setDraft] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [arrowStart, setArrowStart] = useState<{ x: number; y: number } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const drawRef = useRef<{ kind: 'rect' | 'circle' | 'highlight'; startX: number; startY: number } | null>(null);
  const canvasRefState = useRef(canvas);
  canvasRefState.current = canvas;

  const persist = useCallback(
    (patch: Parameters<typeof upsertBrainstormCanvas>[1]) => {
      if (!isTeacher) return;
      void upsertBrainstormCanvas(sessionId, patch).catch((e) => {
        setStatusMsg(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
      });
    },
    [isTeacher, sessionId]
  );

  const schedulePersist = useCallback(
    (next: BrainstormCanvasState) => {
      setCanvas(next);
      if (!isTeacher) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void upsertBrainstormCanvas(sessionId, {
          backgroundPath: next.backgroundPath,
          bgX: next.bgX,
          bgY: next.bgY,
          bgScale: next.bgScale,
          bgLocked: next.bgLocked,
          annotations: next.annotations,
        }).catch((e) => {
          setStatusMsg(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
        });
      }, 380);
    },
    [isTeacher, sessionId]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchBrainstormCanvas(sessionId)
      .then((c) => {
        if (!cancelled) setCanvas(c);
      })
      .catch(() => {
        if (!cancelled) setCanvas(defaultBrainstormCanvas(sessionId));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const channel = supabase
      .channel(`brainstorm_canvas:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'brainstorm_canvas',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setCanvas(defaultBrainstormCanvas(sessionId));
            return;
          }
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          const incoming = rowToBrainstormCanvas(row);
          setCanvas((prev) => {
            const prevTs = Date.parse(prev.updatedAt);
            const nextTs = Date.parse(incoming.updatedAt);
            if (Number.isFinite(prevTs) && Number.isFinite(nextTs) && nextTs < prevTs) return prev;
            return incoming;
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const pushAnnotation = useCallback(
    (ann: BrainstormAnnotation) => {
      const next = { ...canvasRefState.current, annotations: [...canvasRefState.current.annotations, ann] };
      schedulePersist(next);
    },
    [schedulePersist]
  );

  const updateAnnotations = useCallback(
    (fn: (list: BrainstormAnnotation[]) => BrainstormAnnotation[]) => {
      const next = { ...canvasRefState.current, annotations: fn(canvasRefState.current.annotations) };
      schedulePersist(next);
    },
    [schedulePersist]
  );

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (!isTeacher || tool === 'select') return;
    if ((e.target as HTMLElement).closest('[data-brainstorm-sticky]')) return;
    const el = canvasRef.current;
    const vp = viewportRef.current;
    if (!el) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY, el, vp);

    if (tool === 'text') {
      const text = window.prompt('Textfeld:', 'Text') ?? '';
      if (!text.trim()) return;
      pushAnnotation({ id: crypto.randomUUID(), kind: 'text', x, y, text: text.trim() });
      setTool('select');
      return;
    }

    if (tool === 'arrow') {
      if (!arrowStart) {
        setArrowStart({ x, y });
        return;
      }
      pushAnnotation({
        id: crypto.randomUUID(),
        kind: 'arrow',
        x: arrowStart.x,
        y: arrowStart.y,
        x2: x,
        y2: y,
      });
      setArrowStart(null);
      setTool('select');
      return;
    }

    if (tool === 'rect' || tool === 'circle' || tool === 'highlight') {
      drawRef.current = { kind: tool, startX: x, startY: y };
      setDraft({ x, y, x2: x, y2: y });
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    const el = canvasRef.current;
    const vp = viewportRef.current;
    if (!el || !drawRef.current) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY, el, vp);
    const d = drawRef.current;
    setDraft({ x: d.startX, y: d.startY, x2: x, y2: y });
  };

  const finishDraw = () => {
    const d = drawRef.current;
    const dr = draft;
    drawRef.current = null;
    setDraft(null);
    if (!d || !dr) return;
    const w = dr.x2 - dr.x;
    const h = dr.y2 - dr.y;
    if (Math.abs(w) < 6 && Math.abs(h) < 6) {
      setTool('select');
      return;
    }
    pushAnnotation({
      id: crypto.randomUUID(),
      kind: d.kind,
      x: dr.x,
      y: dr.y,
      w,
      h,
    });
    setTool('select');
  };

  const handleBgPointerDown = (e: React.PointerEvent) => {
    if (!isTeacher || canvas.bgLocked || !canvas.backgroundUrl) return;
    e.stopPropagation();
    bgDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: canvas.bgX,
      origY: canvas.bgY,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleBgPointerMove = (e: React.PointerEvent) => {
    const drag = bgDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setCanvas((c) => ({ ...c, bgX: drag.origX + dx, bgY: drag.origY + dy }));
  };

  const handleBgPointerUp = () => {
    if (!bgDragRef.current) return;
    bgDragRef.current = null;
    const c = canvasRefState.current;
    persist({ bgX: c.bgX, bgY: c.bgY });
  };

  const onUpload = async (file: File) => {
    setUploadBusy(true);
    setStatusMsg(null);
    try {
      const oldPath = canvas.backgroundPath;
      const { path, publicUrl } = await uploadBrainstormBackground(sessionId, file);
      const next: BrainstormCanvasState = {
        ...canvasRefState.current,
        backgroundPath: path,
        backgroundUrl: publicUrl,
        bgX: 80,
        bgY: 80,
        bgScale: 1,
        bgLocked: false,
      };
      setCanvas(next);
      await upsertBrainstormCanvas(sessionId, {
        backgroundPath: path,
        bgX: next.bgX,
        bgY: next.bgY,
        bgScale: next.bgScale,
        bgLocked: false,
      });
      if (oldPath && oldPath !== path) {
        void removeBrainstormBackgroundFile(oldPath).catch(() => undefined);
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploadBusy(false);
    }
  };

  const removeTemplate = async () => {
    if (!window.confirm('Vorlage und Hintergrundbild wirklich entfernen?')) return;
    const path = canvas.backgroundPath;
    const next = defaultBrainstormCanvas(sessionId);
    setCanvas(next);
    await upsertBrainstormCanvas(sessionId, {
      backgroundPath: null,
      bgX: next.bgX,
      bgY: next.bgY,
      bgScale: next.bgScale,
      bgLocked: false,
      annotations: [],
    });
    if (path) void removeBrainstormBackgroundFile(path).catch(() => undefined);
  };

  const adjustScale = (delta: number) => {
    const next = { ...canvasRefState.current, bgScale: Math.min(4, Math.max(0.15, canvasRefState.current.bgScale + delta)) };
    schedulePersist(next);
  };

  const toggleLock = () => {
    const next = { ...canvasRefState.current, bgLocked: !canvasRefState.current.bgLocked };
    schedulePersist(next);
  };

  const runExport = async (kind: 'png' | 'pdf') => {
    setExportBusy(true);
    setStatusMsg(null);
    try {
      const el = await waitForBrainstormExportRoot();
      if (!el) throw new Error('Ideenfläche nicht gefunden.');
      const base = `ideenwand-${sessionId.slice(0, 8)}`;
      if (kind === 'png') await downloadBrainstormCanvasPng(el, base);
      else await downloadBrainstormCanvasPdf(el, base);
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'Export fehlgeschlagen');
    } finally {
      setExportBusy(false);
    }
  };

  const svgAnnotations = canvas.annotations.filter((a) => a.kind !== 'text');

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-100">
      {isTeacher && (
        <div className="z-50 shrink-0 border-b border-slate-200/80 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur-sm sm:px-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
            <input
              ref={fileRef}
              type="file"
              accept={BRAINSTORM_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onUpload(f);
              }}
            />
            <ToolbarBtn
              title="Vorlage hochladen"
              active={false}
              disabled={uploadBusy}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title={canvas.bgLocked ? 'Vorlage entsperren' : 'Vorlage sperren'} onClick={toggleLock}>
              {canvas.bgLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </ToolbarBtn>
            <ToolbarBtn title="Verkleinern" onClick={() => adjustScale(-0.1)} disabled={!canvas.backgroundUrl}>
              <ZoomOut className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Vergrößern" onClick={() => adjustScale(0.1)} disabled={!canvas.backgroundUrl}>
              <ZoomIn className="h-4 w-4" />
            </ToolbarBtn>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" />
            <ToolbarBtn title="Auswahl" active={tool === 'select'} onClick={() => { setTool('select'); setArrowStart(null); }}>
              <MousePointer2 className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Textfeld" active={tool === 'text'} onClick={() => setTool('text')}>
              <Type className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Pfeil (2× klicken)" active={tool === 'arrow'} onClick={() => { setTool('arrow'); setArrowStart(null); }}>
              <ArrowRight className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Rechteck" active={tool === 'rect'} onClick={() => setTool('rect')}>
              <Square className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Kreis" active={tool === 'circle'} onClick={() => setTool('circle')}>
              <Circle className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Hervorheben" active={tool === 'highlight'} onClick={() => setTool('highlight')}>
              <Highlighter className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn
              title="Letzte Markierung"
              onClick={() => updateAnnotations((list) => list.slice(0, -1))}
              disabled={canvas.annotations.length === 0}
            >
              <Undo2 className="h-4 w-4" />
            </ToolbarBtn>
            {onAddHeading && (
              <ToolbarBtn title="Überschrift" onClick={onAddHeading}>
                <Layers className="h-4 w-4" />
              </ToolbarBtn>
            )}
            <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" />
            <ToolbarBtn title="Vorlage entfernen" onClick={() => void removeTemplate()} disabled={!canvas.backgroundPath}>
              <Trash2 className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="PNG exportieren" disabled={exportBusy} onClick={() => void runExport('png')}>
              <FileImage className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="PDF exportieren" disabled={exportBusy} onClick={() => void runExport('pdf')}>
              <FileText className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Screenshot (PNG)" disabled={exportBusy} onClick={() => void runExport('png')}>
              <Download className="h-4 w-4" />
            </ToolbarBtn>
          </div>
          {statusMsg && <p className="mt-1 truncate px-1 text-xs text-amber-800">{statusMsg}</p>}
          {arrowStart && tool === 'arrow' && (
            <p className="mt-0.5 px-1 text-xs text-slate-500">Pfeil: Zielpunkt auf der Fläche anklicken</p>
          )}
        </div>
      )}

      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto touch-pan-x touch-pan-y">
        <div
          ref={canvasRef}
          data-brainstorm-export-root
          data-brainstorm-canvas-surface
          className="relative bg-slate-100"
          style={{
            width: BRAINSTORM_CANVAS_WIDTH,
            height: BRAINSTORM_CANVAS_HEIGHT,
            minWidth: BRAINSTORM_CANVAS_WIDTH,
            minHeight: BRAINSTORM_CANVAS_HEIGHT,
          }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={finishDraw}
          onPointerCancel={finishDraw}
        >
          {canvas.backgroundUrl && (
            <div
              className="absolute select-none"
              style={{
                left: canvas.bgX,
                top: canvas.bgY,
                zIndex: 1,
                transform: `scale(${canvas.bgScale})`,
                transformOrigin: 'top left',
                cursor: isTeacher && !canvas.bgLocked ? 'grab' : 'default',
              }}
              onPointerDown={handleBgPointerDown}
              onPointerMove={handleBgPointerMove}
              onPointerUp={handleBgPointerUp}
              onPointerCancel={handleBgPointerUp}
            >
              <img
                src={canvas.backgroundUrl}
                alt=""
                draggable={false}
                className="max-w-none rounded-sm shadow-sm"
                style={{ maxHeight: BRAINSTORM_CANVAS_HEIGHT * 0.95 }}
                crossOrigin="anonymous"
              />
            </div>
          )}

          <AnnotationSvg items={svgAnnotations} />
          <TextAnnotations
            items={canvas.annotations}
            isTeacher={isTeacher}
            onEdit={(id, text) =>
              updateAnnotations((list) => list.map((a) => (a.id === id ? { ...a, text } : a)))
            }
          />

          {draft && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 2 }} aria-hidden>
              {drawRef.current?.kind === 'highlight' ? (
                <rect
                  x={Math.min(draft.x, draft.x2)}
                  y={Math.min(draft.y, draft.y2)}
                  width={Math.abs(draft.x2 - draft.x)}
                  height={Math.abs(draft.y2 - draft.y)}
                  fill="#facc15"
                  fillOpacity={0.35}
                  stroke="#eab308"
                />
              ) : drawRef.current?.kind === 'circle' ? (
                <ellipse
                  cx={(draft.x + draft.x2) / 2}
                  cy={(draft.y + draft.y2) / 2}
                  rx={Math.abs(draft.x2 - draft.x) / 2}
                  ry={Math.abs(draft.y2 - draft.y) / 2}
                  fill="none"
                  stroke="#1e293b"
                  strokeWidth={2}
                />
              ) : (
                <rect
                  x={Math.min(draft.x, draft.x2)}
                  y={Math.min(draft.y, draft.y2)}
                  width={Math.abs(draft.x2 - draft.x)}
                  height={Math.abs(draft.y2 - draft.y)}
                  fill="none"
                  stroke="#1e293b"
                  strokeWidth={2}
                />
              )}
            </svg>
          )}

          {arrowStart && tool === 'arrow' && (
            <div
              className="pointer-events-none absolute h-3 w-3 rounded-full bg-blue-600 ring-2 ring-white"
              style={{ left: arrowStart.x - 6, top: arrowStart.y - 6, zIndex: 2 }}
            />
          )}

          <div className="pointer-events-none absolute inset-0" style={{ zIndex: 4 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarBtn({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
        active
          ? 'border-blue-600 bg-blue-600 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
