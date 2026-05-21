import React, { createContext, useContext } from 'react';
import type { BrainstormCanvasTool } from '../../lib/brainstormCanvasTypes';

export type BrainstormCanvasInteraction = {
  tool: BrainstormCanvasTool;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
};

const Ctx = createContext<BrainstormCanvasInteraction | null>(null);

export function BrainstormCanvasProvider({
  value,
  children,
}: {
  value: BrainstormCanvasInteraction;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrainstormCanvasInteraction(): BrainstormCanvasInteraction | null {
  return useContext(Ctx);
}
