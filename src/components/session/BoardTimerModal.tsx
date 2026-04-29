import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Maximize2, Minimize2, Pause, Play, Timer, X } from 'lucide-react';

type TimerKind = 'countdown' | 'stopwatch';

const ROW_PX = 48;
const MINUTES_MAX = 90;
const SECOND_CHIPS = [0, 15, 30, 45] as const;

function formatMs(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = Math.floor(clamped / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Vertikales Scroll-Rad mit Snap (Touch-freundlich, ohne zusätzliche Pakete). */
function MinuteScrollWheel({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (m: number) => void;
  disabled?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const skipScrollEvent = useRef(false);
  const minuteList = useMemo(() => Array.from({ length: MINUTES_MAX + 1 }, (_, i) => i), []);

  const scrollToMinute = useCallback((m: number, smooth: boolean) => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.min(MINUTES_MAX, Math.max(0, m));
    skipScrollEvent.current = true;
    el.scrollTo({ top: clamped * ROW_PX, behavior: smooth ? 'smooth' : 'auto' });
    window.setTimeout(() => {
      skipScrollEvent.current = false;
    }, 350);
  }, []);

  useEffect(() => {
    scrollToMinute(value, false);
  }, [value, scrollToMinute]);

  const pickFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || skipScrollEvent.current) return;
    const raw = el.scrollTop / ROW_PX;
    const next = Math.round(Math.min(MINUTES_MAX, Math.max(0, raw)));
    if (next !== value) onChange(next);
  }, [onChange, value]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let t: number;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(pickFromScroll, 80);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      el.removeEventListener('scroll', onScroll);
    };
  }, [pickFromScroll]);

  return (
    <div className={`relative flex flex-col items-center ${disabled ? 'pointer-events-none opacity-45' : ''}`}>
      <span className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Minuten</span>
      <div
        className="pointer-events-none absolute left-0 right-0 top-1/2 z-10 h-12 -translate-y-1/2 rounded-lg border border-blue-200 bg-blue-50/40"
        aria-hidden
      />
      <div
        ref={scrollerRef}
        className="scrollbar-none h-[144px] w-20 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50 py-[48px] shadow-inner snap-y snap-mandatory"
        style={{ scrollPaddingBlock: `${ROW_PX}px` }}
        aria-label={`Minuten wählen, aktuell ${value}`}
        role="group"
      >
        {minuteList.map((m) => (
          <button
            key={m}
            type="button"
            className={`flex h-12 w-full shrink-0 snap-center items-center justify-center text-lg font-bold tabular-nums transition-colors ${
              m === value ? 'text-blue-700' : 'text-slate-400'
            }`}
            onClick={() => {
              onChange(m);
              scrollToMinute(m, true);
            }}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function BoardTimerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<TimerKind>('countdown');
  const [pickMin, setPickMin] = useState(5);
  const [pickSec, setPickSec] = useState(0);

  const [run, setRun] = useState<'idle' | 'running' | 'paused' | 'finished'>('idle');
  /** Countdown: verbleibende ms bei Pause / Startpunkt-Berechnung */
  const countdownRemainRef = useRef(0);
  const countdownEndRef = useRef<number | null>(null);
  /** Stoppuhr: akkumulierte ms + laufendes Segment */
  const swAccumRef = useRef(0);
  const swSegmentStartRef = useRef<number | null>(null);

  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  /** Nur große Zeitanzeige (Unterricht / Beamer), Steuerung im Modal bleibt erreichbar nach Zurück. */
  const [focusView, setFocusView] = useState(false);

  const durationMs = (pickMin * 60 + pickSec) * 1000;

  /** Im Leerlauf Anzeige an gewählter Dauer halten */
  useEffect(() => {
    if (kind !== 'countdown' || run !== 'idle') return;
    countdownRemainRef.current = durationMs;
    setTick((x) => x + 1);
  }, [pickMin, pickSec, kind, run, durationMs]);

  const readCountdownRemaining = useCallback(() => {
    const end = countdownEndRef.current;
    if (end == null) return countdownRemainRef.current;
    return Math.max(0, end - Date.now());
  }, []);

  const readStopwatchElapsed = useCallback(() => {
    let ms = swAccumRef.current;
    const seg = swSegmentStartRef.current;
    if (seg != null) ms += Date.now() - seg;
    return ms;
  }, []);

  const pauseCountdown = useCallback(() => {
    const left = readCountdownRemaining();
    countdownEndRef.current = null;
    countdownRemainRef.current = left;
    if (left <= 0) setRun('finished');
    else setRun('paused');
  }, [readCountdownRemaining]);

  const pauseStopwatch = useCallback(() => {
    const seg = swSegmentStartRef.current;
    if (seg != null) {
      swAccumRef.current += Date.now() - seg;
      swSegmentStartRef.current = null;
    }
    setRun('paused');
  }, []);

  const loop = useCallback(() => {
    if (kind === 'countdown' && run === 'running') {
      const left = readCountdownRemaining();
      if (left <= 0) {
        countdownEndRef.current = null;
        countdownRemainRef.current = 0;
        setRun('finished');
        setTick((t) => t + 1);
        return;
      }
    }
    setTick((t) => t + 1);
    rafRef.current = window.requestAnimationFrame(loop);
  }, [kind, readCountdownRemaining, run]);

  useEffect(() => {
    if (!open || run !== 'running') {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    rafRef.current = window.requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [open, run, loop]);

  /** Beim Schließen: laufenden Timer anhalten (kein Weglaufen im Hintergrund). */
  useEffect(() => {
    if (open) return;
    if (kind === 'countdown' && run === 'running') pauseCountdown();
    if (kind === 'stopwatch' && run === 'running') pauseStopwatch();
  }, [open, kind, run, pauseCountdown, pauseStopwatch]);

  const resetInternal = useCallback(() => {
    countdownEndRef.current = null;
    countdownRemainRef.current = durationMs;
    swAccumRef.current = 0;
    swSegmentStartRef.current = null;
    setRun('idle');
    setTick((t) => t + 1);
  }, [durationMs]);

  const handleKindChange = (next: TimerKind) => {
    if (next === kind) return;
    if (run === 'running') {
      if (kind === 'countdown') pauseCountdown();
      else pauseStopwatch();
    }
    setKind(next);
    countdownEndRef.current = null;
    countdownRemainRef.current = (pickMin * 60 + pickSec) * 1000;
    swAccumRef.current = 0;
    swSegmentStartRef.current = null;
    setRun('idle');
    setTick((x) => x + 1);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (focusView) {
        e.preventDefault();
        setFocusView(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, focusView]);

  useEffect(() => {
    if (!open) setFocusView(false);
  }, [open]);

  const handleStart = () => {
    if (kind === 'countdown') {
      if (durationMs <= 0) return;
      if (run === 'finished' || run === 'idle') {
        countdownRemainRef.current = durationMs;
      }
      const startFrom = run === 'paused' ? countdownRemainRef.current : durationMs;
      if (startFrom <= 0) return;
      countdownEndRef.current = Date.now() + startFrom;
      setRun('running');
      return;
    }
    // Stoppuhr (Fortsetzen läuft über handleResume)
    if (run === 'idle' || run === 'finished') {
      swAccumRef.current = 0;
      swSegmentStartRef.current = Date.now();
      setRun('running');
    }
  };

  const handlePause = () => {
    if (kind === 'countdown') pauseCountdown();
    else pauseStopwatch();
  };

  const handleResume = () => {
    if (kind === 'countdown') {
      const left = countdownRemainRef.current;
      if (left <= 0) {
        setRun('finished');
        return;
      }
      countdownEndRef.current = Date.now() + left;
      setRun('running');
      return;
    }
    swSegmentStartRef.current = Date.now();
    setRun('running');
  };

  const handleReset = () => {
    if (run === 'running') {
      if (kind === 'countdown') pauseCountdown();
      else pauseStopwatch();
    }
    resetInternal();
    countdownRemainRef.current = durationMs;
  };

  const displayMs = useMemo(() => {
    if (kind === 'countdown') {
      if (run === 'running') return readCountdownRemaining();
      if (run === 'finished') return 0;
      if (run === 'paused') return countdownRemainRef.current;
      return durationMs;
    }
    if (run === 'running') return readStopwatchElapsed();
    if (run === 'paused') return swAccumRef.current;
    return 0;
  }, [kind, run, durationMs, readCountdownRemaining, readStopwatchElapsed, tick]);

  const displayStr = formatMs(displayMs);
  const totalSec = Math.ceil(displayMs / 1000);
  const urgentCountdown =
    kind === 'countdown' && run === 'running' && totalSec <= 10 && totalSec > 0;
  const finishedCountdown = kind === 'countdown' && run === 'finished';

  const canStartCountdown = durationMs > 0;
  const wheelDisabled = kind === 'stopwatch' || run === 'running' || run === 'paused';

  if (!open) return null;

  const titleId = 'board-timer-modal-title';

  return (
    <div className="fixed inset-0 z-[52]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        aria-label={focusView ? 'Zurück zur normalen Timer-Ansicht' : 'Schließen'}
        onClick={() => (focusView ? setFocusView(false) : onClose())}
      />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center overflow-hidden overscroll-contain p-0 pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-4 sm:pb-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-auto my-auto flex max-h-[min(92dvh,40rem)] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl sm:max-h-[min(88dvh,40rem)] sm:rounded-3xl"
          onClick={(e) => e.stopPropagation()}
        >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Timer className="h-5 w-5 shrink-0 text-slate-600" aria-hidden />
            <h2 id={titleId} className="truncate text-lg font-bold text-slate-900 sm:text-xl">
              Timer &amp; Stoppuhr
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 sm:min-w-[auto] sm:gap-2 sm:px-3"
              title="Zeit groß anzeigen"
              aria-label="Zeit groß anzeigen"
              onClick={() => setFocusView(true)}
            >
              <Maximize2 className="h-5 w-5 shrink-0" aria-hidden />
              <span className="hidden text-sm font-bold sm:inline">Groß</span>
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              aria-label="Schließen"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-6 sm:py-5">
          <div className="mb-4 flex rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              className={`min-h-11 flex-1 rounded-lg text-sm font-bold transition-colors ${
                kind === 'countdown' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
              onClick={() => handleKindChange('countdown')}
            >
              Timer
            </button>
            <button
              type="button"
              className={`min-h-11 flex-1 rounded-lg text-sm font-bold transition-colors ${
                kind === 'stopwatch' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
              onClick={() => handleKindChange('stopwatch')}
            >
              Stoppuhr
            </button>
          </div>

          {kind === 'countdown' && (
            <div className="mb-6 flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center sm:gap-8">
              <MinuteScrollWheel value={pickMin} onChange={setPickMin} disabled={wheelDisabled} />
              <div className="flex w-full max-w-[16rem] flex-col gap-2">
                <span className="text-center text-[11px] font-bold uppercase tracking-wide text-slate-500 sm:text-left">
                  Sekunden
                </span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SECOND_CHIPS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={wheelDisabled}
                      className={`min-h-11 rounded-xl border text-sm font-bold tabular-nums transition-colors disabled:opacity-40 ${
                        pickSec === s
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                      onClick={() => setPickSec(s)}
                    >
                      {s === 0 ? '0' : `${s}s`}
                    </button>
                  ))}
                </div>
                <p className="text-center text-xs text-slate-500 sm:text-left">
                  Dauer: {pickMin} Min. {pickSec > 0 ? `und ${pickSec} Sek.` : ''}
                </p>
              </div>
            </div>
          )}

          <div
            className={`mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center ${
              urgentCountdown ? 'board-timer-urgent' : ''
            } ${finishedCountdown ? 'board-timer-finished border-red-200 bg-red-50' : ''}`}
            aria-live="polite"
          >
            <div
              className={`font-mono text-5xl font-bold tabular-nums tracking-tight sm:text-6xl ${
                urgentCountdown || finishedCountdown ? '' : 'text-slate-900'
              }`}
            >
              {displayStr}
            </div>
            {finishedCountdown && (
              <p className="mt-3 text-sm font-semibold text-red-700">Zeit ist abgelaufen</p>
            )}
            {kind === 'stopwatch' && run === 'idle' && (
              <p className="mt-2 text-xs text-slate-500">Start drücken – die Stoppuhr beginnt bei 0:00</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            {run === 'running' ? (
              <button
                type="button"
                className="min-h-12 min-w-[7.5rem] rounded-xl bg-amber-100 px-4 text-sm font-bold text-amber-950 hover:bg-amber-200"
                onClick={handlePause}
              >
                Pause
              </button>
            ) : run === 'paused' ? (
              <button
                type="button"
                className="min-h-12 min-w-[7.5rem] rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
                onClick={handleResume}
              >
                Fortsetzen
              </button>
            ) : (
              <button
                type="button"
                disabled={kind === 'countdown' && !canStartCountdown}
                className="min-h-12 min-w-[7.5rem] rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleStart}
              >
                Start
              </button>
            )}
            <button
              type="button"
              className="min-h-12 min-w-[7.5rem] rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50"
              onClick={handleReset}
            >
              Reset
            </button>
          </div>
        </div>
        </motion.div>
      </div>

      {focusView && (
        <div
          className="pointer-events-auto absolute inset-0 z-[1] flex flex-col bg-zinc-950 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-8"
          role="document"
          aria-label="Große Zeitanzeige"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-end gap-2">
            {run === 'running' && (
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-amber-500/25 text-amber-100 hover:bg-amber-500/40"
                aria-label="Pause"
                title="Zeit anhalten"
                onClick={handlePause}
              >
                <Pause className="h-5 w-5 shrink-0" aria-hidden />
              </button>
            )}
            {run === 'paused' && (
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40"
                aria-label="Fortsetzen"
                title="Weiterlaufen lassen"
                onClick={handleResume}
              >
                <Play className="h-5 w-5 shrink-0 pl-0.5" aria-hidden />
              </button>
            )}
            <button
              type="button"
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="Klein anzeigen"
              title="Zurück zur normalen Ansicht"
              onClick={() => setFocusView(false)}
            >
              <Minimize2 className="h-6 w-6" aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center sm:gap-6">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500 sm:text-base">
              {kind === 'countdown' ? 'Countdown' : 'Stoppuhr'}
            </p>
            <div
              className={`w-full max-w-[95vw] rounded-3xl border border-white/10 bg-zinc-900/60 px-4 py-10 sm:px-10 sm:py-14 ${
                urgentCountdown ? 'board-timer-urgent' : ''
              } ${finishedCountdown ? 'board-timer-finished border-red-400/40 bg-red-950/50' : ''}`}
              aria-live="polite"
            >
              <div
                className={`font-mono text-[clamp(3.5rem,22vw,12rem)] font-bold leading-none tabular-nums tracking-tight sm:text-[clamp(4rem,18vw,14rem)] ${
                  urgentCountdown || finishedCountdown ? '' : 'text-white'
                }`}
              >
                {displayStr}
              </div>
              {finishedCountdown && (
                <p className="mt-6 text-lg font-semibold text-red-300 sm:text-xl">Zeit ist abgelaufen</p>
              )}
            </div>
            <button
              type="button"
              className="inline-flex min-h-[52px] min-w-[min(100%,18rem)] items-center justify-center gap-2 rounded-2xl bg-white px-8 py-3.5 text-base font-bold text-zinc-900 shadow-lg hover:bg-zinc-100 sm:min-h-14 sm:text-lg"
              onClick={() => setFocusView(false)}
            >
              <Minimize2 className="h-5 w-5 shrink-0" aria-hidden />
              Klein anzeigen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
