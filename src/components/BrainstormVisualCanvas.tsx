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
  MousePointer2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { rowToBrainstormCanvas, upsertBrainstormCanvas } from '../lib/brainstormCanvasDb';
import {
  annotationBounds,
  findAnnotationAt,
  moveAnnotation,
  normalizeAnnotationBox,
  resizeAnnotation,
  rotateAnnotation,
  scaleAnnotationFromCenter,
} from '../lib/brainstormCanvasInteraction';
import {
  BRAINSTORM_CANVAS_HEIGHT,
  BRAINSTORM_CANVAS_WIDTH,
  defaultBrainstormCanvas,
  type BrainstormCanvasTool,
  type ResizeHandleId,
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
import { useBrainstormCanvasPersist } from '../hooks/useBrainstormCanvasPersist';
import { BrainstormResizeHandles } from './brainstorm/BrainstormResizeHandles';
import { BrainstormElementInspector } from './brainstorm/BrainstormElementInspector';
import { BrainstormCanvasProvider } from './brainstorm/brainstormCanvasContext';
import {
  fillOf,
  nextZIndex,
  parseStickySelectId,
  sortAnnotationsByZIndex,
  stickySelectId,
  strokeOf,
  type BrainstormAnnotation,
} from '../lib/brainstormCanvasTypes';

const BG_SELECT_ID = '__background__';

export type BrainstormStickyHandlers = {
  onDeleteSticky?: (id: string) => void;
  onDuplicateSticky?: (id: string) => void;
  onScaleSticky?: (id: string, factor: number) => void;
  onNudgeSticky?: (id: string, dx: number, dy: number) => void;
  onPatchSticky?: (
    id: string,
    patch: Partial<{ x: number; y: number; displayScale: number; color: string; content: string }>
  ) => void;
};

type Props = {
  sessionId: string;
  isTeacher: boolean;
  onAddHeading?: () => void;
  selectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  stickyHandlers?: BrainstormStickyHandlers;
  children: React.ReactNode;
};

function clientToCanvas(
  clientX: number,
  clientY: number,
  canvasEl: HTMLElement,
  scrollEl: HTMLElement | null
): { x: number; y: number } {
  const rect = canvasEl.getBoundingClientRect();
  return {
    x: clientX - rect.left + (scrollEl?.scrollLeft ?? 0),
    y: clientY - rect.top + (scrollEl?.scrollTop ?? 0),
  };
}

function AnnotationSvgRender({ items }: { items: BrainstormAnnotation[] }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <marker id="brainstorm-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#1e293b" />
        </marker>
      </defs>
      {items.map((a) => {
        const stroke = strokeOf(a);
        const fill = fillOf(a);
        const sw = a.strokeWidth ?? 2;
        const op = a.opacity ?? 1;
        const rot = a.rotation ?? 0;
        const box = normalizeAnnotationBox(a);
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const transform = rot ? `rotate(${rot} ${cx} ${cy})` : undefined;
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
              opacity={op}
              markerEnd="url(#brainstorm-arrowhead)"
            />
          );
        }
        if (a.kind === 'rect' && a.w != null && a.h != null) {
          return (
            <rect
              key={a.id}
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              fill={fill}
              fillOpacity={a.kind === 'highlight' ? (a.opacity ?? 0.35) : op}
              stroke={stroke}
              strokeWidth={sw}
              transform={transform}
            />
          );
        }
        if (a.kind === 'circle' && a.w != null && a.h != null) {
          return (
            <ellipse
              key={a.id}
              cx={box.x + box.w / 2}
              cy={box.y + box.h / 2}
              rx={box.w / 2}
              ry={box.h / 2}
              fill={fill}
              stroke={stroke}
              strokeWidth={sw}
              opacity={op}
              transform={transform}
            />
          );
        }
        if (a.kind === 'highlight' && a.w != null && a.h != null) {
          return (
            <rect
              key={a.id}
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              fill={fill}
              fillOpacity={a.opacity ?? 0.35}
              stroke={stroke}
              strokeWidth={1}
            />
          );
        }
        return null;
      })}
    </svg>
  );
}

function SaveStatusBadge({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null;
  const label =
    status === 'saving' ? 'Speichern…' : status === 'saved' ? 'Gespeichert' : 'Speicherfehler';
  const cls =
    status === 'saving'
      ? 'bg-amber-50 text-amber-900 border-amber-200'
      : status === 'saved'
        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
        : 'bg-red-50 text-red-800 border-red-200';
  return (
    <span
      className={`pointer-events-none absolute top-2 right-2 z-[60] rounded-lg border px-2.5 py-1 text-xs font-medium shadow-sm ${cls}`}
    >
      {label}
    </span>
  );
}

export function BrainstormVisualCanvas({
  sessionId,
  isTeacher,
  onAddHeading,
  selectedId: selectedIdProp,
  onSelectedIdChange,
  stickyHandlers,
  children,
}: Props) {
  const {
    canvas,
    canvasRef: canvasStateRef,
    tableReady,
    saveStatus,
    statusMsg,
    setStatusMsg,
    scheduleSave,
    flushSave,
  } = useBrainstormCanvasPersist(sessionId, isTeacher);

  const [tool, setTool] = useState<BrainstormCanvasTool>('select');
  const [selectedIdInternal, setSelectedIdInternal] = useState<string | null>(null);
  const selectedId = selectedIdProp !== undefined ? selectedIdProp : selectedIdInternal;
  const setSelectedId = useCallback(
    (id: string | null) => {
      if (onSelectedIdChange) onSelectedIdChange(id);
      else setSelectedIdInternal(id);
    },
    [onSelectedIdChange]
  );
  const [draft, setDraft] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [arrowStart, setArrowStart] = useState<{ x: number; y: number } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [bgDisplay, setBgDisplay] = useState({ w: 320, h: 240 });

  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bgDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const annDragRef = useRef<{ id: string; startX: number; startY: number; snapshot: BrainstormAnnotation[] } | null>(
    null
  );
  const resizeRef = useRef<{
    id: string;
    handle: ResizeHandleId;
    startX: number;
    startY: number;
    snapshot: BrainstormAnnotation[];
    proportional: boolean;
  } | null>(null);
  const drawRef = useRef<{ kind: 'rect' | 'circle' | 'highlight'; startX: number; startY: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist0: number; snapshot: BrainstormAnnotation | null; scale0: number } | null>(null);

  const selectedStickyId = parseStickySelectId(selectedId);
  const selectedAnnotation =
    selectedId && selectedId !== BG_SELECT_ID && !selectedStickyId
      ? canvas.annotations.find((a) => a.id === selectedId) ?? null
      : null;
  const sortedAnnotations = sortAnnotationsByZIndex(canvas.annotations);

  const updateCanvas = useCallback(
    (fn: (c: typeof canvas) => typeof canvas) => {
      scheduleSave(fn(canvasStateRef.current));
    },
    [scheduleSave, canvasStateRef]
  );

  useEffect(() => {
    if (!tableReady) return;
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
          if (saveStatus === 'saving') return;
          if (payload.eventType === 'DELETE') {
            scheduleSave(defaultBrainstormCanvas(sessionId));
            return;
          }
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          const incoming = rowToBrainstormCanvas(row);
          scheduleSave((prev) => {
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
  }, [sessionId, tableReady, scheduleSave, saveStatus]);

  const duplicateAnnotation = (ann: BrainstormAnnotation) => {
    const copy: BrainstormAnnotation = {
      ...ann,
      id: crypto.randomUUID(),
      x: ann.x + 24,
      y: ann.y + 24,
      zIndex: nextZIndex(canvas.annotations),
    };
    updateCanvas((c) => ({ ...c, annotations: [...c.annotations, copy] }));
    setSelectedId(copy.id);
  };

  const nudgeZ = (id: string, dir: 'up' | 'down') => {
    updateCanvas((c) => {
      const sorted = sortAnnotationsByZIndex(c.annotations);
      const idx = sorted.findIndex((a) => a.id === id);
      if (idx < 0) return c;
      const swap = dir === 'up' ? idx + 1 : idx - 1;
      if (swap < 0 || swap >= sorted.length) return c;
      const a = sorted[idx];
      const b = sorted[swap];
      const zA = a.zIndex ?? idx + 1;
      const zB = b.zIndex ?? swap + 1;
      return {
        ...c,
        annotations: c.annotations.map((x) => {
          if (x.id === a.id) return { ...x, zIndex: zB };
          if (x.id === b.id) return { ...x, zIndex: zA };
          return x;
        }),
      };
    });
  };

  useEffect(() => {
    if (!isTeacher) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (!selectedId) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !t.isContentEditable) {
        e.preventDefault();
        if (selectedStickyId) {
          stickyHandlers?.onDeleteSticky?.(selectedStickyId);
          setSelectedId(null);
          return;
        }
        if (selectedId === BG_SELECT_ID) return;
        deleteSelected();
        return;
      }

      if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (selectedStickyId) {
          stickyHandlers?.onDuplicateSticky?.(selectedStickyId);
          return;
        }
        if (selectedAnnotation) duplicateAnnotation(selectedAnnotation);
        return;
      }

      const step = e.shiftKey ? 10 : 2;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (selectedStickyId) stickyHandlers?.onPatchSticky?.(selectedStickyId, { x: 0, y: 0 }); // patched below
        else if (selectedAnnotation)
          patchAnnotation(selectedId, { x: selectedAnnotation.x - step, y: selectedAnnotation.y });
        else if (selectedId === BG_SELECT_ID) updateCanvas((c) => ({ ...c, bgX: c.bgX - step }));
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (selectedAnnotation)
          patchAnnotation(selectedId, { x: selectedAnnotation.x + step, y: selectedAnnotation.y });
        else if (selectedId === BG_SELECT_ID) updateCanvas((c) => ({ ...c, bgX: c.bgX + step }));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedAnnotation)
          patchAnnotation(selectedId, { x: selectedAnnotation.x, y: selectedAnnotation.y - step });
        else if (selectedId === BG_SELECT_ID) updateCanvas((c) => ({ ...c, bgY: c.bgY - step }));
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedAnnotation)
          patchAnnotation(selectedId, { x: selectedAnnotation.x, y: selectedAnnotation.y + step });
        else if (selectedId === BG_SELECT_ID) updateCanvas((c) => ({ ...c, bgY: c.bgY + step }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTeacher, selectedId, selectedAnnotation, selectedStickyId, updateCanvas, stickyHandlers]);

  const canvasPoint = (e: React.PointerEvent) => {
    const el = canvasRef.current;
    if (!el) return null;
    return clientToCanvas(e.clientX, e.clientY, el, viewportRef.current);
  };

  const patchAnnotation = (id: string, patch: Partial<BrainstormAnnotation>) => {
    updateCanvas((c) => ({
      ...c,
      annotations: c.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    if (selectedStickyId) {
      stickyHandlers?.onDeleteSticky?.(selectedStickyId);
      setSelectedId(null);
      return;
    }
    if (selectedId === BG_SELECT_ID) {
      setSelectedId(null);
      return;
    }
    updateCanvas((c) => ({
      ...c,
      annotations: c.annotations.filter((a) => a.id !== selectedId),
    }));
    setSelectedId(null);
  };

  const handleResizePointerDown = (handle: ResizeHandleId, e: React.PointerEvent) => {
    if (!selectedId || tool !== 'select') return;
    e.stopPropagation();
    const pt = canvasPoint(e);
    if (!pt) return;

    if (selectedId === BG_SELECT_ID) {
      resizeRef.current = {
        id: BG_SELECT_ID,
        handle,
        startX: pt.x,
        startY: pt.y,
        snapshot: [],
        proportional: e.shiftKey,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const ann = canvas.annotations.find((a) => a.id === selectedId);
    if (!ann) return;
    resizeRef.current = {
      id: selectedId,
      handle,
      startX: pt.x,
      startY: pt.y,
      snapshot: canvas.annotations,
      proportional: e.shiftKey,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMoveGlobal = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && selectedId && selectedId !== BG_SELECT_ID && tool === 'select') {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (!pinchRef.current) {
        const ann = canvas.annotations.find((a) => a.id === selectedId) ?? null;
        pinchRef.current = { dist0: dist, snapshot: ann, scale0: 1 };
      } else if (pinchRef.current.snapshot && pinchRef.current.dist0 > 8) {
        const scale = dist / pinchRef.current.dist0;
        const next = scaleAnnotationFromCenter(pinchRef.current.snapshot, scale, true);
        updateCanvas((c) => ({
          ...c,
          annotations: c.annotations.map((a) => (a.id === selectedId ? next : a)),
        }));
      }
      return;
    }

    const resize = resizeRef.current;
    if (resizeRef.current) {
      resizeRef.current.proportional = e.shiftKey;
      const resize = resizeRef.current;
      const pt = canvasPoint(e);
      if (!pt) return;
      const dx = pt.x - resize.startX;
      const dy = pt.y - resize.startY;
      if (resize.id === BG_SELECT_ID) {
        const delta = (dx + dy) / 400;
        updateCanvas((c) => ({
          ...c,
          bgScale: Math.min(4, Math.max(0.15, c.bgScale + delta)),
        }));
        return;
      }
      const base = resize.snapshot.find((a) => a.id === resize.id);
      if (!base) return;
      const next = resizeAnnotation(base, resize.handle, dx, dy, resize.proportional || e.shiftKey);
      updateCanvas((c) => ({
        ...c,
        annotations: c.annotations.map((a) => (a.id === resize.id ? next : a)),
      }));
      return;
    }

    const bgDrag = bgDragRef.current;
    if (bgDrag && selectedId === BG_SELECT_ID) {
      const dx = e.clientX - bgDrag.startX;
      const dy = e.clientY - bgDrag.startY;
      updateCanvas((c) => ({ ...c, bgX: bgDrag.origX + dx, bgY: bgDrag.origY + dy }));
      return;
    }

    const drag = annDragRef.current;
    if (drag && tool === 'select') {
      const pt = canvasPoint(e);
      if (!pt) return;
      const dx = pt.x - drag.startX;
      const dy = pt.y - drag.startY;
      updateCanvas((c) => ({
        ...c,
        annotations: drag.snapshot.map((a) => (a.id === drag.id ? moveAnnotation(a, dx, dy) : a)),
      }));
    }
  };

  const finishPointerInteraction = () => {
    if (resizeRef.current || annDragRef.current || pinchRef.current) {
      resizeRef.current = null;
      annDragRef.current = null;
      pinchRef.current = null;
      void flushSave();
    }
    pointersRef.current.clear();
  };

  const handleSelectPointerDown = (e: React.PointerEvent) => {
    if (!isTeacher || tool !== 'select') return;
    if ((e.target as HTMLElement).closest('[data-brainstorm-sticky]')) return;
    if ((e.target as HTMLElement).closest('[data-resize-handle]')) return;
    const pt = canvasPoint(e);
    if (!pt) return;

    if (canvas.backgroundUrl && !canvas.bgLocked) {
      const bx = canvas.bgX;
      const by = canvas.bgY;
      const bw = bgDisplay.w * canvas.bgScale;
      const bh = bgDisplay.h * canvas.bgScale;
      if (pt.x >= bx && pt.x <= bx + bw && pt.y >= by && pt.y <= by + bh) {
        const hitAnn = findAnnotationAt(canvas.annotations, pt.x, pt.y);
        if (!hitAnn) {
          e.stopPropagation();
          setSelectedId(BG_SELECT_ID);
          bgDragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            origX: canvas.bgX,
            origY: canvas.bgY,
          };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          return;
        }
      }
    }

    const hit = findAnnotationAt(canvas.annotations, pt.x, pt.y);
    if (hit) {
      e.stopPropagation();
      setSelectedId(hit.id);
      annDragRef.current = {
        id: hit.id,
        startX: pt.x,
        startY: pt.y,
        snapshot: canvas.annotations,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    setSelectedId(null);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!isTeacher) return;
    if (tool === 'select') {
      handleSelectPointerDown(e);
      return;
    }
    if ((e.target as HTMLElement).closest('[data-brainstorm-sticky]')) return;
    const pt = canvasPoint(e);
    if (!pt) return;

    if (tool === 'text') {
      const text = window.prompt('Textfeld:', 'Text') ?? '';
      if (!text.trim()) return;
      const id = crypto.randomUUID();
      updateCanvas((c) => ({
        ...c,
        annotations: [
          ...c.annotations,
          {
            id,
            kind: 'text',
            x: pt.x,
            y: pt.y,
            text: text.trim(),
            w: 220,
            h: 56,
            fontSize: 16,
            fill: '#ffffff',
            stroke: '#1e293b',
            zIndex: nextZIndex(c.annotations),
          },
        ],
      }));
      setSelectedId(id);
      setTool('select');
      return;
    }

    if (tool === 'arrow') {
      if (!arrowStart) {
        setArrowStart({ x: pt.x, y: pt.y });
        return;
      }
      const id = crypto.randomUUID();
      updateCanvas((c) => ({
        ...c,
        annotations: [
          ...c.annotations,
          {
            id,
            kind: 'arrow',
            x: arrowStart.x,
            y: arrowStart.y,
            x2: pt.x,
            y2: pt.y,
            stroke: '#1e293b',
            zIndex: nextZIndex(c.annotations),
          },
        ],
      }));
      setSelectedId(id);
      setArrowStart(null);
      setTool('select');
      return;
    }

    if (tool === 'rect' || tool === 'circle' || tool === 'highlight') {
      drawRef.current = { kind: tool, startX: pt.x, startY: pt.y };
      setDraft({ x: pt.x, y: pt.y, x2: pt.x, y2: pt.y });
      setSelectedId(null);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  };

  const finishDraw = () => {
    finishPointerInteraction();
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
    const id = crypto.randomUUID();
    updateCanvas((c) => ({
      ...c,
      annotations: [
        ...c.annotations,
        {
          id,
          kind: d.kind,
          x: dr.x,
          y: dr.y,
          w,
          h,
          stroke: '#1e293b',
          fill: d.kind === 'highlight' ? '#facc15' : 'transparent',
          zIndex: nextZIndex(c.annotations),
        },
      ],
    }));
    setSelectedId(id);
    setTool('select');
  };

  const onUpload = async (file: File) => {
    setUploadBusy(true);
    try {
      const oldPath = canvas.backgroundPath;
      const { path, publicUrl } = await uploadBrainstormBackground(sessionId, file);
      updateCanvas((c) => ({
        ...c,
        backgroundPath: path,
        backgroundUrl: publicUrl,
        bgX: 80,
        bgY: 80,
        bgScale: 1,
        bgLocked: false,
      }));
      if (tableReady) await flushSave();
      if (oldPath && oldPath !== path) void removeBrainstormBackgroundFile(oldPath).catch(() => undefined);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploadBusy(false);
    }
  };

  const removeTemplate = async () => {
    if (!window.confirm('Vorlage und Hintergrundbild wirklich entfernen?')) return;
    const path = canvas.backgroundPath;
    updateCanvas(() => defaultBrainstormCanvas(sessionId));
    setSelectedId(null);
    if (tableReady) await flushSave();
    if (path) void removeBrainstormBackgroundFile(path).catch(() => undefined);
  };

  const svgAnnotations = canvas.annotations.filter((a) => a.kind !== 'text');
  const textAnnotations = canvas.annotations.filter((a) => a.kind === 'text');

  const runExport = async (kind: 'png' | 'pdf') => {
    setExportBusy(true);
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

  const renderSelectionHandles = () => {
    if (!isTeacher || tool !== 'select' || !selectedId) return null;
    if (selectedId === BG_SELECT_ID && canvas.backgroundUrl) {
      const w = bgDisplay.w * canvas.bgScale;
      const h = bgDisplay.h * canvas.bgScale;
      return (
        <BrainstormResizeHandles
          left={canvas.bgX}
          top={canvas.bgY}
          width={w}
          height={h}
          onHandlePointerDown={handleResizePointerDown}
        />
      );
    }
    if (!selectedAnnotation) return null;
    if (selectedAnnotation.kind === 'arrow' && selectedAnnotation.x2 != null && selectedAnnotation.y2 != null) {
      return (
        <BrainstormResizeHandles
          left={0}
          top={0}
          width={0}
          height={0}
          arrowMode
          arrowStart={{ x: selectedAnnotation.x, y: selectedAnnotation.y }}
          arrowEnd={{ x: selectedAnnotation.x2, y: selectedAnnotation.y2 }}
          onHandlePointerDown={handleResizePointerDown}
        />
      );
    }
    const box = normalizeAnnotationBox(selectedAnnotation);
    return (
      <BrainstormResizeHandles
        left={box.x}
        top={box.y}
        width={box.w}
        height={box.h}
        onHandlePointerDown={handleResizePointerDown}
      />
    );
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-slate-100">
      {isTeacher && <SaveStatusBadge status={saveStatus} />}

      {isTeacher && (
        <div className="z-50 shrink-0 border-b border-slate-200/80 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur-sm sm:px-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
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
            <ToolbarBtn title="Vorlage hochladen" disabled={uploadBusy} onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title={canvas.bgLocked ? 'Vorlage entsperren' : 'Vorlage sperren'} onClick={() => updateCanvas((c) => ({ ...c, bgLocked: !c.bgLocked }))}>
              {canvas.bgLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </ToolbarBtn>
            <ToolbarBtn title="Verkleinern" onClick={() => updateCanvas((c) => ({ ...c, bgScale: Math.max(0.15, c.bgScale - 0.1) }))} disabled={!canvas.backgroundUrl}>
              <ZoomOut className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Vergrößern" onClick={() => updateCanvas((c) => ({ ...c, bgScale: Math.min(4, c.bgScale + 0.1) }))} disabled={!canvas.backgroundUrl}>
              <ZoomIn className="h-4 w-4" />
            </ToolbarBtn>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" />
            <ToolbarBtn title="Auswahl" active={tool === 'select'} onClick={() => { setTool('select'); setArrowStart(null); }}>
              <MousePointer2 className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Textfeld" active={tool === 'text'} onClick={() => setTool('text')}>
              <Type className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Pfeil" active={tool === 'arrow'} onClick={() => { setTool('arrow'); setArrowStart(null); }}>
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
            {onAddHeading && (
              <ToolbarBtn title="Überschrift" onClick={onAddHeading}>
                <Layers className="h-4 w-4" />
              </ToolbarBtn>
            )}
            <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" />
            <ToolbarBtn title="Vorlage entfernen" onClick={() => void removeTemplate()} disabled={!canvas.backgroundPath}>
              <Trash2 className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="PNG" disabled={exportBusy} onClick={() => void runExport('png')}>
              <FileImage className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="PDF" disabled={exportBusy} onClick={() => void runExport('pdf')}>
              <FileText className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn title="Screenshot" disabled={exportBusy} onClick={() => void runExport('png')}>
              <Download className="h-4 w-4" />
            </ToolbarBtn>
          </div>
          {statusMsg && <p className="mt-1 truncate px-1 text-xs text-amber-800">{statusMsg}</p>}
          {isTeacher && tool === 'select' && selectedId && (
            <div className="mt-2 pb-1">
              <BrainstormElementInspector
                kind={selectedStickyId ? 'sticky' : selectedId === BG_SELECT_ID ? 'background' : 'annotation'}
                annotation={selectedAnnotation}
                onScale={(f) => {
                  if (selectedId === BG_SELECT_ID) {
                    updateCanvas((c) => ({
                      ...c,
                      bgScale: Math.min(4, Math.max(0.15, c.bgScale * f)),
                    }));
                  } else if (selectedStickyId) {
                    const s = stickiesRef.current.find((x) => x.id === selectedStickyId);
                    if (s) stickyHandlers?.onPatchSticky?.(selectedStickyId, { displayScale: Math.min(4, Math.max(0.5, (s.displayScale ?? 1) * f)) });
                  } else if (selectedAnnotation) {
                    patchAnnotation(selectedId, scaleAnnotationFromCenter(selectedAnnotation, f, true));
                  }
                }}
                onRotate={(d) => {
                  if (selectedId === BG_SELECT_ID) {
                    updateCanvas((c) => ({ ...c, bgRotation: ((c.bgRotation ?? 0) + d + 360) % 360 }));
                  } else if (selectedAnnotation) {
                    patchAnnotation(selectedId, rotateAnnotation(selectedAnnotation, d));
                  }
                }}
                onStrokeColor={(hex) => {
                  if (selectedStickyId) stickyHandlers?.onPatchSticky?.(selectedStickyId, { color: hex });
                  else if (selectedAnnotation) patchAnnotation(selectedId, { stroke: hex, color: hex });
                }}
                onFillColor={(hex) => {
                  if (selectedStickyId) stickyHandlers?.onPatchSticky?.(selectedStickyId, { color: hex });
                  else if (selectedAnnotation) patchAnnotation(selectedId, { fill: hex });
                }}
                onOpacity={(v) => {
                  if (selectedAnnotation) patchAnnotation(selectedId, { opacity: v });
                }}
                onFontSize={(px) => {
                  if (selectedAnnotation) patchAnnotation(selectedId, { fontSize: px });
                }}
                onLayer={(dir) => {
                  if (selectedAnnotation) nudgeZ(selectedId, dir);
                }}
                onDuplicate={() => {
                  if (selectedStickyId) stickyHandlers?.onDuplicateSticky?.(selectedStickyId);
                  else if (selectedAnnotation) duplicateAnnotation(selectedAnnotation);
                }}
                onDelete={deleteSelected}
                onEditText={() => {
                  if (!selectedAnnotation || selectedAnnotation.kind !== 'text') return;
                  const t = window.prompt('Text bearbeiten:', selectedAnnotation.text ?? '') ?? '';
                  if (t.trim()) patchAnnotation(selectedId, { text: t.trim() });
                }}
              />
            </div>
          )}
        </div>
      )}

      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto touch-pan-x touch-pan-y">
        <div
          ref={canvasRef}
          data-brainstorm-export-root
          className="relative bg-slate-100"
          style={{
            width: BRAINSTORM_CANVAS_WIDTH,
            height: BRAINSTORM_CANVAS_HEIGHT,
            minWidth: BRAINSTORM_CANVAS_WIDTH,
            minHeight: BRAINSTORM_CANVAS_HEIGHT,
          }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handlePointerMoveGlobal}
          onPointerUp={(e) => {
            bgDragRef.current = null;
            finishDraw();
            try {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
              /* ok */
            }
          }}
          onPointerCancel={(e) => {
            bgDragRef.current = null;
            finishDraw();
            try {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
              /* ok */
            }
          }}
        >
          {canvas.backgroundUrl && (
            <div
              className="pointer-events-none absolute select-none"
              style={{
                left: canvas.bgX,
                top: canvas.bgY,
                zIndex: 1,
                transform: `scale(${canvas.bgScale}) rotate(${canvas.bgRotation ?? 0}deg)`,
                transformOrigin: 'top left',
              }}
            >
              <img
                src={canvas.backgroundUrl}
                alt=""
                draggable={false}
                className={`max-w-none rounded-sm shadow-sm ${selectedId === BG_SELECT_ID ? 'ring-2 ring-blue-500' : ''}`}
                style={{ maxHeight: BRAINSTORM_CANVAS_HEIGHT * 0.95, pointerEvents: 'none' }}
                crossOrigin="anonymous"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setBgDisplay({ w: img.offsetWidth, h: img.offsetHeight });
                }}
              />
            </div>
          )}

          <AnnotationSvgRender items={svgAnnotations} />

          <div className="absolute inset-0" style={{ zIndex: 6 }}>
            {svgAnnotations.map((a) => {
              const box = normalizeAnnotationBox(a);
              const selected = selectedId === a.id;
              return (
                <div
                  key={`hit-${a.id}`}
                  data-brainstorm-annotation={a.id}
                  className={`absolute touch-none ${isTeacher && tool === 'select' ? 'cursor-move' : 'pointer-events-none'}`}
                  style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                  onPointerDown={(e) => {
                    if (tool !== 'select' || !isTeacher) return;
                    e.stopPropagation();
                    setSelectedId(a.id);
                    const pt = canvasPoint(e);
                    if (!pt) return;
                    annDragRef.current = { id: a.id, startX: pt.x, startY: pt.y, snapshot: canvas.annotations };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                >
                  {selected && tool === 'select' && <div className="pointer-events-none absolute inset-0 rounded-sm border-2 border-blue-500/80" />}
                </div>
              );
            })}
            {textAnnotations.map((a) => {
              const box = normalizeAnnotationBox(a);
              const selected = selectedId === a.id;
              return (
                <div
                  key={a.id}
                  data-brainstorm-annotation={a.id}
                  className={`absolute touch-none rounded-lg border bg-white/95 px-3 py-2 text-base font-medium text-slate-900 shadow-sm ${
                    selected ? 'border-blue-500 ring-2 ring-blue-400/50' : 'border-slate-300/80'
                  } ${isTeacher && tool === 'select' ? 'cursor-move' : ''}`}
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.w,
                    minHeight: box.h,
                    fontSize: a.fontSize ?? 16,
                    color: strokeOf(a),
                    backgroundColor: fillOf(a),
                    opacity: a.opacity ?? 1,
                    zIndex: a.zIndex ?? 6,
                  }}
                  contentEditable={isTeacher && tool === 'select' && selected}
                  onDoubleClick={() => {
                    if (!isTeacher) return;
                    const t = window.prompt('Text bearbeiten:', a.text ?? '') ?? '';
                    if (t.trim()) patchAnnotation(a.id, { text: t.trim() });
                  }}
                  suppressContentEditableWarning
                  onBlur={(e) =>
                    patchAnnotation(a.id, { text: (e.currentTarget.textContent ?? '').trim() || 'Text' })
                  }
                  onPointerDown={(e) => {
                    if (tool !== 'select' || !isTeacher) return;
                    e.stopPropagation();
                    setSelectedId(a.id);
                    const pt = canvasPoint(e);
                    if (!pt) return;
                    annDragRef.current = { id: a.id, startX: pt.x, startY: pt.y, snapshot: canvas.annotations };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                >
                  {a.text ?? 'Text'}
                </div>
              );
            })}
          </div>

          {renderSelectionHandles()}

          {draft && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 7 }} aria-hidden>
              <rect
                x={Math.min(draft.x, draft.x2)}
                y={Math.min(draft.y, draft.y2)}
                width={Math.abs(draft.x2 - draft.x)}
                height={Math.abs(draft.y2 - draft.y)}
                fill="none"
                stroke="#1e293b"
                strokeWidth={2}
              />
            </svg>
          )}

          <BrainstormCanvasProvider value={{ tool, selectedId, setSelectedId }}>
            <div className="pointer-events-none absolute inset-0" style={{ zIndex: 10 }}>
              {children}
            </div>
          </BrainstormCanvasProvider>
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
        active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
