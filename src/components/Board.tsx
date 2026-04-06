import React, { useState, useEffect, useRef, Fragment } from 'react';
import { supabase } from '../lib/supabase';
import { rowToBoardObject } from '../lib/dbMap';
import type { BoardObject, SessionPermissions } from '../types';
import { Trash2, Pencil } from 'lucide-react';

interface BoardProps {
  sessionId: string;
  isTeacher: boolean;
  permissions: SessionPermissions;
  presentationMode?: boolean;
}

export default function Board({
  sessionId,
  isTeacher,
  permissions,
  presentationMode = false,
}: BoardProps) {
  const [objects, setObjects] = useState<BoardObject[]>([]);
  const [tool, setTool] = useState<'pencil' | 'eraser'>('pencil');
  const [color, setColor] = useState('#2563eb');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
  const pathDraftRef = useRef<{ x: number; y: number }[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);

  const canDraw = isTeacher || permissions.drawBoard;

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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'board_objects',
          filter: `session_id=eq.${sessionId}`,
        },
        async () => {
          const { data } = await supabase
            .from('board_objects')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });
          if (data) setObjects(data.map((r) => rowToBoardObject(r as Record<string, unknown>)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!canDraw || tool === 'eraser') return;
    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    pathDraftRef.current = [{ x, y }];
    setCurrentPath(pathDraftRef.current);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const { x, y } = getCoordinates(e);
    pathDraftRef.current = [...pathDraftRef.current, { x, y }];
    setCurrentPath(pathDraftRef.current);
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
        data: pts,
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
    const ids = objects.map((o) => o.id);
    for (const id of ids) {
      await supabase.from('board_objects').delete().eq('id', id);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col">
      <div
        className={`absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200 flex items-center z-10 ${
          presentationMode ? 'p-4 gap-3' : 'p-2 gap-2'
        }`}
      >
        <ToolButton
          active={tool === 'pencil'}
          onClick={() => setTool('pencil')}
          icon={<Pencil className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
          large={presentationMode}
        />
        <ToolButton
          active={tool === 'eraser'}
          onClick={() => setTool('eraser')}
          icon={<Trash2 className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />}
          large={presentationMode}
        />
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <ColorButton color="#2563eb" active={color === '#2563eb'} onClick={() => setColor('#2563eb')} />
        <ColorButton color="#dc2626" active={color === '#dc2626'} onClick={() => setColor('#dc2626')} />
        <ColorButton color="#16a34a" active={color === '#16a34a'} onClick={() => setColor('#16a34a')} />
        <ColorButton color="#000000" active={color === '#000000'} onClick={() => setColor('#000000')} />
        {isTeacher && (
          <>
            <div className="w-px h-6 bg-slate-200 mx-1" />
            <button
              type="button"
              onClick={clearBoard}
              className={`hover:bg-rose-50 text-rose-600 rounded-xl transition-colors ${presentationMode ? 'p-3' : 'p-2'}`}
            >
              <Trash2 className={presentationMode ? 'w-7 h-7' : 'w-5 h-5'} />
            </button>
          </>
        )}
      </div>

      <svg
        ref={svgRef}
        className="w-full h-full touch-none cursor-crosshair"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={endDrawing}
        onMouseLeave={endDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={endDrawing}
      >
        {objects.map((obj) => (
          <Fragment key={obj.id}>
            <BoardPath
              points={obj.data as { x: number; y: number }[]}
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

      {!canDraw && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-rose-500 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg">
          Zeichnen deaktiviert
        </div>
      )}
    </div>
  );
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
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${large ? 'p-4' : 'p-2.5'} rounded-xl transition-all ${active ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      {icon}
    </button>
  );
}

function ColorButton({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-8 h-8 rounded-full border-2 transition-all ${active ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}
      style={{ backgroundColor: color }}
    />
  );
}
