import React, { useRef } from 'react';
import { Grip, Trash2, Lock, Unlock, Square, Users } from 'lucide-react';
import type { BoardModule } from '../../types';
import { ModuleRenderBoundary } from './ModuleRenderBoundary';

interface ModuleWrapperProps {
  module: BoardModule;
  selected: boolean;
  draggable: boolean;
  deletable: boolean;
  lockable?: boolean;
  onToggleLock?: (id: string) => void;
  releasable?: boolean;
  released?: boolean;
  onToggleRelease?: (id: string) => void;
  resizable?: boolean;
  onResize?: (id: string, next: { width: number; height: number }) => void;
  showLockState?: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, next: { x: number; y: number }) => void;
  onDelete?: (id: string) => void;
  children: React.ReactNode;
}

type DragState = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type ResizeState = {
  startX: number;
  startY: number;
  originWidth: number;
  originHeight: number;
};

export default function ModuleWrapper({
  module,
  selected,
  draggable,
  deletable,
  lockable = false,
  onToggleLock,
  releasable = false,
  released = false,
  onToggleRelease,
  resizable = false,
  onResize,
  showLockState = true,
  onSelect,
  onMove,
  onDelete,
  children,
}: ModuleWrapperProps) {
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  return (
    <div
      className={`absolute pointer-events-auto rounded-xl border bg-white shadow-sm overflow-hidden ${
        selected ? 'border-blue-500 shadow-blue-100 ring-1 ring-blue-300/70' : 'border-slate-300'
      }`}
      style={{
        left: module.x,
        top: module.y,
        width: module.width,
        height: module.height,
        zIndex: module.data.zIndex as number | undefined,
      }}
      onPointerDown={() => onSelect(module.id)}
    >
      <div
        className={`h-9 px-3 border-b border-slate-200 flex items-center justify-between gap-2 ${
          draggable && !module.locked ? 'cursor-move bg-slate-50' : 'bg-slate-100/80'
        }`}
        onPointerDown={(e) => {
          if (!draggable || module.locked) return;
          e.preventDefault();
          e.stopPropagation();
          onSelect(module.id);
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            originX: module.x,
            originY: module.y,
          };
          const move = (ev: PointerEvent) => {
            if (!dragRef.current) return;
            const dx = ev.clientX - dragRef.current.startX;
            const dy = ev.clientY - dragRef.current.startY;
            onMove(module.id, {
              x: Math.max(0, dragRef.current.originX + dx),
              y: Math.max(48, dragRef.current.originY + dy),
            });
          };
          const stop = () => {
            dragRef.current = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', stop);
        }}
      >
        <div className="min-w-0 flex items-center gap-2 text-xs font-semibold text-slate-700">
          <Grip className="w-4 h-4 shrink-0" />
          <span className="truncate">{String(module.data.title ?? module.type)}</span>
          {showLockState && module.locked && (
            <span className="inline-flex items-center rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
              Gesperrt
            </span>
          )}
          {showLockState && !module.locked && released && (
            <span className="inline-flex items-center rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
              SuS editierbar
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {lockable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock?.(module.id);
              }}
              className="p-1 rounded hover:bg-slate-200 text-slate-600"
              title={module.locked ? 'Modul entsperren' : 'Modul sperren'}
              aria-label={module.locked ? 'Modul entsperren' : 'Modul sperren'}
            >
              {module.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </button>
          )}
          {deletable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(module.id);
              }}
              className="p-1 rounded hover:bg-rose-50 text-rose-600"
              title="Modul löschen"
              aria-label="Modul löschen"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {releasable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleRelease?.(module.id);
              }}
              className={`p-1 rounded ${released ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'hover:bg-slate-200 text-slate-600'}`}
              title={released ? 'Für SuS freigegeben (klicken zum Entziehen)' : 'Für SuS freigeben'}
              aria-label={released ? 'Für SuS freigegeben (klicken zum Entziehen)' : 'Für SuS freigeben'}
            >
              <Users className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <div className="h-[calc(100%-2.25rem)] overflow-auto p-3">
        <ModuleRenderBoundary>{children}</ModuleRenderBoundary>
      </div>
      {resizable && !module.locked && (
        <button
          type="button"
          className="absolute right-1 bottom-1 w-6 h-6 rounded bg-slate-900 text-white/90 flex items-center justify-center cursor-se-resize"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            resizeRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              originWidth: module.width,
              originHeight: module.height,
            };
            const move = (ev: PointerEvent) => {
              if (!resizeRef.current) return;
              const nextWidth = Math.max(260, resizeRef.current.originWidth + (ev.clientX - resizeRef.current.startX));
              const nextHeight = Math.max(160, resizeRef.current.originHeight + (ev.clientY - resizeRef.current.startY));
              onResize?.(module.id, { width: nextWidth, height: nextHeight });
            };
            const stop = () => {
              resizeRef.current = null;
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', stop);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', stop);
          }}
          title="Modulgröße ändern"
          aria-label="Modulgröße ändern"
        >
          <Square className="w-3 h-3" />
        </button>
      )}
      {/* Erweiterungspunkt: Teacher-/Student-Rechte, Kontextmenü */}
    </div>
  );
}
