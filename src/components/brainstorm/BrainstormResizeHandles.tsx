import React from 'react';
import type { ResizeHandleId } from '../../lib/brainstormCanvasTypes';

const CORNER: ResizeHandleId[] = ['nw', 'ne', 'se', 'sw'];
const EDGE: ResizeHandleId[] = ['n', 'e', 's', 'w'];

const CURSOR: Record<ResizeHandleId, string> = {
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  start: 'crosshair',
  end: 'crosshair',
};

type Props = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Pfeil: nur Start/End-Handles */
  arrowMode?: boolean;
  arrowStart?: { x: number; y: number };
  arrowEnd?: { x: number; y: number };
  onHandlePointerDown: (handle: ResizeHandleId, e: React.PointerEvent) => void;
};

function HandleDot({
  handle,
  style,
  onPointerDown,
}: {
  handle: ResizeHandleId;
  style: React.CSSProperties;
  onPointerDown: (handle: ResizeHandleId, e: React.PointerEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Griff ${handle}`}
      data-resize-handle={handle}
      className="absolute z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow-md touch-none"
      style={{ ...style, cursor: CURSOR[handle] }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onHandlePointerDown(handle, e);
      }}
    />
  );
}

export function BrainstormResizeHandles({
  left,
  top,
  width,
  height,
  arrowMode,
  arrowStart,
  arrowEnd,
  onHandlePointerDown,
}: Props) {
  if (arrowMode && arrowStart && arrowEnd) {
    return (
      <>
        <HandleDot handle="start" style={{ left: arrowStart.x, top: arrowStart.y }} onPointerDown={onHandlePointerDown} />
        <HandleDot handle="end" style={{ left: arrowEnd.x, top: arrowEnd.y }} onPointerDown={onHandlePointerDown} />
      </>
    );
  }

  const positions: Record<ResizeHandleId, React.CSSProperties> = {
    nw: { left, top },
    n: { left: left + width / 2, top },
    ne: { left: left + width, top },
    e: { left: left + width, top: top + height / 2 },
    se: { left: left + width, top: top + height },
    s: { left: left + width / 2, top: top + height },
    sw: { left, top: top + height },
    w: { left, top: top + height / 2 },
    start: { left, top },
    end: { left: left + width, top: top + height },
  };

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 9 }}>
      <div
        className="pointer-events-none absolute rounded-sm border-2 border-blue-500 ring-1 ring-blue-400/40"
        style={{ left, top, width, height }}
      />
      {[...CORNER, ...EDGE].map((h) => (
        <HandleDot key={h} handle={h} style={positions[h]} onPointerDown={onHandlePointerDown} />
      ))}
    </div>
  );
}
