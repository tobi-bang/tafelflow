import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  Type,
} from 'lucide-react';
import type { BrainstormAnnotation } from '../../lib/brainstormCanvasTypes';
import { fillOf, strokeOf } from '../../lib/brainstormCanvasTypes';

type SelectionKind = 'annotation' | 'background' | 'sticky';

type Props = {
  kind: SelectionKind;
  annotation?: BrainstormAnnotation | null;
  onScale: (factor: number) => void;
  onRotate: (deltaDeg: number) => void;
  onStrokeColor: (hex: string) => void;
  onFillColor: (hex: string) => void;
  onOpacity: (value: number) => void;
  onFontSize: (px: number) => void;
  onLayer: (dir: 'up' | 'down') => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEditText?: () => void;
};

const SWATCHES = ['#1e293b', '#2563eb', '#dc2626', '#16a34a', '#eab308', '#ffffff', '#facc15', '#f472b6'];

export function BrainstormElementInspector({
  kind,
  annotation,
  onScale,
  onRotate,
  onStrokeColor,
  onFillColor,
  onOpacity,
  onFontSize,
  onLayer,
  onDuplicate,
  onDelete,
  onEditText,
}: Props) {
  const showFill = kind === 'annotation' && annotation && annotation.kind !== 'arrow';
  const showFont = kind === 'annotation' && annotation?.kind === 'text';
  const stroke = annotation ? strokeOf(annotation) : '#1e293b';
  const fill = annotation ? fillOf(annotation) : '#ffffff';

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-2 py-1.5 shadow-md">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Element</span>
      <IconBtn title="Kleiner" onClick={() => onScale(0.9)}>
        <Minus className="h-4 w-4" />
      </IconBtn>
      <IconBtn title="Größer" onClick={() => onScale(1.1)}>
        <Plus className="h-4 w-4" />
      </IconBtn>
      <IconBtn title="Drehen links" onClick={() => onRotate(-15)}>
        <RotateCcw className="h-4 w-4" />
      </IconBtn>
      <IconBtn title="Drehen rechts" onClick={() => onRotate(15)}>
        <RotateCw className="h-4 w-4" />
      </IconBtn>
      {kind !== 'background' && (
        <>
          <IconBtn title="Nach vorn" onClick={() => onLayer('up')}>
            <ArrowUp className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Nach hinten" onClick={() => onLayer('down')}>
            <ArrowDown className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Duplizieren" onClick={onDuplicate}>
            <Copy className="h-4 w-4" />
          </IconBtn>
        </>
      )}
      {showFont && onEditText && (
        <IconBtn title="Text bearbeiten" onClick={onEditText}>
          <Type className="h-4 w-4" />
        </IconBtn>
      )}
      <span className="mx-0.5 h-5 w-px bg-slate-200" />
      <Palette className="h-4 w-4 text-slate-500" aria-hidden />
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          title="Rahmenfarbe"
          className="h-6 w-6 rounded border border-slate-300"
          style={{ backgroundColor: c }}
          onClick={() => onStrokeColor(c)}
        />
      ))}
      <input
        type="color"
        value={stroke.startsWith('#') ? stroke : '#1e293b'}
        onChange={(e) => onStrokeColor(e.target.value)}
        className="h-7 w-9 cursor-pointer rounded border border-slate-200"
        title="Rahmenfarbe"
      />
      {showFill && (
        <input
          type="color"
          value={fill.startsWith('#') ? fill : '#ffffff'}
          onChange={(e) => onFillColor(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border border-slate-200"
          title="Füllfarbe"
        />
      )}
      {kind === 'annotation' && annotation && (
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          Deckkraft
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={annotation.opacity ?? 1}
            onChange={(e) => onOpacity(Number(e.target.value))}
            className="w-16 accent-blue-600"
          />
        </label>
      )}
      {showFont && annotation && (
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          Text
          <input
            type="number"
            min={10}
            max={72}
            value={annotation.fontSize ?? 16}
            onChange={(e) => onFontSize(Number(e.target.value))}
            className="w-12 rounded border border-slate-200 px-1 py-0.5 text-xs"
          />
        </label>
      )}
      <IconBtn title="Löschen" onClick={onDelete} danger>
        <Trash2 className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
        danger
          ? 'border-red-200 text-red-600 hover:bg-red-50'
          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
