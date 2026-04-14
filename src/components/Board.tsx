import React, { useState, useEffect, useRef, Fragment, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { rowToBoardObject } from '../lib/dbMap';
import type { BoardModule, BoardObject, BoardRole, SessionPermissions } from '../types';
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Hand,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { SessionTabId } from '../lib/sessionToolMeta';
import { moduleRegistry, moduleRegistryList } from '../lib/moduleRegistry';
import { createBoardModule } from '../lib/boardModules';
import ModuleWrapper from './board/ModuleWrapper';
import {
  buildBoardState,
  canStudentEditModuleContent,
  canTeacherManageModule,
  getObjectPageId,
  readBoardModuleFromObject,
} from '../lib/boardState';
import {
  TEXT_MODULE_FONT_STEPS,
  resolveTextModuleFontPx,
  stepTextModuleFontPx,
} from '../lib/boardTextModule';

export type ToolMode = 'select' | 'pen' | 'eraser' | 'pan';

function distSqPointSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    const vx = px - x1;
    const vy = py - y1;
    return vx * vx + vy * vy;
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  const vx = px - nx;
  const vy = py - ny;
  return vx * vx + vy * vy;
}

function minDistSqToPolyline(points: { x: number; y: number }[], px: number, py: number): number {
  if (points.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = distSqPointSegment(px, py, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    if (d < min) min = d;
  }
  return min;
}

/** Nächster freier Standardtitel „Seite n“ (ohne Platzhalter-ID `default`; vermeidet doppelte Nummern). */
function nextDefaultPageTitle(existing: { id: string; title: string }[]): string {
  const realPages = existing.filter((p) => p.id !== 'default');
  let maxN = 0;
  const re = /^Seite\s+(\d+)$/i;
  for (const p of realPages) {
    const m = String(p.title ?? '').trim().match(re);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  if (maxN === 0) return `Seite ${realPages.length + 1}`;
  return `Seite ${maxN + 1}`;
}

interface BoardProps {
  sessionId: string;
  isTeacher: boolean;
  permissions: SessionPermissions;
  presentationMode?: boolean;
  onOpenTool?: (tab: SessionTabId) => void;
  selectModuleId?: string | null;
  onHandledSelectModuleId?: () => void;
}

export default function Board({
  sessionId,
  isTeacher,
  permissions,
  presentationMode = false,
  onOpenTool,
  selectModuleId = null,
  onHandledSelectModuleId,
}: BoardProps) {
  const [objects, setObjects] = useState<BoardObject[]>([]);
  const [toolMode, setToolMode] = useState<ToolMode>('pen');
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [color, setColor] = useState('#2563eb');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string>('default');
  const pathDraftRef = useRef<{ x: number; y: number }[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<{ startClientX: number; startClientY: number; originX: number; originY: number } | null>(
    null
  );
  const isErasingRef = useRef(false);
  const erasedPathIdsRef = useRef<Set<string>>(new Set());
  const pageStripRef = useRef<HTMLDivElement>(null);
  const activePageTabRef = useRef<HTMLButtonElement>(null);
  const activePageTabMobileRef = useRef<HTMLButtonElement>(null);
  const persistTimerRef = useRef<Record<string, number>>({});
  const [isCreatingPage, setIsCreatingPage] = useState(false);
  /** Mobil: Bottom-Sheet „Weitere Werkzeuge“ (Farben, Module, Tafel leeren, Seitenverwaltung) */
  const [mobileBoardSheetOpen, setMobileBoardSheetOpen] = useState(false);

  const canDraw = isTeacher || permissions.drawBoard;
  const boardRole: BoardRole = isTeacher ? 'teacher' : 'student';
  const canManageModules = canTeacherManageModule(boardRole);
  const mobileBoardSheetHasContent = canDraw || isTeacher || canManageModules;
  const snapshot = useMemo(() => buildBoardState(objects, activePageId), [objects, activePageId]);
  const pages = snapshot.pages;
  const modules = snapshot.modules;
  const paths = snapshot.paths;
  const activePageIdx = pages.findIndex((p) => p.id === activePageId);
  const displayPageNum = activePageIdx >= 0 ? activePageIdx + 1 : 1;

  const goToPreviousPage = () => {
    if (activePageIdx <= 0) return;
    const dest = pages[activePageIdx - 1];
    setActivePageId(dest.id);
    if (canManageModules) void publishActivePage(dest.id);
  };

  const goToNextPage = () => {
    if (activePageIdx < 0 || activePageIdx >= pages.length - 1) return;
    const dest = pages[activePageIdx + 1];
    setActivePageId(dest.id);
    if (canManageModules) void publishActivePage(dest.id);
  };

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('board_objects')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (!error && data) setObjects(data.map((r) => rowToBoardObject(r as Record<string, unknown>)));
    };
    load();

    const channel = supabase
      .channel(`board-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'board_objects',
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        const next = rowToBoardObject(payload.new as Record<string, unknown>);
        setObjects((prev) => {
          const existing = prev.find((o) => o.id === next.id);
          if (existing) return prev.map((o) => (o.id === next.id ? next : o));
          return [...prev, next];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'board_objects',
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        const next = rowToBoardObject(payload.new as Record<string, unknown>);
        setObjects((prev) => {
          if (!prev.some((o) => o.id === next.id)) return [...prev, next];
          return prev.map((o) => (o.id === next.id ? next : o));
        });
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'board_objects',
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        const oldRow = payload.old as Record<string, unknown>;
        const oldId = String(oldRow?.id ?? '');
        if (!oldId) return;
        setObjects((prev) => prev.filter((o) => o.id !== oldId));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  useEffect(() => {
    if (pages.some((p) => p.id === activePageId)) return;
    setActivePageId(pages[0]?.id ?? 'default');
  }, [pages, activePageId]);

  useEffect(() => {
    const opts: ScrollIntoViewOptions = {
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    };
    activePageTabRef.current?.scrollIntoView(opts);
    activePageTabMobileRef.current?.scrollIntoView(opts);
  }, [activePageId, pages]);

  useEffect(() => {
    if (pages.length > 0) return;
    if (!canManageModules) return;
    void createPage('Seite 1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageModules, sessionId]);

  useEffect(() => {
    if (canDraw) return;
    if (toolMode === 'pen' || toolMode === 'eraser') setToolMode('select');
  }, [canDraw, toolMode]);

  useEffect(() => {
    if (!mobileBoardSheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileBoardSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileBoardSheetOpen]);

  const publishActivePage = async (pageId: string) => {
    if (!canManageModules) return;
    const existingMeta = objects.find((o) => {
      if (o.type !== 'board_meta') return false;
      const data = o.data as Record<string, unknown>;
      return data?.kind === 'board_session';
    });
    if (existingMeta) {
      const current = existingMeta.data as Record<string, unknown>;
      const nextData = { ...current, kind: 'board_session', activePageId: pageId };
      const { error } = await supabase.from('board_objects').update({ data: nextData }).eq('id', existingMeta.id);
      if (error) console.error(error);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('board_objects').insert({
      session_id: sessionId,
      type: 'board_meta',
      data: { kind: 'board_session', activePageId: pageId },
      color: '#64748b',
      author_id: user.id,
    });
    if (error) console.error(error);
  };

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = 'touches' in e && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const eraseAtPoint = async (x: number, y: number) => {
    if (!canDraw) return;
    const strokeW = presentationMode ? 6 : 3;
    const pad = 12;
    const thrSq = (strokeW + pad) * (strokeW + pad);
    const candidates = paths.filter((p) => minDistSqToPolyline(p.points, x, y) <= thrSq);
    const newHits = candidates.filter((p) => !erasedPathIdsRef.current.has(p.id));
    if (newHits.length === 0) return;
    for (const p of newHits) erasedPathIdsRef.current.add(p.id);
    const ids = newHits.map((p) => p.id);
    setObjects((prev) => prev.filter((o) => !ids.includes(o.id)));
    for (const id of ids) {
      const { error } = await supabase.from('board_objects').delete().eq('id', id);
      if (error) console.error(error);
    }
  };

  const draw = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing) return;
    const { x, y } = getCoordinates(e);
    pathDraftRef.current = [...pathDraftRef.current, { x, y }];
    setCurrentPath(pathDraftRef.current);
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (toolMode === 'pan') {
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      panDragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        originX: panOffset.x,
        originY: panOffset.y,
      };
      setIsPanning(true);
      return;
    }
    if (toolMode === 'select') {
      setSelectedModuleId(null);
      return;
    }
    if (!canDraw) return;
    if (toolMode === 'pen') {
      setIsDrawing(true);
      const { x, y } = getCoordinates(e);
      pathDraftRef.current = [{ x, y }];
      setCurrentPath(pathDraftRef.current);
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      return;
    }
    if (toolMode === 'eraser') {
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      isErasingRef.current = true;
      erasedPathIdsRef.current.clear();
      const { x, y } = getCoordinates(e);
      void eraseAtPoint(x, y);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (toolMode === 'pan' && panDragRef.current) {
      const dx = e.clientX - panDragRef.current.startClientX;
      const dy = e.clientY - panDragRef.current.startClientY;
      setPanOffset({
        x: panDragRef.current.originX + dx,
        y: panDragRef.current.originY + dy,
      });
      return;
    }
    if (toolMode === 'pen' && isDrawing) {
      draw(e);
      return;
    }
    if (toolMode === 'eraser' && isErasingRef.current) {
      const { x, y } = getCoordinates(e);
      void eraseAtPoint(x, y);
    }
  };

  const releaseSvgPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
    } catch {
      /* bereits freigegeben */
    }
  };

  const handleSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (toolMode === 'pan') {
      panDragRef.current = null;
      setIsPanning(false);
      releaseSvgPointer(e);
      return;
    }
    if (toolMode === 'pen') {
      releaseSvgPointer(e);
      void endDrawing();
      return;
    }
    if (toolMode === 'eraser') {
      isErasingRef.current = false;
      erasedPathIdsRef.current.clear();
      releaseSvgPointer(e);
    }
  };

  const handleSvgPointerLeave = (e: React.PointerEvent<SVGSVGElement>) => {
    if (toolMode !== 'pan') return;
    panDragRef.current = null;
    setIsPanning(false);
    releaseSvgPointer(e);
  };

  const endDrawing = async () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const pts = pathDraftRef.current;
    if (pts.length < 2) {
      pathDraftRef.current = [];
      setCurrentPath([]);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      const { error } = await supabase.from('board_objects').insert({
        session_id: sessionId,
        type: 'path',
        data: { points: pts, pageId: activePageId },
        color,
        author_id: user.id,
      });
      if (error) console.error(error);
      pathDraftRef.current = [];
      setCurrentPath([]);
    } catch (error) {
      console.error('Failed to save path:', error);
    }
  };

  const clearBoard = async () => {
    if (!isTeacher) return;
    if (!confirm('Ganze Tafel löschen?')) return;
    const ids = objects
      .filter((o) => {
        if (o.type === 'board_page' || o.type === 'board_meta') return false;
        return getObjectPageId(o) === activePageId;
      })
      .map((o) => o.id);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const prevSnapshot = objects;
    Object.keys(persistTimerRef.current).forEach((id) => {
      if (idSet.has(id) && persistTimerRef.current[id]) {
        window.clearTimeout(persistTimerRef.current[id]);
        delete persistTimerRef.current[id];
      }
    });
    setObjects((list) => list.filter((o) => !idSet.has(o.id)));
    setSelectedModuleId(null);
    pathDraftRef.current = [];
    setCurrentPath([]);
    setIsDrawing(false);
    const { error } = await supabase.from('board_objects').delete().in('id', ids);
    if (error) {
      console.error(error);
      setObjects(prevSnapshot);
      alert('Tafelinhalt konnte nicht gelöscht werden. Bitte erneut versuchen oder Seite neu laden.');
    }
  };

  const saveModule = async (id: string, patch: Partial<BoardModule>) => {
    const current = modules.find((m) => m.id === id);
    if (!current) return;
    const canStudentEditContent = canStudentEditModuleContent(boardRole, current);
    const patchTouchesLayout =
      patch.x !== undefined ||
      patch.y !== undefined ||
      patch.width !== undefined ||
      patch.height !== undefined ||
      patch.locked !== undefined;
    if (!canManageModules && (patchTouchesLayout || !canStudentEditContent)) return;
    const next: BoardModule = {
      ...current,
      ...patch,
      data: { ...current.data, ...(patch.data ?? {}) },
    };
    setObjects((list) =>
      list.map((o) => (o.id === id ? { ...o, data: next as unknown as BoardObject['data'] } : o))
    );
    if (persistTimerRef.current[id]) window.clearTimeout(persistTimerRef.current[id]);
    persistTimerRef.current[id] = window.setTimeout(async () => {
      const { error } = await supabase.from('board_objects').update({ data: next }).eq('id', id);
      if (error) console.error(error);
    }, 140);
  };

  const createModule = async (type: string) => {
    if (!canManageModules) return;
    try {
      const id = await createBoardModule(sessionId, type, activePageId);
      setSelectedModuleId(id);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Modul konnte nicht erstellt werden.');
    }
  };

  const bringToFront = (id: string) => {
    const top = modules.reduce((max, m) => Math.max(max, m.data.zIndex ?? 1), 1) + 1;
    void saveModule(id, { data: { zIndex: top } });
  };

  const deleteModule = async (id: string) => {
    if (!canManageModules) return;
    setObjects((list) => list.filter((o) => o.id !== id));
    const { error } = await supabase.from('board_objects').delete().eq('id', id);
    if (error) console.error(error);
    if (selectedModuleId === id) setSelectedModuleId(null);
  };

  useEffect(() => {
    if (!selectModuleId) return;
    const exists = modules.some((m) => m.id === selectModuleId);
    if (!exists) return;
    setSelectedModuleId(selectModuleId);
    bringToFront(selectModuleId);
    onHandledSelectModuleId?.();
  }, [selectModuleId, modules, onHandledSelectModuleId]);

  const createPage = async (title: string) => {
    if (isCreatingPage) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setIsCreatingPage(true);
    try {
      const newId = crypto.randomUUID();
      const order = pages.reduce((max, p) => Math.max(max, p.order), 0) + 1;
      const { error } = await supabase.from('board_objects').insert({
        session_id: sessionId,
        type: 'board_page',
        data: { id: newId, title, order },
        color: '#0f172a',
        author_id: user.id,
      });
      if (error) {
        console.error(error);
        return;
      }
      setActivePageId(newId);
      await publishActivePage(newId);
    } finally {
      setIsCreatingPage(false);
    }
  };

  const renamePage = async (pageId: string) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    const nextTitle = prompt('Seitentitel', page.title)?.trim();
    if (!nextTitle) return;
    const target = objects.find((o) => o.type === 'board_page' && String((o.data as Record<string, unknown>).id ?? '') === pageId);
    if (!target) return;
    const { error } = await supabase
      .from('board_objects')
      .update({ data: { ...(target.data as Record<string, unknown>), title: nextTitle } })
      .eq('id', target.id);
    if (error) console.error(error);
  };

  const duplicatePage = async (pageId: string) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const newPageId = crypto.randomUUID();
    const newTitle = `${page.title} (Kopie)`;
    const order = pages.reduce((max, p) => Math.max(max, p.order), 0) + 1;
    const pageInsert = await supabase.from('board_objects').insert({
      session_id: sessionId,
      type: 'board_page',
      data: { id: newPageId, title: newTitle, order },
      color: '#0f172a',
      author_id: user.id,
    });
    if (pageInsert.error) {
      console.error(pageInsert.error);
      return;
    }
    const sourceObjects = objects.filter((o) => getObjectPageId(o) === pageId && o.type !== 'board_page');
    const rows = sourceObjects.map((o) => {
      if (o.type === 'module') {
        const m = readBoardModuleFromObject(o);
        return {
          session_id: sessionId,
          type: 'module',
          color: o.color,
          author_id: user.id,
          data: {
            ...(m as BoardModule),
            id: '',
            x: (m?.x ?? 80) + 20,
            y: (m?.y ?? 80) + 20,
            data: { ...(m?.data ?? {}), pageId: newPageId, zIndex: Number((m?.data?.zIndex as number | undefined) ?? 1) + 1 },
          },
        };
      }
      const d = o.data as Record<string, unknown>;
      const points = Array.isArray(d) ? d : ((d.points as unknown[]) ?? []);
      return {
        session_id: sessionId,
        type: 'path',
        color: o.color,
        author_id: user.id,
        data: { points, pageId: newPageId },
      };
    });
    if (rows.length > 0) {
      const insertRes = await supabase.from('board_objects').insert(rows);
      if (insertRes.error) console.error(insertRes.error);
    }
    setActivePageId(newPageId);
    await publishActivePage(newPageId);
  };

  const deletePage = async (pageId: string) => {
    if (pages.length <= 1) {
      alert('Mindestens eine Seite muss bestehen bleiben.');
      return;
    }
    if (!confirm('Seite mit allen Modulen/Zeichnungen löschen?')) return;
    const ids = objects
      .filter((o) => getObjectPageId(o) === pageId || (o.type === 'board_page' && String((o.data as Record<string, unknown>).id ?? '') === pageId))
      .map((o) => o.id);
    if (ids.length > 0) {
      const { error } = await supabase.from('board_objects').delete().in('id', ids);
      if (error) console.error(error);
    }
    const fallback = pages.find((p) => p.id !== pageId);
    if (fallback) {
      setActivePageId(fallback.id);
      await publishActivePage(fallback.id);
    }
  };

  return (
    <div ref={boardRef} className="relative h-full min-h-0 w-full flex flex-col bg-white">
      {/* Desktop: Werkzeugleiste */}
      <div
        className={`pointer-events-auto absolute left-1/2 top-4 z-30 hidden -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white/90 shadow-xl backdrop-blur-md md:flex ${
          presentationMode ? 'gap-3 p-4' : 'gap-2 p-2'
        }`}
      >
        <ToolButton
          active={toolMode === 'select'}
          onClick={() => setToolMode('select')}
          title="Auswahl"
          aria-label="Auswahlmodus"
          icon={<MousePointer2 className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
          large={presentationMode}
        />
        <ToolButton
          active={toolMode === 'pen'}
          onClick={() => canDraw && setToolMode('pen')}
          title={canDraw ? 'Stift' : 'Zeichnen ist deaktiviert'}
          aria-label="Stift"
          disabled={!canDraw}
          icon={<Pencil className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
          large={presentationMode}
        />
        <ToolButton
          active={toolMode === 'eraser'}
          onClick={() => canDraw && setToolMode('eraser')}
          title={canDraw ? 'Radierer' : 'Radieren ist deaktiviert'}
          aria-label="Radierer"
          disabled={!canDraw}
          icon={<Eraser className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
          large={presentationMode}
        />
        <ToolButton
          active={toolMode === 'pan'}
          onClick={() => setToolMode('pan')}
          title="Hand (Verschieben)"
          aria-label="Handmodus"
          icon={<Hand className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
          large={presentationMode}
        />
        {toolMode === 'pen' && canDraw && (
          <>
            <div className="mx-1 h-6 w-px bg-slate-200" />
            <ColorButton color="#2563eb" active={color === '#2563eb'} onClick={() => setColor('#2563eb')} />
            <ColorButton color="#dc2626" active={color === '#dc2626'} onClick={() => setColor('#dc2626')} />
            <ColorButton color="#16a34a" active={color === '#16a34a'} onClick={() => setColor('#16a34a')} />
            <ColorButton color="#000000" active={color === '#000000'} onClick={() => setColor('#000000')} />
          </>
        )}
        {isTeacher && (
          <>
            <div className="mx-1 h-6 w-px bg-slate-200" />
            <button
              type="button"
              onClick={clearBoard}
              className={`inline-flex shrink-0 items-center justify-center rounded-xl text-rose-600 transition-colors hover:bg-rose-50 ${
                presentationMode ? 'p-3' : 'p-2'
              }`}
              title="Tafelinhalt löschen"
              aria-label="Tafelinhalt löschen"
            >
              <Trash2 className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />
            </button>
          </>
        )}
        {canManageModules && (
          <>
            <div className="mx-1 h-6 w-px bg-slate-200" />
            {moduleRegistryList.map((definition) => (
              <button
                key={definition.type}
                type="button"
                onClick={() => void createModule(definition.type)}
                className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-200"
                title={`${definition.title} hinzufügen`}
                aria-label={`${definition.title} hinzufügen`}
              >
                {definition.addLabel}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Desktop: Seitenleiste */}
      <div className="pointer-events-auto absolute left-1/2 top-20 z-30 hidden max-w-[96vw] -translate-x-1/2 flex-nowrap items-center gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white/95 py-2 pl-2 pr-3 shadow-md md:flex">
        <button
          type="button"
          className="inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Vorherige Seite"
          disabled={pages.length < 2 || activePageIdx <= 0}
          onClick={goToPreviousPage}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div
          className="min-w-[2.75rem] shrink-0 text-center text-xs font-bold tabular-nums text-slate-600"
          aria-live="polite"
          title="Aktuelle Seite (Position / Gesamt)"
        >
          {pages.length > 0 ? `${displayPageNum}/${pages.length}` : '–'}
        </div>
        <div
          ref={pageStripRef}
          role="tablist"
          aria-label="Tafelseiten"
          className="flex min-w-0 max-w-[min(60vw,36rem)] flex-1 items-center gap-1 overflow-x-auto scroll-smooth py-0.5 [scrollbar-width:thin]"
        >
          {pages.map((p, tabIndex) => {
            const isActive = p.id === activePageId;
            return (
              <button
                key={p.id}
                ref={isActive ? activePageTabRef : undefined}
                type="button"
                role="tab"
                aria-selected={isActive ? 'true' : 'false'}
                aria-current={isActive ? 'page' : undefined}
                aria-label={`${p.title} (${tabIndex + 1} von ${pages.length})`}
                onClick={() => {
                  setActivePageId(p.id);
                  if (canManageModules) void publishActivePage(p.id);
                }}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-400/60'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p.title}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Nächste Seite"
          disabled={pages.length < 2 || activePageIdx < 0 || activePageIdx >= pages.length - 1}
          onClick={goToNextPage}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        {canManageModules && (
          <div className="ml-1 flex max-w-none flex-wrap items-center gap-1 overflow-visible border-slate-200 pl-2">
            <button
              type="button"
              disabled={isCreatingPage}
              onClick={() => void createPage(nextDefaultPageTitle(pages))}
              className="shrink-0 rounded-lg bg-emerald-100 px-2 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-200 disabled:opacity-50"
            >
              + Seite
            </button>
            <button
              type="button"
              onClick={() => void renamePage(activePageId)}
              className="shrink-0 rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              Umbenennen
            </button>
            <button
              type="button"
              onClick={() => void duplicatePage(activePageId)}
              className="shrink-0 rounded-lg bg-amber-100 px-2 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200"
            >
              Duplizieren
            </button>
            <button
              type="button"
              onClick={() => void deletePage(activePageId)}
              className="shrink-0 rounded-lg bg-rose-100 px-2 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-200"
            >
              Löschen
            </button>
          </div>
        )}
      </div>

      {/* Mobil: kompakte Seitenzeile oben (Navigation + Tabs) */}
      <div className="pointer-events-auto absolute left-0 right-0 top-0 z-30 flex h-11 items-center gap-0.5 border-b border-slate-200 bg-white/98 px-1 shadow-sm md:hidden">
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Vorherige Seite"
          disabled={pages.length < 2 || activePageIdx <= 0}
          onClick={goToPreviousPage}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div
          className="min-w-[2.5rem] shrink-0 text-center text-[11px] font-bold tabular-nums leading-none text-slate-600"
          aria-live="polite"
          title="Seite"
        >
          {pages.length > 0 ? (
            <>
              <span className="text-sm text-slate-900">{displayPageNum}</span>
              <span className="text-slate-400">/{pages.length}</span>
            </>
          ) : (
            '–'
          )}
        </div>
        <div
          role="tablist"
          aria-label="Tafelseiten"
          className="scrollbar-none flex min-w-0 flex-1 touch-pan-x items-center gap-0.5 overflow-x-auto scroll-smooth py-0.5"
        >
          {pages.map((p, tabIndex) => {
            const isActive = p.id === activePageId;
            return (
              <button
                key={p.id}
                ref={isActive ? activePageTabMobileRef : undefined}
                type="button"
                role="tab"
                aria-selected={isActive ? 'true' : 'false'}
                aria-current={isActive ? 'page' : undefined}
                aria-label={`${p.title} (${tabIndex + 1} von ${pages.length})`}
                onClick={() => {
                  setActivePageId(p.id);
                  if (canManageModules) void publishActivePage(p.id);
                }}
                className={`max-w-[5.5rem] shrink-0 truncate rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/50'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p.title}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Nächste Seite"
          disabled={pages.length < 2 || activePageIdx < 0 || activePageIdx >= pages.length - 1}
          onClick={goToNextPage}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Mobil: feste Werkzeug-Dock unten */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/98 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-6px_24px_rgba(0,0,0,0.08)] md:hidden"
        aria-label="Tafelwerkzeuge (mobil)"
      >
        <div className="flex items-center justify-around px-0.5">
          <ToolButton
            active={toolMode === 'select'}
            onClick={() => setToolMode('select')}
            title="Auswahl"
            aria-label="Auswahlmodus"
            icon={<MousePointer2 className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
            large={presentationMode}
            dock
          />
          <ToolButton
            active={toolMode === 'pen'}
            onClick={() => canDraw && setToolMode('pen')}
            title={canDraw ? 'Stift' : 'Zeichnen ist deaktiviert'}
            aria-label="Stift"
            disabled={!canDraw}
            icon={<Pencil className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
            large={presentationMode}
            dock
          />
          <ToolButton
            active={toolMode === 'eraser'}
            onClick={() => canDraw && setToolMode('eraser')}
            title={canDraw ? 'Radierer' : 'Radieren ist deaktiviert'}
            aria-label="Radierer"
            disabled={!canDraw}
            icon={<Eraser className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
            large={presentationMode}
            dock
          />
          <ToolButton
            active={toolMode === 'pan'}
            onClick={() => setToolMode('pan')}
            title="Hand"
            aria-label="Handmodus"
            icon={<Hand className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
            large={presentationMode}
            dock
          />
          {mobileBoardSheetHasContent && (
            <button
              type="button"
              className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 active:bg-slate-200"
              aria-label="Weitere Werkzeuge, Farben und Module"
              title="Mehr"
              onClick={() => setMobileBoardSheetOpen(true)}
            >
              <MoreHorizontal className="h-6 w-6" />
            </button>
          )}
        </div>
      </nav>

      {/* Mobil: Bottom-Sheet (Farben, Module, Leeren, Seitenverwaltung) */}
      {mobileBoardSheetOpen && (
        <div className="md:hidden" role="presentation">
          <button
            type="button"
            className="fixed inset-0 z-50 cursor-default bg-slate-900/45"
            aria-label="Menü schließen"
            onClick={() => setMobileBoardSheetOpen(false)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-[60] flex max-h-[min(72dvh,26rem)] flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-board-sheet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h2 id="mobile-board-sheet-title" className="text-sm font-bold text-slate-900">
                Weitere Optionen
              </h2>
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
                onClick={() => setMobileBoardSheetOpen(false)}
              >
                Fertig
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {canDraw && (
                <section>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Stiftfarbe</p>
                  <div className="grid grid-cols-4 gap-2">
                    {(
                      [
                        ['#2563eb', 'Blau'],
                        ['#dc2626', 'Rot'],
                        ['#16a34a', 'Grün'],
                        ['#000000', 'Schwarz'],
                      ] as const
                    ).map(([c, name]) => (
                      <ColorButton
                        key={c}
                        color={c}
                        active={color === c}
                        onClick={() => {
                          setColor(c);
                          setToolMode('pen');
                          setMobileBoardSheetOpen(false);
                        }}
                        label={name}
                      />
                    ))}
                  </div>
                </section>
              )}
              {isTeacher && (
                <section>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Tafel</p>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                    onClick={() => {
                      setMobileBoardSheetOpen(false);
                      void clearBoard();
                    }}
                  >
                    <Trash2 className="h-5 w-5 shrink-0" />
                    Tafelinhalt löschen
                  </button>
                </section>
              )}
              {canManageModules && (
                <>
                  <section>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Module</p>
                    <div className="grid grid-cols-2 gap-2">
                      {moduleRegistryList.map((definition) => (
                        <button
                          key={definition.type}
                          type="button"
                          className="min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-semibold text-slate-800 hover:bg-slate-100 active:bg-slate-200"
                          onClick={() => {
                            setMobileBoardSheetOpen(false);
                            void createModule(definition.type);
                          }}
                        >
                          {definition.addLabel}
                        </button>
                      ))}
                    </div>
                  </section>
                  <section>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Seiten</p>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={isCreatingPage}
                        className="min-h-12 w-full rounded-xl bg-emerald-100 px-3 text-sm font-semibold text-emerald-900 hover:bg-emerald-200 disabled:opacity-50"
                        onClick={() => {
                          setMobileBoardSheetOpen(false);
                          void createPage(nextDefaultPageTitle(pages));
                        }}
                      >
                        + Neue Seite
                      </button>
                      <button
                        type="button"
                        className="min-h-12 w-full rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-200"
                        onClick={() => {
                          setMobileBoardSheetOpen(false);
                          void renamePage(activePageId);
                        }}
                      >
                        Seite umbenennen
                      </button>
                      <button
                        type="button"
                        className="min-h-12 w-full rounded-xl bg-amber-100 px-3 text-sm font-semibold text-amber-950 hover:bg-amber-200"
                        onClick={() => {
                          setMobileBoardSheetOpen(false);
                          void duplicatePage(activePageId);
                        }}
                      >
                        Seite duplizieren
                      </button>
                      <button
                        type="button"
                        className="min-h-12 w-full rounded-xl bg-rose-100 px-3 text-sm font-semibold text-rose-900 hover:bg-rose-200"
                        onClick={() => {
                          setMobileBoardSheetOpen(false);
                          void deletePage(activePageId);
                        }}
                      >
                        Seite löschen
                      </button>
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div
        data-board-export-root
        className="absolute left-0 right-0 top-0 z-0 overflow-hidden touch-none max-md:top-11 max-md:bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:inset-0"
      >
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
          }}
        >
          <svg
            ref={svgRef}
            className={`pointer-events-auto absolute inset-0 z-0 h-full w-full touch-none ${
              toolMode === 'pen'
                ? 'cursor-crosshair'
                : toolMode === 'eraser'
                  ? 'cursor-cell'
                  : toolMode === 'pan'
                    ? isPanning
                      ? 'cursor-grabbing'
                      : 'cursor-grab'
                    : 'cursor-default'
            }`}
            onPointerDown={handleSvgPointerDown}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onPointerCancel={handleSvgPointerUp}
            onPointerLeave={handleSvgPointerLeave}
          >
            {paths.map((obj) => (
              <Fragment key={obj.id}>
                <BoardPath
                  points={obj.points}
                  color={obj.color}
                  strokeWidth={presentationMode ? 6 : 3}
                />
              </Fragment>
            ))}
            {isDrawing && (
              <BoardPath
                points={currentPath}
                color={color}
                isPreview
                strokeWidth={presentationMode ? 6 : 3}
              />
            )}
          </svg>

          <div className="pointer-events-none absolute inset-0 z-10">
        {modules.map((module) => (
          <Fragment key={module.id}>
          <ModuleWrapper
            module={module}
            pointerEventsEnabled={toolMode !== 'pan'}
            selected={selectedModuleId === module.id}
            draggable={canManageModules}
            deletable={canManageModules}
            lockable={canManageModules}
            releasable={canManageModules}
            released={module.data.editableByStudents === true}
            resizable={canManageModules}
            onSelect={(id) => {
              setSelectedModuleId(id);
              bringToFront(id);
            }}
            onMove={(id, next) => {
              void saveModule(id, next);
            }}
            onResize={(id, next) => {
              void saveModule(id, next);
            }}
            onToggleLock={(id) => {
              const current = modules.find((m) => m.id === id);
              if (!current) return;
              void saveModule(id, { locked: !current.locked });
            }}
            onToggleRelease={(id) => {
              const current = modules.find((m) => m.id === id);
              if (!current) return;
              const nextReleased = !(current.data.editableByStudents === true);
              void saveModule(id, {
                data: { editableByStudents: nextReleased },
              });
            }}
            onDelete={(id) => {
              void deleteModule(id);
            }}
          >
            {renderModuleContent(
              module,
              onOpenTool,
              (patch) => void saveModule(module.id, patch),
              canManageModules ||
                canStudentEditModuleContent(boardRole, module)
            )}
          </ModuleWrapper>
          </Fragment>
        ))}
          </div>
        </div>
      </div>

      {!canDraw && (
        <div className="absolute bottom-4 left-1/2 z-20 max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] -translate-x-1/2 rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow-lg">
          Zeichnen deaktiviert
        </div>
      )}
    </div>
  );
}

function renderModuleContent(
  module: BoardModule,
  onOpenTool: ((tab: SessionTabId) => void) | undefined,
  onPatch: (patch: Partial<BoardModule>) => void,
  editable: boolean
) {
  const definition = moduleRegistry[module.type];
  if (!definition) {
    return (
      <div className="h-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Unbekannter Modultyp <code>{module.type}</code>. Bitte in `moduleRegistry.tsx` registrieren.
      </div>
    );
  }
  if (module.type === 'text') {
    const fontPx = resolveTextModuleFontPx(module.data.textFontSizePx);
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {editable && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Schrift</span>
            <div className="flex items-center rounded-lg border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                className="rounded-l-md px-2 py-1 text-lg font-semibold leading-none text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Schrift kleiner"
                disabled={fontPx <= TEXT_MODULE_FONT_STEPS[0]}
                onClick={() =>
                  onPatch({ data: { textFontSizePx: stepTextModuleFontPx(module.data.textFontSizePx, -1) } })
                }
              >
                −
              </button>
              <select
                value={fontPx}
                onChange={(e) => onPatch({ data: { textFontSizePx: Number(e.target.value) } })}
                className="max-h-8 border-0 border-x border-slate-200 bg-slate-50/80 py-1 text-center text-xs font-semibold text-slate-800 focus:ring-0"
                aria-label="Schriftgröße"
                title="Schriftgröße"
              >
                {TEXT_MODULE_FONT_STEPS.map((px) => (
                  <option key={px} value={px}>
                    {px}px
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-r-md px-2 py-1 text-lg font-semibold leading-none text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Schrift größer"
                disabled={fontPx >= TEXT_MODULE_FONT_STEPS[TEXT_MODULE_FONT_STEPS.length - 1]}
                onClick={() =>
                  onPatch({ data: { textFontSizePx: stepTextModuleFontPx(module.data.textFontSizePx, 1) } })
                }
              >
                +
              </button>
            </div>
          </div>
        )}
        <textarea
          value={String(module.data.text ?? '')}
          onChange={(e) => onPatch({ data: { text: e.target.value } })}
          placeholder="Notizen für die gemeinsame Tafel ..."
          style={{ fontSize: `${fontPx}px`, lineHeight: 1.45 }}
          className="w-full min-h-0 flex-1 resize-none outline-none bg-transparent text-slate-700"
          readOnly={!editable}
        />
      </div>
    );
  }
  return <>{definition.render({ module, onOpenTool })}</>;
}

function BoardPath({
  points,
  color,
  isPreview,
  strokeWidth = 3,
}: {
  points: { x: number; y: number }[];
  color: string;
  isPreview?: boolean;
  strokeWidth?: number;
}) {
  if (points.length < 2) return null;
  const d = `M ${points[0].x} ${points[0].y} ${points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')}`;
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={isPreview ? 0.5 : 1}
    />
  );
}

function ToolButton({
  active,
  onClick,
  icon,
  large,
  dock,
  title,
  'aria-label': ariaLabel,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  large?: boolean;
  /** Mobil-Dock: immer große Touch-Ziele */
  dock?: boolean;
  title?: string;
  'aria-label'?: string;
  disabled?: boolean;
}) {
  const touchMin = dock ? 'min-h-12 min-w-12' : 'max-md:min-h-[44px] max-md:min-w-[44px] md:min-h-0 md:min-w-0';
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel ?? title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl transition-all ${touchMin} ${
        large ? 'p-4' : dock ? 'p-2.5' : 'p-2.5'
      } ${
        disabled ? 'cursor-not-allowed opacity-40 text-slate-400' : active ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {icon}
    </button>
  );
}

function ColorButton({
  color,
  active,
  onClick,
  label,
}: {
  color: string;
  active: boolean;
  onClick: () => void;
  /** Kurzname für Barrierefreiheit (z. B. „Blau“) */
  label?: string;
}) {
  const aria = label ? `Farbe ${label}` : `Farbe ${color}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 w-10 shrink-0 rounded-full border-2 transition-all max-md:min-h-[44px] max-md:min-w-[44px] md:h-8 md:w-8 ${active ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}
      style={{ backgroundColor: color }}
      title={aria}
      aria-label={aria}
    />
  );
}
