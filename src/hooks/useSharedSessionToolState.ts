import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Synchronisiert Tool-State pro Sitzung zwischen Browser-Tabs (gleiche Origin) via
 * localStorage + BroadcastChannel. Ohne Backend – andere Geräte sehen keine automatische Sync.
 */
export function useSharedSessionToolState<T>(
  sessionId: string,
  toolKey: string,
  initial: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = `tafelflow-tool-${toolKey}-${sessionId}`;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const channelRef = useRef<BroadcastChannel | null>(null);

  const readStored = useCallback((): T => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return initialRef.current;
      return JSON.parse(raw) as T;
    } catch {
      return initialRef.current;
    }
  }, [storageKey]);

  const [state, setStateInternal] = useState<T>(() => readStored());

  const persist = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        channelRef.current?.postMessage({ type: 'sync', payload: next });
      } catch {
        /* ignore quota */
      }
    },
    [storageKey]
  );

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateInternal((prev) => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  useEffect(() => {
    setStateInternal(readStored());
  }, [sessionId, toolKey, readStored]);

  useEffect(() => {
    const ch = new BroadcastChannel(`tafelflow-${sessionId}-${toolKey}`);
    channelRef.current = ch;
    ch.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type === 'sync' && ev.data.payload !== undefined) {
        setStateInternal(ev.data.payload as T);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        try {
          setStateInternal(JSON.parse(e.newValue) as T);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      ch.close();
      channelRef.current = null;
      window.removeEventListener('storage', onStorage);
    };
  }, [sessionId, toolKey, storageKey]);

  return [state, setState];
}
