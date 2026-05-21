import type { BoardObject } from '../types';

const LS_PREFIX = 'tafelflow-board-v1:';

export type BoardLocalDraft = {
  savedAt: string;
  objects: BoardObject[];
  activePageId: string;
  panOffset: { x: number; y: number };
};

function lsKey(sessionId: string): string {
  return `${LS_PREFIX}${sessionId}`;
}

export function saveBoardLocal(sessionId: string, draft: BoardLocalDraft): void {
  try {
    localStorage.setItem(lsKey(sessionId), JSON.stringify(draft));
  } catch {
    /* quota */
  }
}

export function loadBoardLocal(sessionId: string): BoardLocalDraft | null {
  try {
    const raw = localStorage.getItem(lsKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as BoardLocalDraft;
  } catch {
    return null;
  }
}
