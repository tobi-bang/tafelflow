import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BRAINSTORM_CANVAS_MIGRATION_HINT,
  fetchBrainstormCanvas,
  persistBrainstormCanvasState,
} from '../lib/brainstormCanvasDb';
import { BRAINSTORM_AUTOSAVE_MS, defaultBrainstormCanvas, type BrainstormCanvasState } from '../lib/brainstormCanvasTypes';
import {
  loadBrainstormCanvasIdb,
  loadBrainstormCanvasLocal,
  pickNewerBrainstormDraft,
  saveBrainstormCanvasLocal,
} from '../lib/brainstormCanvasPersist';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useBrainstormCanvasPersist(sessionId: string, isTeacher: boolean) {
  const [canvas, setCanvas] = useState<BrainstormCanvasState>(() => defaultBrainstormCanvas(sessionId));
  const [tableReady, setTableReady] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef(canvas);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  canvasRef.current = canvas;

  const flushSave = useCallback(async () => {
    if (!isTeacher || !tableReady) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const state = canvasRef.current;
    saveBrainstormCanvasLocal(sessionId, state);
    setSaveStatus('saving');
    try {
      await persistBrainstormCanvasState(sessionId, state);
      setSaveStatus('saved');
      if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
      savedFlashRef.current = setTimeout(() => setSaveStatus('idle'), 2200);
    } catch (e) {
      setSaveStatus('error');
      setStatusMsg(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    }
  }, [isTeacher, sessionId, tableReady]);

  const scheduleSave = useCallback(
    (next: BrainstormCanvasState | ((prev: BrainstormCanvasState) => BrainstormCanvasState)) => {
      const resolved = typeof next === 'function' ? next(canvasRef.current) : next;
      setCanvas(resolved);
      saveBrainstormCanvasLocal(sessionId, resolved);
      if (!isTeacher || !tableReady) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus('saving');
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, BRAINSTORM_AUTOSAVE_MS);
    },
    [isTeacher, sessionId, tableReady, flushSave]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = loadBrainstormCanvasLocal(sessionId) ?? (await loadBrainstormCanvasIdb(sessionId));
      const { state: remote, tableMissing } = await fetchBrainstormCanvas(sessionId);
      if (cancelled) return;
      setTableReady(!tableMissing);
      const merged = pickNewerBrainstormDraft(remote, local);
      setCanvas(merged);
      if (tableMissing) setStatusMsg(BRAINSTORM_CANVAS_MIGRATION_HINT);
      else if (local && pickNewerBrainstormDraft(remote, local) !== remote) {
        void persistBrainstormCanvasState(sessionId, merged).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushSave();
    };
    const onPageHide = () => void flushSave();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      void flushSave();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
    };
  }, [flushSave]);

  return {
    canvas,
    setCanvas,
    canvasRef,
    tableReady,
    saveStatus,
    statusMsg,
    setStatusMsg,
    scheduleSave,
    flushSave,
  };
}
