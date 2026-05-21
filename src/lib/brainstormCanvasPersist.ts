import type { BrainstormCanvasState } from './brainstormCanvasTypes';

const LS_PREFIX = 'tafelflow-brainstorm-canvas-v1:';
const IDB_NAME = 'tafelflow-brainstorm';
const IDB_STORE = 'drafts';

export type BrainstormCanvasDraft = {
  savedAt: string;
  state: BrainstormCanvasState;
};

function lsKey(sessionId: string): string {
  return `${LS_PREFIX}${sessionId}`;
}

export function saveBrainstormCanvasLocal(sessionId: string, state: BrainstormCanvasState): void {
  const draft: BrainstormCanvasDraft = { savedAt: new Date().toISOString(), state };
  try {
    localStorage.setItem(lsKey(sessionId), JSON.stringify(draft));
  } catch {
    /* quota */
  }
  void saveBrainstormCanvasIdb(sessionId, draft).catch(() => undefined);
}

export function loadBrainstormCanvasLocal(sessionId: string): BrainstormCanvasDraft | null {
  try {
    const raw = localStorage.getItem(lsKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BrainstormCanvasDraft;
    if (!parsed?.state?.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'sessionId' });
      }
    };
  });
}

async function saveBrainstormCanvasIdb(sessionId: string, draft: BrainstormCanvasDraft): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_STORE).put({ sessionId, ...draft });
  });
  db.close();
}

export async function loadBrainstormCanvasIdb(sessionId: string): Promise<BrainstormCanvasDraft | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openIdb();
    const draft = await new Promise<BrainstormCanvasDraft | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(sessionId);
      req.onsuccess = () => {
        const row = req.result as { savedAt?: string; state?: BrainstormCanvasState } | undefined;
        if (!row?.state) resolve(null);
        else resolve({ savedAt: row.savedAt ?? '', state: row.state });
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
    return draft;
  } catch {
    return null;
  }
}

export function pickNewerBrainstormDraft(
  remote: BrainstormCanvasState,
  local: BrainstormCanvasDraft | null
): BrainstormCanvasState {
  if (!local?.state) return remote;
  const remoteTs = Date.parse(remote.updatedAt);
  const localTs = Date.parse(local.savedAt);
  if (Number.isFinite(localTs) && Number.isFinite(remoteTs) && localTs > remoteTs) {
    return { ...local.state, sessionId: remote.sessionId };
  }
  if (!remote.backgroundPath && !remote.annotations.length && local.state.annotations.length > 0) {
    return { ...local.state, sessionId: remote.sessionId };
  }
  return remote;
}
