import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Briefcase,
  Calculator,
  CheckCircle2,
  Clock3,
  Copy,
  Flag,
  Hourglass,
  LayoutPanelLeft,
  Link2,
  Link2Off,
  Maximize2,
  Minimize2,
  Palette,
  Pause,
  Play,
  Plus,
  Printer,
  RotateCcw,
  Save,
  ShieldCheck,
  SkipForward,
  Square,
  TimerReset,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
  EXAM_TIMER_WARNING_MS,
  autoFinishElapsedBreak,
  buildExamSegments,
  calculateActiveDueTime,
  calculateCurrentRemainingTime,
  calculateOvertime,
  calculateProjectedSchedule,
  deriveSessionStatus,
  findNextPendingSegment,
  finishExam,
  finishSection,
  getActiveSegment,
  getProgress,
  getOrderedExamSections,
  getProjectedTotalEnd,
  pauseSection,
  resetSession,
  resumeSection,
  skipSegment,
  startSection,
} from './logic';
import {
  BUILT_IN_EXAM_TEMPLATES,
  cloneTemplateForUse,
  createDefaultExamSession,
  createExamSection,
  createTemplateFromSession,
} from './templates';
import type {
  ExamGeneralData,
  ExamIconName,
  ExamPaneId,
  ExamSegment,
  ExamSection,
  ExamSetupStep,
  ExamSession,
  ExamTemplate,
  ScheduleRow,
  SplitScreenSession,
} from './types';

const STATE_STORAGE_KEY = 'tafelflow-pruefungstimer-state-v1';
const TEMPLATE_STORAGE_KEY = 'tafelflow-pruefungstimer-templates-v1';
const MALER_TEMPLATE_ID = 'maler-pruefung-teil-2';
const FAHRZEUGLACKIERER_TEMPLATE_ID = 'fahrzeuglackierer-pruefung-selber-raum';

const COLOR_OPTIONS = ['#2563eb', '#475569', '#0f766e', '#f59e0b', '#dc2626', '#7c3aed', '#15803d'];

const ICONS: Record<ExamIconName, LucideIcon> = {
  book: BookOpen,
  palette: Palette,
  shield: ShieldCheck,
  briefcase: Briefcase,
  calculator: Calculator,
  clock: Clock3,
};

const ICON_OPTIONS: { value: ExamIconName; label: string }[] = [
  { value: 'book', label: 'Buch' },
  { value: 'palette', label: 'Gestaltung' },
  { value: 'shield', label: 'Schutz' },
  { value: 'briefcase', label: 'WiSo' },
  { value: 'calculator', label: 'Rechnen' },
  { value: 'clock', label: 'Zeit' },
];

const timeFormatter = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

interface ExamSetupValidation {
  valid: boolean;
  errors: string[];
  duplicatePositionErrors: string[];
  duplicateTitleErrors: string[];
}

function initialState(): SplitScreenSession {
  return {
    mode: 'single',
    activePane: 'A',
    boardMode: false,
    highContrast: false,
    syncControlEnabled: false,
    syncNotice: null,
    sessions: {
      A: createDefaultExamSession('Prüfung A'),
      B: createDefaultExamSession('Prüfung B'),
    },
    setup: {
      step: 'choose',
      selectedMode: null,
      committed: { A: false, B: false },
      flash: null,
    },
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeState(value: SplitScreenSession): SplitScreenSession {
  const fallback = initialState();
  const rawStep = value.setup?.step;
  const setupStep: ExamSetupStep =
    rawStep === 'single-config' ||
    rawStep === 'single-summary' ||
    rawStep === 'split-a' ||
    rawStep === 'split-b' ||
    rawStep === 'split-summary' ||
    rawStep === 'choose'
      ? rawStep
      : 'choose';
  return {
    mode: value.mode === 'split' ? 'split' : 'single',
    activePane: value.activePane === 'B' ? 'B' : 'A',
    boardMode: Boolean(value.setup && value.boardMode),
    highContrast: Boolean(value.highContrast),
    syncControlEnabled: value.mode === 'split' && Boolean(value.syncControlEnabled),
    syncNotice: null,
    sessions: {
      A: value.sessions?.A ?? fallback.sessions.A,
      B: value.sessions?.B ?? fallback.sessions.B,
    },
    setup: {
      step: setupStep,
      selectedMode: value.setup?.selectedMode === 'single' || value.setup?.selectedMode === 'split' ? value.setup.selectedMode : null,
      committed: {
        A: Boolean(value.setup?.committed?.A),
        B: Boolean(value.setup?.committed?.B),
      },
      flash: null,
    },
  };
}

function readInitialState(): SplitScreenSession {
  return normalizeState(readJson(STATE_STORAGE_KEY, initialState()));
}

function readCustomTemplates(): ExamTemplate[] {
  return readJson(TEMPLATE_STORAGE_KEY, []);
}

function cloneBuiltInTemplate(templateId: string, label: string): ExamSession | null {
  const template = BUILT_IN_EXAM_TEMPLATES.find((item) => item.id === templateId);
  return template ? cloneTemplateForUse(template, label) : null;
}

function normalizeSectionTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
}

function renumberSections(sections: ExamSection[]): ExamSection[] {
  return sections.map((section, index) => ({ ...section, position: index + 1 }));
}

function moveSectionToPosition(sections: ExamSection[], sectionId: string, targetIndex: number): ExamSection[] {
  const currentIndex = sections.findIndex((section) => section.id === sectionId);
  if (currentIndex < 0) return renumberSections(sections);
  const clampedTarget = Math.max(0, Math.min(sections.length - 1, targetIndex));
  const next = [...sections];
  const [item] = next.splice(currentIndex, 1);
  next.splice(clampedTarget, 0, item);
  return renumberSections(next);
}

function validateExamSetup(session: ExamSession): ExamSetupValidation {
  const duplicatePositionErrors: string[] = [];
  const duplicateTitleErrors: string[] = [];
  const positionCounts = new Map<number, number>();
  const titleCounts = new Map<string, { title: string; count: number }>();

  session.sections.forEach((section, index) => {
    const rawPosition = Number(section.position ?? index + 1);
    const position = Number.isFinite(rawPosition) ? rawPosition : index + 1;
    positionCounts.set(position, (positionCounts.get(position) ?? 0) + 1);

    const normalizedTitle = normalizeSectionTitle(section.title);
    if (normalizedTitle) {
      const current = titleCounts.get(normalizedTitle);
      titleCounts.set(normalizedTitle, {
        title: current?.title ?? section.title.trim(),
        count: (current?.count ?? 0) + 1,
      });
    }
  });

  positionCounts.forEach((count, position) => {
    if (count > 1) {
      duplicatePositionErrors.push(`Teil ${position} ist doppelt vergeben. Bitte korrigieren Sie die Reihenfolge.`);
    }
  });

  titleCounts.forEach(({ title, count }) => {
    if (count > 1) {
      duplicateTitleErrors.push(`Achtung: Der Prüfungsbereich '${title}' ist doppelt eingetragen. Bitte korrigieren Sie die Prüfung.`);
    }
  });

  const errors = [...duplicatePositionErrors, ...duplicateTitleErrors];
  if (session.sections.length === 0) {
    errors.push('Bitte legen Sie mindestens einen Prüfungsbereich an.');
  }

  return {
    valid: errors.length === 0,
    errors,
    duplicatePositionErrors,
    duplicateTitleErrors,
  };
}

function formatTime(value?: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return '—';
  return timeFormatter.format(value);
}

function formatDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value || '—';
  return dateFormatter.format(d);
}

function formatClock(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const abs = Math.abs(ms);
  const totalSeconds = Math.floor(abs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatShift(ms: number): string {
  if (Math.abs(ms) < 1000) return '0 Min.';
  const sign = ms > 0 ? '+' : '-';
  const minutes = Math.round(Math.abs(ms) / 60_000);
  return `${sign}${minutes} Min.`;
}

function getExamSummary(session: ExamSession) {
  const segments = buildExamSegments(session);
  const totalMinutes = segments.reduce((sum, segment) => sum + segment.durationMinutes, 0);
  const breakMinutes = segments.filter((segment) => segment.kind === 'break').reduce((sum, segment) => sum + segment.durationMinutes, 0);
  const pauseCount = segments.filter((segment) => segment.kind === 'break').length;
  const sectionMinutes = session.sections.reduce((sum, section) => sum + Math.max(0, section.durationMinutes), 0);
  const preparationMinutes = session.preparation.enabled ? Math.max(0, session.preparation.durationMinutes) : 0;
  return {
    profession: session.general.profession || 'Ausbildungsberuf offen',
    examType: session.general.examType || 'Prüfungsart offen',
    sectionCount: session.sections.filter((section) => section.durationMinutes > 0).length,
    pauseCount,
    breakMinutes,
    sectionMinutes,
    preparationMinutes,
    preparationActive: session.preparation.enabled && session.preparation.durationMinutes > 0,
    totalMinutes,
  };
}

function canSyncStartSession(session: ExamSession): boolean {
  return !session.timer.activeSegmentId && session.timer.status !== 'finished' && Boolean(findNextPendingSegment(session, { includeBreaks: true }));
}

function canSyncPauseSession(session: ExamSession, now: number): boolean {
  const remaining = calculateCurrentRemainingTime(session, now);
  return session.timer.status === 'running' && Boolean(session.timer.activeSegmentId) && remaining != null && remaining > 0;
}

function canSyncResumeSession(session: ExamSession): boolean {
  return session.timer.status === 'paused' && Boolean(session.timer.activeSegmentId);
}

/** Sync „Abschnitt beenden“: nur sinnvoll, wenn ein Abschnitt (inkl. Vorbereitung) aktiv ist. */
function canSyncFinishCurrentSection(session: ExamSession): boolean {
  return session.timer.status !== 'finished' && Boolean(session.timer.activeSegmentId);
}

function syncSkipReason(session: ExamSession, pane: ExamPaneId, action: 'start' | 'pause' | 'resume' | 'stop', now: number): string {
  const label = `Prüfung ${pane}`;
  const remaining = calculateCurrentRemainingTime(session, now);
  if (session.timer.status === 'finished') return `${label} war bereits beendet.`;
  if (action === 'pause' && session.timer.status === 'running' && remaining != null && remaining <= 0) {
    return `${label} ist bereits abgelaufen.`;
  }
  if (action === 'pause') {
    if (session.timer.status === 'paused') return `${label} war bereits pausiert.`;
    if (!session.timer.activeSegmentId) return `${label} läuft noch nicht und wurde daher nicht pausiert.`;
    return `${label} konnte nicht pausiert werden.`;
  }
  if (action === 'resume') {
    if (session.timer.status === 'running') return `${label} lief bereits weiter.`;
    if (!session.timer.activeSegmentId) return `${label} läuft noch nicht und wurde daher nicht fortgesetzt.`;
    return `${label} konnte nicht fortgesetzt werden.`;
  }
  if (action === 'start') {
    if (session.timer.activeSegmentId) return `${label} läuft bereits.`;
    if (!findNextPendingSegment(session, { includeBreaks: true })) return `${label} hat keinen offenen Abschnitt.`;
    return `${label} konnte nicht gestartet werden.`;
  }
  if (action === 'stop') {
    if (!session.timer.activeSegmentId) return `${label} hatte keinen laufenden Abschnitt.`;
    return `${label}: Abschnitt konnte nicht beendet werden.`;
  }
  return `${label}: Aktion nicht möglich.`;
}

function syncActionMessage(action: 'start' | 'pause' | 'resume' | 'stop', changed: ExamPaneId[], skipped: string[]): string {
  if (action === 'stop') {
    const success =
      changed.length === 2
        ? 'Bei beiden Prüfungen wurde der aktuelle Abschnitt beendet.'
        : changed.length === 1
          ? `Bei Prüfung ${changed[0]} wurde der aktuelle Abschnitt beendet.`
          : 'Kein laufender Abschnitt konnte beendet werden.';
    return [...skipped, success].join(' ');
  }
  const verb = action === 'start' ? 'gestartet' : action === 'pause' ? 'pausiert' : action === 'resume' ? 'fortgesetzt' : 'gestoppt';
  const success =
    changed.length === 2
      ? `Beide Prüfungen wurden ${verb}.`
      : changed.length === 1
        ? `Es wurde nur Prüfung ${changed[0]} ${verb}.`
        : `Keine Prüfung wurde ${verb}.`;
  return [...skipped, success].join(' ');
}

function formatTotalMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${minutes} Min.`;
  if (rest === 0) return `${hours} Std.`;
  return `${hours} Std. ${rest} Min.`;
}

function statusText(
  status: ReturnType<typeof deriveSessionStatus>,
  activeKind?: string,
  nextPending?: ExamSegment | null,
): string {
  if (status === 'finished') return 'Beendet';
  if (status === 'paused') return 'Pausiert';
  if (status === 'overtime') return 'Überzogen';
  if (status === 'between' || status === 'ready') {
    if (nextPending?.kind === 'break') return 'Nächste: Pause';
    if (nextPending?.kind === 'preparation') return 'Nächste: Vorbereitung';
    if (nextPending?.kind === 'exam') return 'Nächster Prüfungsteil';
    return 'Abschnitt beendet';
  }
  if (status === 'running') {
    if (activeKind === 'preparation') return 'Vorbereitung';
    if (activeKind === 'break') return 'Pause läuft';
    return 'Prüfungsteil';
  }
  return 'Bereit';
}

function scheduleStatusClass(status: ScheduleRow['status']): string {
  switch (status) {
    case 'abgeschlossen':
      return 'bg-emerald-100 text-emerald-800';
    case 'übersprungen':
      return 'bg-slate-200 text-slate-700';
    case 'läuft':
      return 'bg-blue-100 text-blue-800';
    case 'pausiert':
      return 'bg-amber-100 text-amber-900';
    case 'überzogen':
      return 'bg-rose-100 text-rose-800';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function SegmentIcon({ name, className = 'h-5 w-5' }: { name: ExamIconName; className?: string }) {
  const Icon = ICONS[name] ?? BookOpen;
  return <Icon className={className} aria-hidden />;
}

export default function ExamTimerTool() {
  const navigate = useNavigate();
  const [state, setState] = useState<SplitScreenSession>(readInitialState);
  const [customTemplates, setCustomTemplates] = useState<ExamTemplate[]>(readCustomTemplates);
  const [now, setNow] = useState(Date.now());
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

  const templates = useMemo(() => [...BUILT_IN_EXAM_TEMPLATES, ...customTemplates], [customTemplates]);
  const visiblePanes: ExamPaneId[] = state.mode === 'split' ? ['A', 'B'] : ['A'];
  const validationA = validateExamSetup(state.sessions.A);
  const validationB = validateExamSetup(state.sessions.B);
  const splitReady = state.setup.committed.A && state.setup.committed.B && validationA.valid && validationB.valid;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    const onVisibility = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, []);

  /** Laufende Pausen beenden automatisch, wenn die Pausenzeit abgelaufen ist (ohne Überzug). */
  useEffect(() => {
    setState((prev) => {
      const t = Date.now();
      const nextA = autoFinishElapsedBreak(prev.sessions.A, t);
      const nextB = autoFinishElapsedBreak(prev.sessions.B, t);
      if (nextA === prev.sessions.A && nextB === prev.sessions.B) return prev;
      return { ...prev, sessions: { A: nextA, B: nextB } };
    });
  }, [now]);

  useEffect(() => {
    try {
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }, [state]);

  useEffect(() => {
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(customTemplates));
    } catch {
      /* ignore quota */
    }
  }, [customTemplates]);

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    if (!state.setup.flash) return;
    const id = window.setTimeout(() => {
      setState((prev) => ({
        ...prev,
        setup: { ...prev.setup, flash: null },
      }));
    }, 1800);
    return () => window.clearTimeout(id);
  }, [state.setup.flash]);

  useEffect(() => {
    if (!state.syncNotice) return;
    const id = window.setTimeout(() => {
      setState((prev) => ({ ...prev, syncNotice: null }));
    }, 4200);
    return () => window.clearTimeout(id);
  }, [state.syncNotice]);

  const updatePane = (pane: ExamPaneId, updater: (session: ExamSession) => ExamSession) => {
    setState((prev) => ({
      ...prev,
      activePane: pane,
      sessions: {
        ...prev.sessions,
        [pane]: updater(prev.sessions[pane]),
      },
    }));
  };

  const setExamMode = (mode: SplitScreenSession['mode']) => {
    setState((prev) => ({
      ...prev,
      mode,
      activePane: mode === 'single' ? 'A' : prev.activePane,
      boardMode: mode === 'single' ? false : prev.boardMode,
      syncControlEnabled: mode === 'split' ? prev.syncControlEnabled : false,
      syncNotice: mode === 'split' ? prev.syncNotice : null,
      setup: {
        ...prev.setup,
        selectedMode: mode,
        step:
          mode === 'single'
            ? 'single-config'
            : prev.setup.step === 'split-a' || prev.setup.step === 'split-b' || prev.setup.step === 'split-summary'
              ? prev.setup.step
              : 'split-a',
      },
    }));
  };

  const startSplitBoard = () => {
    if (!splitReady) {
      setState((prev) => ({
        ...prev,
        setup: {
          ...prev.setup,
          flash: 'Bitte korrigieren Sie zuerst die doppelte Zuordnung der Prüfungsbereiche.',
        },
      }));
      return;
    }
    setState((prev) => ({
      ...prev,
      mode: 'split',
      boardMode: true,
    }));
  };

  const chooseSingleSetup = () => {
    setState((prev) => ({
      ...prev,
      mode: 'single',
      activePane: 'A',
      boardMode: false,
      syncControlEnabled: false,
      syncNotice: null,
      setup: {
        ...prev.setup,
        selectedMode: 'single',
        step: 'single-config',
        committed: { ...prev.setup.committed, A: false },
        flash: null,
      },
    }));
  };

  const chooseSplitSetup = () => {
    setState((prev) => {
      const maler = prev.setup.committed.A || prev.sessions.A.general.profession ? prev.sessions.A : cloneBuiltInTemplate(MALER_TEMPLATE_ID, 'Prüfung A') ?? prev.sessions.A;
      const fahrzeug = prev.setup.committed.B || prev.sessions.B.general.profession ? prev.sessions.B : cloneBuiltInTemplate(FAHRZEUGLACKIERER_TEMPLATE_ID, 'Prüfung B') ?? prev.sessions.B;
      return {
        ...prev,
        mode: 'split',
        activePane: 'A',
        boardMode: false,
        syncControlEnabled: prev.syncControlEnabled,
        sessions: {
          A: maler,
          B: fahrzeug,
        },
        setup: {
          ...prev.setup,
          selectedMode: 'split',
          step: 'split-a',
          flash: null,
        },
      };
    });
  };

  const setSetupStep = (step: ExamSetupStep) => {
    setState((prev) => ({
      ...prev,
      activePane: step === 'split-b' ? 'B' : step === 'split-a' ? 'A' : prev.activePane,
      setup: { ...prev.setup, step, flash: null },
    }));
  };

  const commitSetupPane = (pane: ExamPaneId) => {
    const validation = validateExamSetup(state.sessions[pane]);
    if (!validation.valid) {
      setState((prev) => ({
        ...prev,
        setup: {
          ...prev.setup,
          flash: 'Bitte korrigieren Sie zuerst die doppelte Zuordnung der Prüfungsbereiche.',
        },
      }));
      return;
    }
    setState((prev) => {
      const splitMode = prev.setup.selectedMode === 'split' || prev.mode === 'split';
      const nextStep: ExamSetupStep = splitMode ? (pane === 'A' ? 'split-b' : 'split-summary') : 'single-summary';
      return {
        ...prev,
        mode: splitMode ? 'split' : 'single',
        activePane: splitMode && pane === 'A' ? 'B' : pane,
        setup: {
          ...prev.setup,
          selectedMode: splitMode ? 'split' : 'single',
          step: nextStep,
          committed: {
            ...prev.setup.committed,
            [pane]: true,
          },
          flash: 'Prüfung übernommen',
        },
      };
    });
  };

  const saveSetupSettings = () => {
    setState((prev) => ({
      ...prev,
      setup: { ...prev.setup, flash: 'Einstellungen gespeichert' },
    }));
  };

  const loadTemplate = (pane: ExamPaneId, templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    updatePane(pane, () => cloneTemplateForUse(template, `Prüfung ${pane}`));
  };

  const saveTemplate = (pane: ExamPaneId) => {
    const session = state.sessions[pane];
    const name = prompt('Name der Vorlage', `${session.general.profession || session.label} ${session.general.examType}`.trim());
    if (!name?.trim()) return;
    setCustomTemplates((list) => [createTemplateFromSession(session, name.trim()), ...list]);
  };

  const resetAllTimers = () => {
    if (!confirm('Alle Timer zurücksetzen? Die Konfiguration bleibt erhalten, laufende Zeiten werden gelöscht.')) return;
    setState((prev) => ({
      ...prev,
      sessions: {
        A: resetSession(prev.sessions.A),
        B: resetSession(prev.sessions.B),
      },
    }));
  };

  const setSyncControlEnabled = (enabled: boolean) => {
    setState((prev) => ({
      ...prev,
      syncControlEnabled: prev.mode === 'split' ? enabled : false,
      syncNotice: enabled
        ? 'Synchronsteuerung aktiv. Einzelsteuerungen bleiben weiterhin verfügbar.'
        : 'Synchronsteuerung gelöst. Prüfung A und Prüfung B werden getrennt gesteuert.',
    }));
  };

  const startBoth = () => {
    const actionNow = Date.now();
    setState((prev) => {
      const changed: ExamPaneId[] = [];
      const skipped: string[] = [];
      let nextA = prev.sessions.A;
      let nextB = prev.sessions.B;

      if (canSyncStartSession(prev.sessions.A)) {
        nextA = startSection(prev.sessions.A, undefined, actionNow);
        changed.push('A');
      } else {
        skipped.push(syncSkipReason(prev.sessions.A, 'A', 'start', actionNow));
      }

      if (canSyncStartSession(prev.sessions.B)) {
        nextB = startSection(prev.sessions.B, undefined, actionNow);
        changed.push('B');
      } else {
        skipped.push(syncSkipReason(prev.sessions.B, 'B', 'start', actionNow));
      }

      return {
        ...prev,
        sessions: { A: nextA, B: nextB },
        syncNotice:
          changed.length === 2
            ? `Beide Prüfungen wurden mit demselben Startzeitpunkt ${formatTime(new Date(actionNow))} gestartet.`
            : syncActionMessage('start', changed, skipped),
      };
    });
  };

  const pauseBoth = () => {
    const actionNow = Date.now();
    setState((prev) => {
      const changed: ExamPaneId[] = [];
      const skipped: string[] = [];
      let nextA = prev.sessions.A;
      let nextB = prev.sessions.B;

      if (canSyncPauseSession(prev.sessions.A, actionNow)) {
        nextA = pauseSection(prev.sessions.A, actionNow);
        changed.push('A');
      } else {
        skipped.push(syncSkipReason(prev.sessions.A, 'A', 'pause', actionNow));
      }

      if (canSyncPauseSession(prev.sessions.B, actionNow)) {
        nextB = pauseSection(prev.sessions.B, actionNow);
        changed.push('B');
      } else {
        skipped.push(syncSkipReason(prev.sessions.B, 'B', 'pause', actionNow));
      }

      return {
        ...prev,
        sessions: { A: nextA, B: nextB },
        syncNotice: syncActionMessage('pause', changed, skipped),
      };
    });
  };

  const resumeBoth = () => {
    const actionNow = Date.now();
    setState((prev) => {
      const changed: ExamPaneId[] = [];
      const skipped: string[] = [];
      let nextA = prev.sessions.A;
      let nextB = prev.sessions.B;

      if (canSyncResumeSession(prev.sessions.A)) {
        nextA = resumeSection(prev.sessions.A, actionNow);
        changed.push('A');
      } else {
        skipped.push(syncSkipReason(prev.sessions.A, 'A', 'resume', actionNow));
      }

      if (canSyncResumeSession(prev.sessions.B)) {
        nextB = resumeSection(prev.sessions.B, actionNow);
        changed.push('B');
      } else {
        skipped.push(syncSkipReason(prev.sessions.B, 'B', 'resume', actionNow));
      }

      return {
        ...prev,
        sessions: { A: nextA, B: nextB },
        syncNotice: syncActionMessage('resume', changed, skipped),
      };
    });
  };

  const stopBoth = () => {
    if (!confirm('Aktuelle Abschnitte beider Prüfungen beenden? Die Prüfungen laufen weiter – der nächste Abschnitt startet nicht automatisch.')) return;
    const actionNow = Date.now();
    setState((prev) => {
      const changed: ExamPaneId[] = [];
      const skipped: string[] = [];
      let nextA = prev.sessions.A;
      let nextB = prev.sessions.B;

      if (canSyncFinishCurrentSection(prev.sessions.A)) {
        nextA = finishSection(prev.sessions.A, actionNow);
        changed.push('A');
      } else {
        skipped.push(syncSkipReason(prev.sessions.A, 'A', 'stop', actionNow));
      }

      if (canSyncFinishCurrentSection(prev.sessions.B)) {
        nextB = finishSection(prev.sessions.B, actionNow);
        changed.push('B');
      } else {
        skipped.push(syncSkipReason(prev.sessions.B, 'B', 'stop', actionNow));
      }

      return {
        ...prev,
        sessions: { A: nextA, B: nextB },
        syncNotice: syncActionMessage('stop', changed, skipped),
      };
    });
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className={`min-h-dvh ${state.highContrast ? 'bg-zinc-950 text-white' : 'bg-slate-100 text-slate-900'}`}>
      <header
        className={`sticky top-0 z-30 border-b px-3 py-2 shadow-sm sm:px-5 ${
          state.highContrast ? 'border-white/10 bg-zinc-950/95' : 'border-slate-200 bg-white/95'
        } backdrop-blur`}
      >
        <div className="mx-auto flex max-w-[112rem] flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/teacher')}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl ${
                state.highContrast ? 'hover:bg-white/10' : 'hover:bg-slate-100'
              }`}
              aria-label="Zurück"
              title="Zurück"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight sm:text-xl">Prüfungstimer</h1>
              <p className={`hidden text-xs sm:block ${state.highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>
                Lokales Prüfungs-Tool für Board, PC, Tablet und Smartphone
              </p>
            </div>
          </div>

          <div className="scrollbar-none flex max-w-full items-center gap-2 overflow-x-auto">
            {state.mode === 'split' && (splitReady || state.syncControlEnabled) && (
              <HeaderSyncControl
                state={state}
                now={now}
                splitReady={splitReady}
                onToggle={setSyncControlEnabled}
                onStartBoth={startBoth}
                onPauseBoth={pauseBoth}
                onResumeBoth={resumeBoth}
                onStopBoth={stopBoth}
              />
            )}
            <button
              type="button"
              onClick={() => setExamMode(state.mode === 'single' ? 'split' : 'single')}
              className={headerButtonClass(state.highContrast, state.mode === 'split')}
              title="Einzelprüfung oder Splitscreen"
            >
              <LayoutPanelLeft className="h-4 w-4 shrink-0" />
              <span>{state.mode === 'split' ? 'Splitscreen' : 'Einzelprüfung'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!state.boardMode && state.mode === 'split' && !splitReady) {
                  alert('Bitte zuerst Prüfung A und Prüfung B übernehmen.');
                  return;
                }
                if (!state.boardMode && state.mode === 'single' && !validationA.valid) {
                  alert('Bitte korrigieren Sie zuerst die doppelte Zuordnung der Prüfungsbereiche.');
                  return;
                }
                setState((prev) => ({ ...prev, boardMode: !prev.boardMode }));
              }}
              className={headerButtonClass(state.highContrast, state.boardMode)}
              title="Board-Modus"
            >
              <Flag className="h-4 w-4 shrink-0" />
              <span>Board</span>
            </button>
            <button
              type="button"
              onClick={() => setState((prev) => ({ ...prev, highContrast: !prev.highContrast }))}
              className={headerButtonClass(state.highContrast, state.highContrast)}
              title="Hoher Kontrast"
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>Kontrast</span>
            </button>
            <button type="button" onClick={() => window.print()} className={headerButtonClass(state.highContrast, false)} title="Zeitplan drucken">
              <Printer className="h-4 w-4 shrink-0" />
              <span>Druck</span>
            </button>
            <button type="button" onClick={resetAllTimers} className={headerButtonClass(state.highContrast, false)} title="Alle Timer zurücksetzen">
              <TimerReset className="h-4 w-4 shrink-0" />
              <span>Reset</span>
            </button>
            <button type="button" onClick={toggleFullscreen} className={headerButtonClass(state.highContrast, false)} title="Vollbild">
              {isFullscreen ? <Minimize2 className="h-4 w-4 shrink-0" /> : <Maximize2 className="h-4 w-4 shrink-0" />}
              <span className="hidden sm:inline">Vollbild</span>
            </button>
          </div>
        </div>
      </header>

      <main className={`mx-auto max-w-[112rem] ${state.boardMode ? 'p-2 sm:p-3' : 'p-3 sm:p-5'}`}>
        {!state.boardMode ? (
          <SetupWizard
            state={state}
            templates={templates}
            customTemplates={customTemplates}
            now={now}
            onChooseSingle={chooseSingleSetup}
            onChooseSplit={chooseSplitSetup}
            onSetStep={setSetupStep}
            onCommitPane={commitSetupPane}
            onStartSplitBoard={startSplitBoard}
            onSaveSettings={saveSetupSettings}
            onChangePane={updatePane}
            onLoadTemplate={loadTemplate}
            onSaveTemplate={saveTemplate}
            onDeleteTemplate={(templateId) => setCustomTemplates((list) => list.filter((item) => item.id !== templateId))}
            onStartSingleBoard={() =>
              setState((prev) => ({
                ...prev,
                mode: 'single',
                activePane: 'A',
                boardMode: true,
              }))
            }
          />
        ) : (
          <div className={`grid min-w-0 gap-3 ${state.mode === 'split' ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
            {visiblePanes.map((pane) => (
              <React.Fragment key={pane}>
                <ExamSessionWorkspace
                  pane={pane}
                  session={state.sessions[pane]}
                  split={state.mode === 'split'}
                  boardMode={state.boardMode}
                  highContrast={state.highContrast}
                  syncControlEnabled={state.syncControlEnabled}
                  active={state.activePane === pane}
                  templates={templates}
                  customTemplates={customTemplates}
                  now={now}
                  onActivate={() => setState((prev) => ({ ...prev, activePane: pane }))}
                  onChange={(updater) => updatePane(pane, updater)}
                  onLoadTemplate={(templateId) => loadTemplate(pane, templateId)}
                  onSaveTemplate={() => saveTemplate(pane)}
                  onDeleteTemplate={(templateId) => setCustomTemplates((list) => list.filter((item) => item.id !== templateId))}
                />
              </React.Fragment>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function headerButtonClass(highContrast: boolean, active: boolean): string {
  if (highContrast) {
    return `inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
      active ? 'border-white bg-white text-zinc-950' : 'border-white/15 bg-white/5 text-white hover:bg-white/10'
    }`;
  }
  return `inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
    active ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
  }`;
}

/** Splitscreen: Sync-Popover in der Topbar (Auto-Close nach Inaktivität). */
const SYNC_POPOVER_IDLE_MS = 5000;

function HeaderSyncControl({
  state,
  now,
  splitReady,
  onToggle,
  onStartBoth,
  onPauseBoth,
  onResumeBoth,
  onStopBoth,
}: {
  state: SplitScreenSession;
  now: number;
  splitReady: boolean;
  onToggle: (enabled: boolean) => void;
  onStartBoth: () => void;
  onPauseBoth: () => void;
  onResumeBoth: () => void;
  onStopBoth: () => void;
}) {
  const highContrast = state.highContrast;
  const enabled = state.syncControlEnabled;
  const canStartBoth = splitReady && canSyncStartSession(state.sessions.A) && canSyncStartSession(state.sessions.B);
  const canPauseBoth = canSyncPauseSession(state.sessions.A, now) || canSyncPauseSession(state.sessions.B, now);
  const canResumeBoth = canSyncResumeSession(state.sessions.A) || canSyncResumeSession(state.sessions.B);
  const canStopBoth = canSyncFinishCurrentSection(state.sessions.A) || canSyncFinishCurrentSection(state.sessions.B);

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const prevSyncEnabledRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (prevSyncEnabledRef.current === null) {
      prevSyncEnabledRef.current = enabled;
      return;
    }
    if (enabled && !prevSyncEnabledRef.current) {
      setOpen(true);
    }
    prevSyncEnabledRef.current = enabled;
  }, [enabled]);

  const scheduleAutoClose = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      idleTimerRef.current = null;
    }, SYNC_POPOVER_IDLE_MS);
  }, []);

  useEffect(() => {
    if (!open) {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }
    scheduleAutoClose();
    return () => {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [open, scheduleAutoClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const bumpActivity = useCallback(() => {
    if (open) scheduleAutoClose();
  }, [open, scheduleAutoClose]);

  const panelClass = highContrast
    ? 'border border-white/20 bg-zinc-950/98 text-white shadow-2xl backdrop-blur-md'
    : 'border border-slate-200 bg-white/98 text-slate-900 shadow-2xl backdrop-blur-md';

  const muted = highContrast ? 'text-violet-100/85' : 'text-slate-600';

  const triggerBase = headerButtonClass(highContrast, open);
  const triggerActive =
    enabled && !open
      ? highContrast
        ? ' border-violet-400/50 bg-white/10 ring-1 ring-violet-400/50'
        : ' border-violet-300 bg-violet-50 ring-1 ring-violet-400/60'
      : '';

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="exam-sync-header-panel"
        title={enabled ? 'Synchronsteuerung aktiv · öffnen' : 'Synchronsteuerung'}
        aria-label={open ? 'Synchronsteuerung schließen' : 'Synchronsteuerung öffnen'}
        onClick={() => setOpen((v) => !v)}
        className={`${triggerBase}${triggerActive} ${enabled ? 'relative' : ''}`}
      >
        <span className="relative inline-flex shrink-0 items-center justify-center">
          {enabled ? <Link2 className="h-4 w-4" aria-hidden /> : <Link2Off className="h-4 w-4" aria-hidden />}
          {enabled && (
            <span
              className={`absolute -right-1 -top-1 h-2 w-2 rounded-full border shadow ${
                highContrast ? 'border-zinc-900 bg-emerald-400' : 'border-white bg-emerald-500'
              }`}
              title="Synchronsteuerung aktiv"
              aria-hidden
            />
          )}
        </span>
        <span className="max-w-[5.5rem] truncate sm:max-w-none">Sync</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[34] bg-slate-950/30 backdrop-blur-[1px] sm:hidden"
            aria-label="Schließen"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            id="exam-sync-header-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exam-sync-header-title"
            onPointerDownCapture={bumpActivity}
            className={`fixed z-[40] flex max-h-[min(72dvh,28rem)] w-[min(calc(100vw-1rem),22rem)] flex-col overflow-y-auto overscroll-contain rounded-2xl p-3 sm:p-4 ${panelClass} left-2 top-[calc(3.75rem+env(safe-area-inset-top,0px))] sm:left-auto sm:right-4 sm:top-[calc(3.5rem+env(safe-area-inset-top,0px))]`}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p
                  id="exam-sync-header-title"
                  className={`text-xs font-black uppercase tracking-wide ${highContrast ? 'text-violet-200' : 'text-violet-700'}`}
                >
                  Synchronsteuerung
                </p>
                <p className={`text-sm font-semibold ${muted}`}>
                  {enabled ? 'Aktiv · beide Prüfungen gekoppelt' : 'Getrennt · bei Bedarf koppeln'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl ${
                  highContrast ? 'hover:bg-white/10' : 'hover:bg-slate-100'
                }`}
                aria-label="Panel schließen"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className={`mb-3 text-xs leading-snug ${muted}`}>
              Startet, pausiert oder setzt beide Prüfungen gleichzeitig fort. Die einzelnen Prüfungszeiten bleiben unabhängig.
            </p>

            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={!splitReady}
              onClick={() => {
                bumpActivity();
                onToggle(!enabled);
              }}
              className={`mb-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                enabled
                  ? 'bg-violet-700 text-white hover:bg-violet-800'
                  : highContrast
                    ? 'border border-white/15 bg-white/10 text-white hover:bg-white/15'
                    : 'border border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100'
              }`}
            >
              {enabled ? <Link2 className="h-5 w-5 shrink-0" /> : <Link2Off className="h-5 w-5 shrink-0" />}
              {enabled ? 'Synchronsteuerung lösen' : 'Synchronsteuerung aktivieren'}
            </button>

            {!splitReady && (
              <p
                className={`mb-3 rounded-xl border px-3 py-2 text-xs font-semibold ${
                  highContrast ? 'border-white/10 bg-white/5 text-violet-100' : 'border-violet-200 bg-violet-50/80 text-violet-900'
                }`}
              >
                Erst verfügbar, wenn Prüfung A und B übernommen und fehlerfrei sind.
              </p>
            )}

            {state.syncNotice && (
              <p
                className={`mb-3 rounded-xl border px-3 py-2 text-xs font-semibold ${highContrast ? 'border-white/10 bg-zinc-900 text-violet-100' : 'border-violet-200 bg-violet-50 text-violet-900'}`}
                role="status"
              >
                {state.syncNotice}
              </p>
            )}

            {enabled && splitReady && (
              <div className={`space-y-2 border-t pt-3 ${highContrast ? 'border-white/15' : 'border-violet-200'}`}>
                <p className={`text-[11px] font-bold uppercase tracking-wide ${highContrast ? 'text-violet-200' : 'text-violet-700'}`}>
                  Beide Prüfungen
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <SyncActionButton variant="board" label="Beide starten" icon={<Play className="h-5 w-5" />} onClick={onStartBoth} disabled={!canStartBoth} tone="primary" />
                  <SyncActionButton variant="board" label="Beide pausieren" icon={<Pause className="h-5 w-5" />} onClick={onPauseBoth} disabled={!canPauseBoth} tone="warning" />
                  <SyncActionButton variant="board" label="Beide fortsetzen" icon={<Play className="h-5 w-5" />} onClick={onResumeBoth} disabled={!canResumeBoth} tone="success" />
                  <SyncActionButton variant="board" label="Beide Abschnitte beenden" icon={<Square className="h-5 w-5" />} onClick={onStopBoth} disabled={!canStopBoth} tone="danger" />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SyncActionButton({
  label,
  icon,
  onClick,
  disabled,
  tone,
  variant = 'default',
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  tone: 'primary' | 'warning' | 'success' | 'danger';
  variant?: 'default' | 'board';
}) {
  const toneClass =
    tone === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700'
      : tone === 'warning'
        ? 'bg-amber-500 text-amber-950 hover:bg-amber-400'
        : tone === 'success'
          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
          : 'bg-rose-600 text-white hover:bg-rose-700';

  const sizeClass =
    variant === 'board'
      ? 'min-h-12 gap-2 rounded-xl px-2.5 text-xs font-black sm:min-h-14 sm:px-3 sm:text-sm'
      : 'min-h-14 gap-2 rounded-xl px-3 text-sm font-black';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex w-full items-center justify-center shadow-sm disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none ${sizeClass} ${toneClass}`}
    >
      {icon}
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}

function SetupWizard({
  state,
  templates,
  customTemplates,
  now,
  onChooseSingle,
  onChooseSplit,
  onSetStep,
  onCommitPane,
  onStartSplitBoard,
  onStartSingleBoard,
  onSaveSettings,
  onChangePane,
  onLoadTemplate,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  state: SplitScreenSession;
  templates: ExamTemplate[];
  customTemplates: ExamTemplate[];
  now: number;
  onChooseSingle: () => void;
  onChooseSplit: () => void;
  onSetStep: (step: ExamSetupStep) => void;
  onCommitPane: (pane: ExamPaneId) => void;
  onStartSplitBoard: () => void;
  onStartSingleBoard: () => void;
  onSaveSettings: () => void;
  onChangePane: (pane: ExamPaneId, updater: (session: ExamSession) => ExamSession) => void;
  onLoadTemplate: (pane: ExamPaneId, templateId: string) => void;
  onSaveTemplate: (pane: ExamPaneId) => void;
  onDeleteTemplate: (templateId: string) => void;
}) {
  const highContrast = state.highContrast;
  const step = state.setup.step;
  const splitReady = state.setup.committed.A && state.setup.committed.B;

  if (step === 'choose') {
    return (
      <section className={`rounded-3xl border p-5 shadow-sm sm:p-8 ${highContrast ? 'border-white/10 bg-zinc-900' : 'border-slate-200 bg-white'}`}>
        <div className="mx-auto max-w-5xl text-center">
          <p className={`text-sm font-black uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>Prüfung einrichten</p>
          <h2 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">Wie viele Prüfungen finden im Raum statt?</h2>
          <p className={`mx-auto mt-3 max-w-2xl text-base ${highContrast ? 'text-zinc-300' : 'text-slate-600'}`}>
            Wähle zuerst den Prüfungsmodus. Danach führt dich der Assistent Schritt für Schritt durch Vorlagen, Zeiten und Pausen.
          </p>
        </div>
        <div className="mx-auto mt-7 grid max-w-5xl gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={onChooseSingle}
            className={`min-h-44 rounded-3xl border p-6 text-left transition-all hover:-translate-y-0.5 ${
              highContrast ? 'border-white/15 bg-white/5 hover:bg-white/10' : 'border-blue-200 bg-blue-50 hover:border-blue-300 hover:bg-blue-100'
            }`}
          >
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
              <BookOpen className="h-6 w-6" />
            </div>
            <h3 className="text-2xl font-black">Eine Prüfung einrichten</h3>
            <p className={`mt-2 text-sm ${highContrast ? 'text-zinc-300' : 'text-slate-600'}`}>Ein Prüfungsplan, eine Board-Anzeige, eine Steuerung.</p>
          </button>
          <button
            type="button"
            onClick={onChooseSplit}
            className={`min-h-44 rounded-3xl border p-6 text-left transition-all hover:-translate-y-0.5 ${
              highContrast ? 'border-white/15 bg-white/5 hover:bg-white/10' : 'border-emerald-200 bg-emerald-50 hover:border-emerald-300 hover:bg-emerald-100'
            }`}
          >
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <LayoutPanelLeft className="h-6 w-6" />
            </div>
            <h3 className="text-2xl font-black">Zwei Prüfungen im selben Raum einrichten</h3>
            <p className={`mt-2 text-sm ${highContrast ? 'text-zinc-300' : 'text-slate-600'}`}>Prüfung A und Prüfung B nacheinander vorbereiten und danach geteilt am Board anzeigen.</p>
          </button>
        </div>
      </section>
    );
  }

  if (step === 'single-config') {
    const validation = validateExamSetup(state.sessions.A);
    return (
      <WizardShell
        title="Prüfung einrichten"
        stepLabel="Schritt 1 von 2: Prüfung einrichten"
        flash={state.setup.flash}
        highContrast={highContrast}
      >
        <PaneSetupEditor
          pane="A"
          session={state.sessions.A}
          templates={templates}
          customTemplates={customTemplates}
          highContrast={highContrast}
          recommendedTemplateId={MALER_TEMPLATE_ID}
          onChange={(updater) => onChangePane('A', updater)}
          onLoadTemplate={(templateId) => onLoadTemplate('A', templateId)}
          onSaveTemplate={() => onSaveTemplate('A')}
          onDeleteTemplate={onDeleteTemplate}
        />
        <ValidationNotice validation={validation} highContrast={highContrast} />
        <WizardActions>
          <button type="button" onClick={() => onSetStep('choose')} className={secondaryWizardButton(highContrast)}>
            Zurück
          </button>
          <button type="button" onClick={() => onCommitPane('A')} disabled={!validation.valid} className={`${primaryWizardButton()} disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500`}>
            Prüfung übernehmen
          </button>
        </WizardActions>
        {!validation.valid && <BlockingHint highContrast={highContrast} />}
      </WizardShell>
    );
  }

  if (step === 'single-summary') {
    const validation = validateExamSetup(state.sessions.A);
    return (
      <WizardShell
        title="Prüfung bereit"
        stepLabel="Schritt 2 von 2: Übersicht"
        flash={state.setup.flash}
        highContrast={highContrast}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(24rem,1fr)_minmax(18rem,0.6fr)]">
          <DetailedExamSummaryCard pane="A" session={state.sessions.A} now={now} highContrast={highContrast} />
          <div className={`rounded-2xl border p-4 ${highContrast ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
            <h3 className="text-lg font-black">Nächster Schritt</h3>
            <p className={`mt-2 text-sm ${highContrast ? 'text-zinc-300' : 'text-slate-600'}`}>
              Prüfe die Zusammenfassung. Danach kannst du die Board-Ansicht starten und die Timer wie bisher steuern.
            </p>
          </div>
        </div>
        <ValidationNotice validation={validation} highContrast={highContrast} />
        <WizardActions>
          <button type="button" onClick={() => onSetStep('single-config')} className={secondaryWizardButton(highContrast)}>
            Prüfung bearbeiten
          </button>
          <button type="button" onClick={onSaveSettings} className={secondaryWizardButton(highContrast)}>
            Einstellungen speichern
          </button>
          <button type="button" onClick={onStartSingleBoard} disabled={!validation.valid} className={`${primaryWizardButton()} disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500`}>
            Board-Ansicht starten
          </button>
        </WizardActions>
        {!validation.valid && <BlockingHint highContrast={highContrast} />}
      </WizardShell>
    );
  }

  if (step === 'split-a') {
    const validation = validateExamSetup(state.sessions.A);
    return (
      <WizardShell
        title="Prüfung A einrichten"
        stepLabel="Schritt 1 von 3: Prüfung A"
        flash={state.setup.flash}
        highContrast={highContrast}
      >
        <PaneSetupEditor
          pane="A"
          session={state.sessions.A}
          templates={templates}
          customTemplates={customTemplates}
          highContrast={highContrast}
          recommendedTemplateId={MALER_TEMPLATE_ID}
          onChange={(updater) => onChangePane('A', updater)}
          onLoadTemplate={(templateId) => onLoadTemplate('A', templateId)}
          onSaveTemplate={() => onSaveTemplate('A')}
          onDeleteTemplate={onDeleteTemplate}
        />
        <ValidationNotice validation={validation} highContrast={highContrast} />
        <WizardActions>
          <button type="button" onClick={() => onSetStep('choose')} className={secondaryWizardButton(highContrast)}>
            Zurück
          </button>
          <button type="button" onClick={() => onCommitPane('A')} disabled={!validation.valid} className={`${primaryWizardButton()} disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500`}>
            Prüfung A übernehmen
          </button>
        </WizardActions>
        {!validation.valid && <BlockingHint highContrast={highContrast} />}
      </WizardShell>
    );
  }

  if (step === 'split-b') {
    const validation = validateExamSetup(state.sessions.B);
    return (
      <WizardShell
        title="Prüfung B einrichten"
        stepLabel="Schritt 2 von 3: Prüfung B"
        flash={state.setup.flash}
        highContrast={highContrast}
      >
        <div className="mb-4">
          <CompactSetupSummary pane="A" session={state.sessions.A} now={now} highContrast={highContrast} />
        </div>
        <PaneSetupEditor
          pane="B"
          session={state.sessions.B}
          templates={templates}
          customTemplates={customTemplates}
          highContrast={highContrast}
          recommendedTemplateId={FAHRZEUGLACKIERER_TEMPLATE_ID}
          onChange={(updater) => onChangePane('B', updater)}
          onLoadTemplate={(templateId) => onLoadTemplate('B', templateId)}
          onSaveTemplate={() => onSaveTemplate('B')}
          onDeleteTemplate={onDeleteTemplate}
        />
        <ValidationNotice validation={validation} highContrast={highContrast} />
        <WizardActions>
          <button type="button" onClick={() => onSetStep('split-a')} className={secondaryWizardButton(highContrast)}>
            Zurück zu Prüfung A
          </button>
          <button type="button" onClick={() => onCommitPane('B')} disabled={!validation.valid} className={`${primaryWizardButton()} disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500`}>
            Prüfung B übernehmen
          </button>
        </WizardActions>
        {!validation.valid && <BlockingHint highContrast={highContrast} />}
      </WizardShell>
    );
  }

  return (
    <WizardShell
      title="Prüfungen bereit für den Splitscreen"
      stepLabel="Schritt 3 von 3: Übersicht"
      flash={state.setup.flash}
      highContrast={highContrast}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <DetailedExamSummaryCard pane="A" session={state.sessions.A} now={now} highContrast={highContrast} />
        <DetailedExamSummaryCard pane="B" session={state.sessions.B} now={now} highContrast={highContrast} />
      </div>
      <ValidationNotice validation={validateExamSetup(state.sessions.A)} highContrast={highContrast} label="Prüfung A" />
      <ValidationNotice validation={validateExamSetup(state.sessions.B)} highContrast={highContrast} label="Prüfung B" />
      <WizardActions>
        <button type="button" onClick={() => onSetStep('split-a')} className={secondaryWizardButton(highContrast)}>
          Prüfung A bearbeiten
        </button>
        <button type="button" onClick={() => onSetStep('split-b')} className={secondaryWizardButton(highContrast)}>
          Prüfung B bearbeiten
        </button>
        <button type="button" onClick={onSaveSettings} className={secondaryWizardButton(highContrast)}>
          Einstellungen speichern
        </button>
        <button
          type="button"
          onClick={onStartSplitBoard}
          disabled={!splitReady}
          className={`${primaryWizardButton()} disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500`}
        >
          Splitscreen-Board starten
        </button>
      </WizardActions>
    </WizardShell>
  );
}

function WizardShell({
  title,
  stepLabel,
  flash,
  highContrast,
  children,
}: {
  title: string;
  stepLabel: string;
  flash?: string | null;
  highContrast: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-3xl border shadow-sm ${highContrast ? 'border-white/10 bg-zinc-900' : 'border-slate-200 bg-white'}`}>
      <header className={`border-b px-4 py-4 sm:px-6 ${highContrast ? 'border-white/10' : 'border-slate-100'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-xs font-black uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>{stepLabel}</p>
            <h2 className="mt-1 text-2xl font-black sm:text-3xl">{title}</h2>
          </div>
          {flash && (
            <div className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-black ${highContrast ? 'bg-emerald-300 text-zinc-950' : 'bg-emerald-100 text-emerald-900'}`}>
              <CheckCircle2 className="h-5 w-5" />
              {flash}
            </div>
          )}
        </div>
      </header>
      <div className="p-4 sm:p-6">{children}</div>
    </section>
  );
}

function PaneSetupEditor({
  pane,
  session,
  templates,
  customTemplates,
  highContrast,
  recommendedTemplateId,
  onChange,
  onLoadTemplate,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  pane: ExamPaneId;
  session: ExamSession;
  templates: ExamTemplate[];
  customTemplates: ExamTemplate[];
  highContrast: boolean;
  recommendedTemplateId: string;
  onChange: (updater: (session: ExamSession) => ExamSession) => void;
  onLoadTemplate: (templateId: string) => void;
  onSaveTemplate: () => void;
  onDeleteTemplate: (templateId: string) => void;
}) {
  const recommended = templates.find((template) => template.id === recommendedTemplateId);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(22rem,0.78fr)_minmax(34rem,1.22fr)]">
      <aside className={`rounded-2xl border p-4 ${highContrast ? 'border-white/10 bg-white/5' : 'border-blue-100 bg-blue-50/70'}`}>
        <p className={`text-xs font-black uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-blue-700'}`}>Schnellstart Prüfung {pane}</p>
        <h3 className="mt-1 text-xl font-black">Vorlage prominent auswählen</h3>
        {recommended && (
          <button
            type="button"
            onClick={() => onLoadTemplate(recommended.id)}
            className="mt-4 flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl bg-blue-600 px-4 py-3 text-left font-black text-white hover:bg-blue-700"
          >
            <span>{recommended.name}</span>
            <Play className="h-5 w-5 shrink-0" />
          </button>
        )}
        <label className="mt-4 block">
          <span className={`mb-1 block text-xs font-black uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>
            Andere Vorlage
          </span>
          <select
            className={inputClass(highContrast, false)}
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return;
              onLoadTemplate(event.target.value);
              event.target.value = '';
            }}
          >
            <option value="">Vorlage auswählen …</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <div className={`mt-4 rounded-2xl border p-3 text-sm ${highContrast ? 'border-white/10 bg-zinc-950/60 text-zinc-300' : 'border-white bg-white/80 text-slate-700'}`}>
          <p className="font-bold">Wichtig zuerst:</p>
          <p className="mt-1">Ausbildungsberuf, Prüfungsart, Startzeit, Vorbereitung und Prüfungsbereiche. Pausen stehen direkt bei den Bereichen.</p>
        </div>
      </aside>
      <div className={`rounded-2xl border ${highContrast ? 'border-white/10 bg-zinc-950/40' : 'border-slate-200 bg-white'}`}>
        <ConfigurationPanel
          session={session}
          templates={templates}
          customTemplates={customTemplates}
          highContrast={highContrast}
          compact
          onChange={onChange}
          onLoadTemplate={onLoadTemplate}
          onSaveTemplate={onSaveTemplate}
          onDeleteTemplate={onDeleteTemplate}
        />
      </div>
    </div>
  );
}

function WizardActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:flex-wrap sm:justify-end">{children}</div>;
}

function ValidationNotice({
  validation,
  highContrast,
  label,
}: {
  validation: ExamSetupValidation;
  highContrast: boolean;
  label?: string;
}) {
  if (validation.valid) return null;
  return (
    <div
      className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
        highContrast ? 'border-rose-300/40 bg-rose-300/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-900'
      }`}
      role="alert"
    >
      <p className="font-black">{label ? `${label}: ` : ''}Bitte korrigieren Sie zuerst die doppelte Zuordnung der Prüfungsbereiche.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {validation.errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

function BlockingHint({ highContrast }: { highContrast: boolean }) {
  return (
    <p className={`mt-3 text-sm font-bold ${highContrast ? 'text-rose-200' : 'text-rose-700'}`}>
      Bitte korrigieren Sie zuerst die doppelte Zuordnung der Prüfungsbereiche.
    </p>
  );
}

function primaryWizardButton(): string {
  return 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800';
}

function secondaryWizardButton(highContrast: boolean): string {
  return `inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-black ${
    highContrast ? 'border-white/15 bg-white/10 text-white hover:bg-white/15' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
  }`;
}

function CompactSetupSummary({ pane, session, now, highContrast }: { pane: ExamPaneId; session: ExamSession; now: number; highContrast: boolean }) {
  const summary = getExamSummary(session);
  return (
    <div className={`rounded-2xl border p-4 ${highContrast ? 'border-emerald-300/30 bg-emerald-300/10' : 'border-emerald-200 bg-emerald-50'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={`text-xs font-black uppercase tracking-wide ${highContrast ? 'text-emerald-100' : 'text-emerald-800'}`}>Prüfung {pane} übernommen</p>
          <p className="mt-1 text-lg font-black">{summary.profession} · {summary.examType}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <InfoMini label="Bereiche" value={`${summary.sectionCount}`} />
          <InfoMini label="ohne Pausen" value={formatTotalMinutes(summary.sectionMinutes)} />
          <InfoMini label="Pausen" value={formatTotalMinutes(summary.breakMinutes)} />
          <InfoMini label="Ende" value={formatTime(getProjectedTotalEnd(session, now))} />
        </div>
      </div>
    </div>
  );
}

function DetailedExamSummaryCard({ pane, session, now, highContrast }: { pane: ExamPaneId; session: ExamSession; now: number; highContrast: boolean }) {
  const summary = getExamSummary(session);
  const pauseSections = session.sections.filter((section) => section.pauseAfter && section.breakDurationMinutes > 0);
  const orderedSections = getOrderedExamSections(session);
  return (
    <article className={`rounded-2xl border p-4 ${highContrast ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-black uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>Prüfung {pane}</p>
          <h3 className="mt-1 text-2xl font-black">{summary.profession}</h3>
          <p className={`text-sm font-semibold ${highContrast ? 'text-zinc-300' : 'text-slate-700'}`}>{summary.examType}</p>
        </div>
        <div className={`rounded-2xl border px-3 py-2 text-right ${highContrast ? 'border-white/10 bg-zinc-950/40' : 'border-white bg-white'}`}>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">vorauss. Ende</p>
          <p className="font-mono text-2xl font-black">{formatTime(getProjectedTotalEnd(session, now))}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoMini label="Vorbereitung" value={summary.preparationActive ? `${session.preparation.title} · ${summary.preparationMinutes} Min.` : 'optional / aus'} />
        <InfoMini label="Prüfungsbereiche" value={`${summary.sectionCount}`} />
        <InfoMini label="Gesamtzeit ohne Pausen" value={formatTotalMinutes(summary.sectionMinutes)} />
        <InfoMini label="vorauss. Gesamtzeit" value={formatTotalMinutes(summary.totalMinutes)} />
      </div>

      <div className="mt-4 grid gap-3">
        {orderedSections.map((section, index) => (
          <div key={section.id} className={`rounded-xl border px-3 py-2 ${highContrast ? 'border-white/10 bg-zinc-950/40' : 'border-white bg-white'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">{index + 1}. {section.title}</p>
              <span className="font-mono text-sm font-black">{section.durationMinutes} Min.</span>
            </div>
            <p className={`mt-1 text-xs ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>
              Pause danach: {section.pauseAfter && section.breakDurationMinutes > 0 ? `${section.breakDurationMinutes} Min.` : 'keine / noch nicht eingetragen'}
            </p>
          </div>
        ))}
      </div>

      <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${highContrast ? 'border-white/10 bg-zinc-950/40 text-zinc-300' : 'border-white bg-white text-slate-700'}`}>
        <span className="font-bold">Vorbereitete Pausen:</span>{' '}
        {pauseSections.length > 0 ? pauseSections.map((section) => `${section.title}: ${section.breakDurationMinutes} Min.`).join(' · ') : 'keine'}
      </div>
    </article>
  );
}

function ExamModePanel({
  state,
  highContrast,
  onSetMode,
  onStartSplitBoard,
}: {
  state: SplitScreenSession;
  highContrast: boolean;
  onSetMode: (mode: SplitScreenSession['mode']) => void;
  onStartSplitBoard: () => void;
}) {
  const splitActive = state.mode === 'split';

  return (
    <section
      className={`mb-4 rounded-2xl border p-4 shadow-sm sm:p-5 ${
        highContrast ? 'border-white/10 bg-zinc-900' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.85fr)_minmax(28rem,1.15fr)]">
        <div>
          <p className={`text-xs font-bold uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>
            Prüfungsmodus
          </p>
          <div className={`mt-3 grid gap-2 rounded-2xl p-1 sm:grid-cols-2 ${highContrast ? 'bg-white/5' : 'bg-slate-100'}`}>
            <button
              type="button"
              onClick={() => onSetMode('single')}
              className={`min-h-12 rounded-xl px-4 text-sm font-bold transition-colors ${
                !splitActive
                  ? highContrast
                    ? 'bg-white text-zinc-950'
                    : 'bg-white text-slate-950 shadow-sm'
                  : highContrast
                    ? 'text-zinc-300 hover:bg-white/10'
                    : 'text-slate-700 hover:bg-white/70'
              }`}
            >
              Einzelprüfung
            </button>
            <button
              type="button"
              onClick={() => onSetMode('split')}
              className={`min-h-12 rounded-xl px-4 text-sm font-bold transition-colors ${
                splitActive
                  ? highContrast
                    ? 'bg-white text-zinc-950'
                    : 'bg-white text-slate-950 shadow-sm'
                  : highContrast
                    ? 'text-zinc-300 hover:bg-white/10'
                    : 'text-slate-700 hover:bg-white/70'
              }`}
            >
              Zwei Prüfungen im Raum
            </button>
          </div>
          <button
            type="button"
            onClick={() => onSetMode('split')}
            className={`mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-black transition-colors ${
              splitActive
                ? highContrast
                  ? 'bg-emerald-300 text-zinc-950'
                  : 'bg-emerald-100 text-emerald-900'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <LayoutPanelLeft className="h-5 w-5" />
            {splitActive ? 'Zweite Prüfung im Raum ist aktiv' : 'Zweite Prüfung im Raum aktivieren'}
          </button>
          <p className={`mt-3 text-sm leading-relaxed ${highContrast ? 'text-zinc-300' : 'text-slate-600'}`}>
            Nutze diesen Modus, wenn zwei unterschiedliche Prüfungen gleichzeitig im selben Prüfungsraum laufen und beide Zeiten auf dem Board angezeigt werden sollen.
          </p>
        </div>

        {splitActive ? (
          <div className={`rounded-2xl border p-4 ${highContrast ? 'border-emerald-300/40 bg-emerald-300/10' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`text-xs font-bold uppercase tracking-wide ${highContrast ? 'text-emerald-100' : 'text-emerald-800'}`}>
                  Splitscreen aktiv
                </p>
                <h2 className="mt-1 text-xl font-black">Splitscreen-Modus aktiv</h2>
              </div>
              <button
                type="button"
                onClick={onStartSplitBoard}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"
              >
                <Flag className="h-5 w-5" />
                Splitscreen-Board starten
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SplitSummaryCard pane="A" session={state.sessions.A} highContrast={highContrast} />
              <SplitSummaryCard pane="B" session={state.sessions.B} highContrast={highContrast} />
            </div>
          </div>
        ) : (
          <div className={`rounded-2xl border p-4 ${highContrast ? 'border-white/10 bg-white/5' : 'border-slate-100 bg-slate-50'}`}>
            <p className="text-sm font-bold">Aktuell läuft die App als Einzelprüfung.</p>
            <p className={`mt-2 text-sm ${highContrast ? 'text-zinc-400' : 'text-slate-600'}`}>
              Nach Aktivierung erscheinen Prüfung A und Prüfung B als getrennte Konfigurationsbereiche mit eigenen Vorlagen, Pausen und Timern.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function SplitSummaryCard({ pane, session, highContrast }: { pane: ExamPaneId; session: ExamSession; highContrast: boolean }) {
  const summary = getExamSummary(session);
  return (
    <div className={`rounded-2xl border p-3 ${highContrast ? 'border-white/10 bg-zinc-950/50' : 'border-white bg-white/85'}`}>
      <p className={`text-xs font-black uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>Prüfung {pane}</p>
      <p className="mt-1 truncate text-lg font-black">{summary.profession}</p>
      <p className={`text-sm font-semibold ${highContrast ? 'text-zinc-300' : 'text-slate-700'}`}>{summary.examType}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <InfoMini label="Abschnitte" value={`${summary.sectionCount}`} />
        <InfoMini label="Gesamtzeit" value={formatTotalMinutes(summary.totalMinutes)} />
        <InfoMini label="Vorbereitung" value={summary.preparationActive ? 'aktiv' : 'optional'} />
        <InfoMini label="Pausen" value={`${summary.pauseCount}`} />
      </div>
    </div>
  );
}

function ExamSessionWorkspace({
  pane,
  session,
  split,
  boardMode,
  highContrast,
  syncControlEnabled,
  active,
  templates,
  customTemplates,
  now,
  onActivate,
  onChange,
  onLoadTemplate,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  pane: ExamPaneId;
  session: ExamSession;
  split: boolean;
  boardMode: boolean;
  highContrast: boolean;
  syncControlEnabled: boolean;
  active: boolean;
  templates: ExamTemplate[];
  customTemplates: ExamTemplate[];
  now: number;
  onActivate: () => void;
  onChange: (updater: (session: ExamSession) => ExamSession) => void;
  onLoadTemplate: (templateId: string) => void;
  onSaveTemplate: () => void;
  onDeleteTemplate: (templateId: string) => void;
}) {
  const borderClass = active
    ? highContrast
      ? 'border-white'
      : 'border-blue-400 shadow-blue-100'
    : highContrast
      ? 'border-white/10'
      : 'border-slate-200';

  if (boardMode) {
    return (
      <section
        onClick={onActivate}
        className={`min-h-[calc(100dvh-3.5rem)] w-full min-w-0 overflow-y-auto rounded-2xl border ${borderClass} ${
          highContrast ? 'bg-zinc-900' : 'bg-white'
        } shadow-sm`}
      >
        <div className="flex h-full min-h-[calc(100dvh-3.5rem)] w-full min-w-0 flex-col">
          <ExamBoardDisplay session={session} pane={pane} now={now} split={split} boardMode highContrast={highContrast} />
          <div className={`border-t p-3 ${highContrast ? 'border-white/10 bg-zinc-900' : 'border-slate-100 bg-white'}`}>
            <p className={`mb-2 text-xs font-black uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>
              Steuerung Prüfung {pane}
            </p>
            {syncControlEnabled && (
              <p className={`mb-2 rounded-xl px-3 py-2 text-xs font-semibold ${highContrast ? 'bg-violet-300/10 text-violet-100' : 'bg-violet-50 text-violet-800'}`}>
                Hinweis: Die Synchronsteuerung ist aktiv. Diese Aktion betrifft nur Prüfung {pane}.
              </p>
            )}
            <CompactControls session={session} now={now} highContrast={highContrast} onChange={onChange} wrap />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      onClick={onActivate}
      className={`rounded-2xl border ${borderClass} ${highContrast ? 'bg-zinc-900' : 'bg-white'} shadow-sm`}
    >
      <div className={`border-b px-4 py-3 ${highContrast ? 'border-white/10' : 'border-slate-100'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className={`text-xs font-bold uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>
              Prüfung {pane}
            </p>
            <input
              value={session.label}
              onChange={(event) => onChange((prev) => ({ ...prev, label: event.target.value, updatedAt: new Date().toISOString() }))}
              className={`mt-1 w-full rounded-lg border px-2 py-1 text-lg font-bold outline-none ${
                highContrast
                  ? 'border-white/10 bg-zinc-950 text-white focus:border-white'
                  : 'border-transparent bg-transparent text-slate-950 focus:border-blue-300 focus:bg-white'
              }`}
              aria-label={`Name für Prüfung ${pane}`}
            />
          </div>
          {active && (
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${highContrast ? 'bg-white text-zinc-950' : 'bg-blue-100 text-blue-800'}`}>
              aktiv
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(20rem,0.92fr)_minmax(28rem,1.08fr)]">
        <div className={`border-b xl:border-b-0 xl:border-r ${highContrast ? 'border-white/10' : 'border-slate-100'}`}>
          <div className="sticky top-[4.5rem] max-h-none overflow-visible xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
            <TeacherControls pane={pane} session={session} now={now} highContrast={highContrast} syncControlEnabled={syncControlEnabled} onChange={onChange} />
            <ConfigurationPanel
              session={session}
              templates={templates}
              customTemplates={customTemplates}
              highContrast={highContrast}
              onChange={onChange}
              onLoadTemplate={onLoadTemplate}
              onSaveTemplate={onSaveTemplate}
              onDeleteTemplate={onDeleteTemplate}
            />
          </div>
        </div>
        <div className="min-w-0">
          <ExamBoardDisplay session={session} pane={pane} now={now} split={split} boardMode={false} highContrast={highContrast} />
          <ScheduleTable session={session} now={now} highContrast={highContrast} />
        </div>
      </div>
    </section>
  );
}

function TeacherControls({
  pane,
  session,
  now,
  highContrast,
  syncControlEnabled,
  onChange,
}: {
  pane: ExamPaneId;
  session: ExamSession;
  now: number;
  highContrast: boolean;
  syncControlEnabled: boolean;
  onChange: (updater: (session: ExamSession) => ExamSession) => void;
}) {
  return (
    <div className={`border-b p-4 ${highContrast ? 'border-white/10' : 'border-slate-100'}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Lehrkraft-Steuerung · Prüfung {pane}</h2>
          <p className={`text-xs ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>Start, Pause, Abschnittswechsel und kritische Aktionen.</p>
        </div>
      </div>
      {syncControlEnabled && (
        <p className={`mb-3 rounded-xl px-3 py-2 text-xs font-semibold ${highContrast ? 'bg-violet-300/10 text-violet-100' : 'bg-violet-50 text-violet-800'}`}>
          Hinweis: Die Synchronsteuerung ist aktiv. Diese Aktion betrifft nur Prüfung {pane}.
        </p>
      )}
      <CompactControls session={session} now={now} highContrast={highContrast} onChange={onChange} wrap />
    </div>
  );
}

function CompactControls({
  session,
  now,
  highContrast,
  wrap = false,
  onChange,
}: {
  session: ExamSession;
  now: number;
  highContrast: boolean;
  wrap?: boolean;
  onChange: (updater: (session: ExamSession) => ExamSession) => void;
}) {
  const active = getActiveSegment(session);
  const firstPending = findNextPendingSegment(session, { includeBreaks: true });
  const nextSection = findNextPendingSegment(session, { includeBreaks: false });
  const segments = buildExamSegments(session);
  const hasAnyProgress = Object.keys(session.timer.progress).length > 0;
  const isFinished = session.timer.status === 'finished';

  const buttonBase = highContrast
    ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
    : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50';

  const runStart = (segmentId?: string) => onChange((prev) => startSection(prev, segmentId, now));

  const skipBreakAndStart = () => {
    if (!firstPending || firstPending.kind !== 'break' || !nextSection) return;
    if (!confirm('Pause überspringen und direkt den nächsten Abschnitt starten?')) return;
    onChange((prev) => startSection(skipSegment(prev, firstPending.id, now), nextSection.id, now));
  };

  return (
    <div className={`flex ${wrap ? 'flex-wrap' : 'flex-wrap'} gap-2 ${wrap ? '' : 'p-3'}`}>
      {!active && firstPending && firstPending.kind !== 'break' && !isFinished && (
        <button type="button" onClick={() => runStart(firstPending.id)} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 sm:flex-none">
          <Play className="h-5 w-5" />
          {hasAnyProgress ? 'Nächsten Abschnitt starten' : 'Start'}
        </button>
      )}

      {!active && firstPending?.kind === 'break' && !isFinished && (
        <button type="button" onClick={() => runStart(firstPending.id)} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-amber-950 hover:bg-amber-400 sm:flex-none">
          <Hourglass className="h-5 w-5" />
          Pause starten
        </button>
      )}

      {!active && firstPending?.kind === 'break' && nextSection && !isFinished && (
        <button type="button" onClick={skipBreakAndStart} className={`inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold sm:flex-none ${buttonBase}`}>
          <SkipForward className="h-5 w-5" />
          Pause überspringen
        </button>
      )}

      {active && session.timer.status === 'running' && (
        <button type="button" onClick={() => onChange((prev) => pauseSection(prev, now))} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-100 px-4 text-sm font-bold text-amber-950 hover:bg-amber-200 sm:flex-none">
          <Pause className="h-5 w-5" />
          Pause
        </button>
      )}

      {active && session.timer.status === 'paused' && (
        <button type="button" onClick={() => onChange((prev) => resumeSection(prev, now))} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 sm:flex-none">
          <Play className="h-5 w-5" />
          Fortsetzen
        </button>
      )}

      {active && (
        <button
          type="button"
          onClick={() => {
            if (
              !confirm(
                active.kind === 'break'
                  ? 'Pause jetzt beenden? Der nächste Prüfungsteil startet nicht automatisch.'
                  : 'Aktuellen Abschnitt beenden? Der nächste Abschnitt startet nicht automatisch.',
              )
            )
              return;
            onChange((prev) => finishSection(prev, now));
          }}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 sm:flex-none"
        >
          <Square className="h-4 w-4" />
          {active.kind === 'break' ? 'Pause beenden' : 'Stop / Abschnitt beenden'}
        </button>
      )}

      {!isFinished && segments.length > 0 && (
        <button
          type="button"
          onClick={() => {
            if (!confirm('Prüfung vollständig beenden? Offene Abschnitte werden als übersprungen markiert.')) return;
            onChange((prev) => finishExam(prev, now));
          }}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700 sm:flex-none"
        >
          <CheckCircle2 className="h-5 w-5" />
          Prüfung beenden
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          if (hasAnyProgress && !confirm('Timer zurücksetzen? Alle Ist-Zeiten dieser Prüfung werden gelöscht.')) return;
          onChange(resetSession);
        }}
        className={`inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold sm:flex-none ${buttonBase}`}
      >
        <RotateCcw className="h-5 w-5" />
        Zurücksetzen
      </button>
    </div>
  );
}

function ConfigurationPanel({
  session,
  templates,
  customTemplates,
  highContrast,
  compact = false,
  onChange,
  onLoadTemplate,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  session: ExamSession;
  templates: ExamTemplate[];
  customTemplates: ExamTemplate[];
  highContrast: boolean;
  compact?: boolean;
  onChange: (updater: (session: ExamSession) => ExamSession) => void;
  onLoadTemplate: (templateId: string) => void;
  onSaveTemplate: () => void;
  onDeleteTemplate: (templateId: string) => void;
}) {
  const editable = Object.keys(session.timer.progress).length === 0 && !session.timer.activeSegmentId;
  const fieldClass = inputClass(highContrast, !editable);

  const updateGeneral = <K extends keyof ExamGeneralData>(key: K, value: ExamGeneralData[K]) => {
    if (!editable) return;
    onChange((prev) => ({
      ...prev,
      general: { ...prev.general, [key]: value },
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateSection = (sectionId: string, patch: Partial<ExamSection>) => {
    if (!editable) return;
    onChange((prev) => ({
      ...prev,
      sections: prev.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)),
      updatedAt: new Date().toISOString(),
    }));
  };
  const moveSection = (sectionId: string, targetIndex: number) => {
    if (!editable) return;
    onChange((prev) => ({
      ...prev,
      sections: moveSectionToPosition(getOrderedExamSections(prev), sectionId, targetIndex),
      updatedAt: new Date().toISOString(),
    }));
  };
  const orderedSections = getOrderedExamSections(session);
  const validation = validateExamSetup(session);

  return (
    <div className="space-y-5 p-4">
      {!editable && (
        <div className={`rounded-xl border px-3 py-2 text-sm ${highContrast ? 'border-amber-300/40 bg-amber-300/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
          Die Konfiguration ist während einer laufenden oder protokollierten Prüfung geschützt. Zum Bearbeiten bitte den Timer zurücksetzen.
        </div>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide">Vorlage auswählen</h3>
          <button
            type="button"
            onClick={onSaveTemplate}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold ${highContrast ? 'border-white/15 bg-white/10 hover:bg-white/15' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
          >
            <Save className="h-4 w-4" />
            Speichern
          </button>
        </div>
        <div className="grid gap-2">
          <select
            disabled={!editable}
            className={fieldClass}
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return;
              onLoadTemplate(event.target.value);
              event.target.value = '';
            }}
          >
            <option value="">Vorlage laden …</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          {customTemplates.length > 0 && (
            <div className="grid gap-2">
              {customTemplates.slice(0, 3).map((template) => (
                <div key={template.id} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${highContrast ? 'border-white/10 bg-white/5' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{template.name}</p>
                    <p className={`truncate text-xs ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>{template.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteTemplate(template.id)}
                    className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg ${highContrast ? 'hover:bg-white/10' : 'hover:bg-rose-50 hover:text-rose-700'}`}
                    aria-label={`Vorlage ${template.name} löschen`}
                    title="Vorlage löschen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide">Allgemeine Prüfungsdaten</h3>
        <div className="grid gap-3">
          <LabeledField label="Ausbildungsberuf">
            <input disabled={!editable} value={session.general.profession} onChange={(event) => updateGeneral('profession', event.target.value)} className={fieldClass} placeholder="z. B. Maler und Lackierer" />
          </LabeledField>
          <LabeledField label="Prüfungsart">
            <input disabled={!editable} value={session.general.examType} onChange={(event) => updateGeneral('examType', event.target.value)} className={fieldClass} placeholder="z. B. Prüfung Teil 2" />
          </LabeledField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledField label="Datum">
              <input disabled={!editable} type="date" value={session.general.examDate} onChange={(event) => updateGeneral('examDate', event.target.value)} className={fieldClass} />
            </LabeledField>
            <LabeledField label="Geplanter Start">
              <input disabled={!editable} type="time" value={session.general.plannedStartTime} onChange={(event) => updateGeneral('plannedStartTime', event.target.value)} className={fieldClass} />
            </LabeledField>
          </div>
          {compact ? (
            <details className={`rounded-xl border px-3 py-2 ${highContrast ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
              <summary className="cursor-pointer text-sm font-bold">Weitere Angaben: Raum und Hinweise</summary>
              <div className="mt-3 grid gap-3">
                <LabeledField label="Raum">
                  <input disabled={!editable} value={session.general.room ?? ''} onChange={(event) => updateGeneral('room', event.target.value)} className={fieldClass} placeholder="optional" />
                </LabeledField>
                <LabeledField label="Hinweise für Prüflinge">
                  <textarea disabled={!editable} value={session.general.notes ?? ''} onChange={(event) => updateGeneral('notes', event.target.value)} className={`${fieldClass} min-h-24 resize-y`} placeholder="optional" />
                </LabeledField>
              </div>
            </details>
          ) : (
            <>
              <LabeledField label="Raum">
                <input disabled={!editable} value={session.general.room ?? ''} onChange={(event) => updateGeneral('room', event.target.value)} className={fieldClass} placeholder="optional" />
              </LabeledField>
              <LabeledField label="Hinweise für Prüflinge">
                <textarea disabled={!editable} value={session.general.notes ?? ''} onChange={(event) => updateGeneral('notes', event.target.value)} className={`${fieldClass} min-h-24 resize-y`} placeholder="optional" />
              </LabeledField>
            </>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide">Vorbereitung</h3>
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
            <input
              disabled={!editable}
              type="checkbox"
              checked={session.preparation.enabled}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  preparation: { ...prev.preparation, enabled: event.target.checked },
                  updatedAt: new Date().toISOString(),
                }))
              }
              className="h-5 w-5 accent-blue-600"
            />
            aktiv
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
          <LabeledField label="Bezeichnung">
            <input
              disabled={!editable || !session.preparation.enabled}
              value={session.preparation.title}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  preparation: { ...prev.preparation, title: event.target.value },
                  updatedAt: new Date().toISOString(),
                }))
              }
              className={fieldClass}
            />
          </LabeledField>
          <LabeledField label="Minuten">
            <input
              disabled={!editable || !session.preparation.enabled}
              type="number"
              min={0}
              value={session.preparation.durationMinutes}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  preparation: { ...prev.preparation, durationMinutes: Math.max(0, Number(event.target.value) || 0) },
                  updatedAt: new Date().toISOString(),
                }))
              }
              className={fieldClass}
            />
          </LabeledField>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide">Prüfungsbereiche und Pausen</h3>
          <button
            type="button"
            disabled={!editable}
              onClick={() =>
                onChange((prev) => ({
                  ...prev,
                  sections: renumberSections([
                    ...getOrderedExamSections(prev),
                    createExamSection({ title: `Prüfungsteil ${prev.sections.length + 1}`, position: prev.sections.length + 1 }),
                  ]),
                  updatedAt: new Date().toISOString(),
                }))
              }
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold ${
              editable ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-200 text-slate-500'
            }`}
          >
            <Plus className="h-4 w-4" />
            Teil
          </button>
        </div>
        <div className={`mb-3 rounded-xl border px-3 py-2 text-sm ${highContrast ? 'border-white/10 bg-white/5 text-zinc-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
          <p className={`font-bold ${highContrast ? 'text-white' : 'text-slate-800'}`}>Reihenfolge ändern</p>
          <p className="mt-1">
            Sie können die Reihenfolge der Prüfungsbereiche ändern. Jeder Prüfungsbereich darf nur einmal vorkommen und jede Position darf nur einmal vergeben sein.
          </p>
        </div>
        <ValidationNotice validation={validation} highContrast={highContrast} />
        <div className="space-y-3">
          {orderedSections.map((section, index) => (
            <div key={section.id} className={`rounded-xl border p-3 ${highContrast ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: section.color }}>
                    <SegmentIcon name={section.icon} className="h-4 w-4" />
                  </span>
                  <p className="truncate text-sm font-bold">Teil {index + 1}</p>
                </div>
                <button
                  type="button"
                  disabled={!editable || session.sections.length <= 1}
                  onClick={() =>
                    onChange((prev) => ({
                      ...prev,
                      sections: renumberSections(getOrderedExamSections(prev).filter((item) => item.id !== section.id)),
                      updatedAt: new Date().toISOString(),
                    }))
                  }
                  className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg ${
                    editable && session.sections.length > 1 ? 'hover:bg-rose-50 hover:text-rose-700' : 'opacity-40'
                  }`}
                  aria-label={`${section.title} löschen`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
                  <LabeledField label="Position / Teil">
                    <select
                      disabled={!editable}
                      value={index + 1}
                      onChange={(event) => moveSection(section.id, Number(event.target.value) - 1)}
                      className={fieldClass}
                    >
                      {orderedSections.map((_, positionIndex) => (
                        <option key={positionIndex + 1} value={positionIndex + 1}>
                          Teil {positionIndex + 1}
                        </option>
                      ))}
                    </select>
                  </LabeledField>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={!editable || index === 0}
                      onClick={() => moveSection(section.id, index - 1)}
                      className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${
                        editable && index > 0
                          ? highContrast
                            ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                            : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                          : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                      }`}
                    >
                      Nach oben
                    </button>
                    <button
                      type="button"
                      disabled={!editable || index === orderedSections.length - 1}
                      onClick={() => moveSection(section.id, index + 1)}
                      className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${
                        editable && index < orderedSections.length - 1
                          ? highContrast
                            ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                            : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                          : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                      }`}
                    >
                      Nach unten
                    </button>
                  </div>
                </div>
                <LabeledField label="Titel">
                  <input disabled={!editable} value={section.title} onChange={(event) => updateSection(section.id, { title: event.target.value })} className={fieldClass} />
                </LabeledField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr_1fr]">
                  <LabeledField label="Minuten">
                    <input disabled={!editable} type="number" min={1} value={section.durationMinutes} onChange={(event) => updateSection(section.id, { durationMinutes: Math.max(1, Number(event.target.value) || 1) })} className={fieldClass} />
                  </LabeledField>
                  <LabeledField label="Farbe">
                    <div className="flex min-h-11 flex-wrap items-center gap-2">
                      {COLOR_OPTIONS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          disabled={!editable}
                          onClick={() => updateSection(section.id, { color })}
                          className={`h-9 w-9 rounded-full border-2 ${section.color === color ? 'border-slate-950 ring-2 ring-blue-300' : 'border-white'} disabled:opacity-40`}
                          style={{ backgroundColor: color }}
                          aria-label={`Farbe ${color}`}
                        />
                      ))}
                    </div>
                  </LabeledField>
                  <LabeledField label="Icon">
                    <select disabled={!editable} value={section.icon} onChange={(event) => updateSection(section.id, { icon: event.target.value as ExamIconName })} className={fieldClass}>
                      {ICON_OPTIONS.map((icon) => (
                        <option key={icon.value} value={icon.value}>
                          {icon.label}
                        </option>
                      ))}
                    </select>
                  </LabeledField>
                </div>
                <LabeledField label="Kurzbeschreibung">
                  <input disabled={!editable} value={section.description ?? ''} onChange={(event) => updateSection(section.id, { description: event.target.value })} className={fieldClass} placeholder="optional" />
                </LabeledField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
                    <input disabled={!editable} type="checkbox" checked={section.pauseAfter} onChange={(event) => updateSection(section.id, { pauseAfter: event.target.checked })} className="h-5 w-5 accent-blue-600" />
                    Pause nach diesem Teil
                  </label>
                  <LabeledField label="Pause Min.">
                    <input disabled={!editable || !section.pauseAfter} type="number" min={0} value={section.breakDurationMinutes} onChange={(event) => updateSection(section.id, { breakDurationMinutes: Math.max(0, Number(event.target.value) || 0) })} className={fieldClass} />
                  </LabeledField>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function inputClass(highContrast: boolean, disabled: boolean): string {
  const base = 'w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60';
  if (highContrast) return `${base} border-white/10 bg-zinc-950 text-white placeholder:text-zinc-500`;
  return `${base} border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 ${disabled ? 'bg-slate-100' : ''}`;
}

function ExamBoardDisplay({
  session,
  pane,
  now,
  split,
  boardMode,
  highContrast,
}: {
  session: ExamSession;
  pane: ExamPaneId;
  now: number;
  split: boolean;
  boardMode: boolean;
  highContrast: boolean;
}) {
  const activeSegment = getActiveSegment(session);
  const nextPending =
    session.timer.status !== 'finished' && !activeSegment ? findNextPendingSegment(session, { includeBreaks: true }) : null;
  const nextAfterPending =
    nextPending && session.timer.status !== 'finished'
      ? (() => {
          const segs = buildExamSegments(session);
          const idx = segs.findIndex((s) => s.id === nextPending.id);
          return segs.slice(idx + 1).find((s) => (getProgress(session, s.id)?.status ?? 'pending') === 'pending') ?? null;
        })()
      : null;
  const remaining = calculateCurrentRemainingTime(session, now);
  const overtime = calculateOvertime(session, now);
  const schedule = useMemo(() => calculateProjectedSchedule(session, now), [session, now]);
  const due = calculateActiveDueTime(session, now);
  const projectedEnd = getProjectedTotalEnd(session, now);
  const scheduleNextWaiting = schedule.find((row) => row.status === 'wartet');
  const scheduleNextPendingRow = nextPending ? schedule.find((row) => row.segment.id === nextPending.id) ?? null : null;
  const displayedDue = due ?? scheduleNextPendingRow?.projectedEnd ?? scheduleNextWaiting?.projectedEnd ?? null;
  const status = deriveSessionStatus(session, now);
  const warning = Boolean(
    activeSegment &&
      remaining != null &&
      remaining > 0 &&
      remaining <= EXAM_TIMER_WARNING_MS &&
      session.timer.status === 'running',
  );
  const plannedIdleMs =
    !activeSegment && session.timer.status !== 'finished' && nextPending ? Math.max(0, nextPending.durationMinutes * 60_000) : null;
  const displayMs = overtime > 0 ? overtime : activeSegment ? remaining : plannedIdleMs;
  const title =
    activeSegment?.title ?? (session.timer.status === 'finished' ? 'Prüfung beendet' : nextPending?.title ?? 'Bereit zum Start');
  const statusLabel = statusText(status, activeSegment?.kind, nextPending);
  const timerTone = overtime > 0 ? 'text-rose-600' : warning ? 'text-amber-500' : highContrast ? 'text-white' : 'text-slate-950';
  const shellClass = highContrast
    ? 'bg-zinc-950 text-white'
    : overtime > 0
      ? 'bg-rose-50 text-slate-950'
      : warning
        ? 'bg-amber-50 text-slate-950'
        : 'bg-white text-slate-950';

  const boardTimerClass = boardMode
    ? split
      ? 'text-[clamp(2rem,min(16cqi,14vw),7.5rem)]'
      : 'text-[clamp(2.75rem,min(11cqi,12vw),14rem)]'
    : 'text-[clamp(4rem,14vw,11rem)]';

  return (
    <div
      className={`flex min-h-0 min-w-0 w-full flex-1 flex-col ${shellClass} ${boardMode ? 'p-3 sm:p-5' : 'p-4 sm:p-6'}`}
      style={boardMode ? ({ containerType: 'inline-size' } as React.CSSProperties) : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {split && <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">Prüfung {pane}</span>}
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusBadgeClass(status, highContrast)}`}>
              {statusLabel}
            </span>
          </div>
          <p className={`mt-3 text-sm font-semibold uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>
            {session.general.profession || 'Prüfung'} · {session.general.examType || 'Prüfungsart'}
          </p>
          <h2 className={`${boardMode ? 'text-3xl sm:text-5xl xl:text-6xl' : 'text-2xl sm:text-4xl'} mt-2 max-w-5xl text-pretty font-black leading-tight`}>
            {title}
          </h2>
          {!activeSegment && session.timer.status !== 'finished' && nextPending?.kind === 'break' && (
            <p className={`mt-2 max-w-4xl text-pretty text-base font-semibold sm:text-lg ${highContrast ? 'text-amber-200' : 'text-amber-900'}`}>
              Pause steht als eigener Abschnitt an — bitte „Pause starten“. Danach: {nextAfterPending?.title ?? 'nächster Prüfungsteil'} (startet nicht automatisch).
            </p>
          )}
          {activeSegment?.description && !boardMode && (
            <p className={`mt-2 max-w-3xl text-sm sm:text-base ${highContrast ? 'text-zinc-300' : 'text-slate-600'}`}>{activeSegment.description}</p>
          )}
        </div>
        <div className={`rounded-2xl border px-4 py-3 text-right ${highContrast ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white/80'}`}>
          <p className={`text-xs font-bold uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>Aktuelle Uhrzeit</p>
          <p className="font-mono text-2xl font-bold tabular-nums sm:text-3xl">{formatTime(new Date(now))}</p>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col justify-center px-1 py-4 text-center sm:px-2 sm:py-5">
        <p className={`mb-2 text-sm font-bold uppercase tracking-[0.2em] ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>
          {overtime > 0 ? 'Überziehungszeit' : activeSegment ? 'Verbleibende Zeit' : nextPending ? 'Geplante Dauer (noch nicht gestartet)' : 'Verbleibende Zeit'}
        </p>
        <div className="mx-auto flex w-full max-w-full min-w-0 justify-center overflow-visible">
          <div
            className={`max-w-full whitespace-nowrap font-mono font-black leading-none tabular-nums tracking-normal ${timerTone} ${boardTimerClass} ${
              warning ? 'exam-timer-blink' : ''
            }`}
            aria-live="polite"
          >
            {overtime > 0 ? `+${formatClock(displayMs)}` : formatClock(displayMs)}
          </div>
        </div>
      </div>

      <div className={`grid gap-3 ${boardMode ? 'md:grid-cols-4' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>
        <InfoTile label="Abgabe Abschnitt" value={formatTime(displayedDue)} highContrast={highContrast} urgent={overtime > 0 || warning} />
        <InfoTile label="Gesamt-Ende" value={formatTime(projectedEnd)} highContrast={highContrast} />
        <InfoTile label="Geplanter Start" value={`${formatDate(session.general.examDate)} · ${session.general.plannedStartTime || '—'}`} highContrast={highContrast} />
        <InfoTile
          label={nextPending?.kind === 'break' ? 'Nächste Pause' : 'Nächster Abschnitt'}
          value={
            nextPending
              ? `${nextPending.title} · ${formatTotalMinutes(nextPending.durationMinutes)}${
                  nextAfterPending ? ` — danach: ${nextAfterPending.title}` : ''
                } · geplant ${formatTime(scheduleNextPendingRow?.projectedStart ?? null)}–${formatTime(scheduleNextPendingRow?.projectedEnd ?? null)}`
              : '—'
          }
          highContrast={highContrast}
        />
      </div>

      {session.general.notes && !boardMode && (
        <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${highContrast ? 'border-white/10 bg-white/5 text-zinc-200' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          <span className="font-bold">Hinweise:</span> {session.general.notes}
        </div>
      )}
    </div>
  );
}

function statusBadgeClass(status: ReturnType<typeof deriveSessionStatus>, highContrast: boolean): string {
  if (highContrast) {
    if (status === 'overtime') return 'bg-rose-500 text-white';
    if (status === 'finished') return 'bg-emerald-400 text-zinc-950';
    if (status === 'paused' || status === 'between') return 'bg-amber-300 text-zinc-950';
    return 'bg-white text-zinc-950';
  }
  if (status === 'overtime') return 'bg-rose-100 text-rose-800';
  if (status === 'finished') return 'bg-emerald-100 text-emerald-800';
  if (status === 'paused' || status === 'between') return 'bg-amber-100 text-amber-900';
  if (status === 'running') return 'bg-blue-100 text-blue-800';
  return 'bg-slate-100 text-slate-700';
}

function InfoTile({ label, value, highContrast, urgent = false }: { label: string; value: string; highContrast: boolean; urgent?: boolean }) {
  return (
    <div
      className={`min-h-24 rounded-2xl border px-4 py-3 ${
        urgent
          ? highContrast
            ? 'border-amber-300/50 bg-amber-300/10'
            : 'border-amber-200 bg-amber-50'
          : highContrast
            ? 'border-white/10 bg-white/5'
            : 'border-slate-200 bg-slate-50'
      }`}
    >
      <p className={`text-xs font-bold uppercase tracking-wide ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>{label}</p>
      <p className="mt-2 text-xl font-black leading-tight sm:text-2xl">{value}</p>
    </div>
  );
}

function ScheduleTable({ session, now, highContrast }: { session: ExamSession; now: number; highContrast: boolean }) {
  const rows = useMemo(() => calculateProjectedSchedule(session, now), [session, now]);

  return (
    <section className={`border-t p-4 sm:p-6 ${highContrast ? 'border-white/10' : 'border-slate-100'}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Zeitplanung</h2>
          <p className={`text-sm ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>Live berechnet aus tatsächlicher Uhrzeit, Pausen, Verzögerungen und Überziehungen.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            const text = rows
              .map((row) => `${row.segment.title}: ${formatTime(row.projectedStart)}-${formatTime(row.projectedEnd)} (${row.status})`)
              .join('\n');
            void navigator.clipboard?.writeText(text);
          }}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-bold ${highContrast ? 'border-white/15 bg-white/10 hover:bg-white/15' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
        >
          <Copy className="h-4 w-4" />
          Kopieren
        </button>
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[46rem] border-separate border-spacing-y-2 text-left text-sm">
          <thead className={highContrast ? 'text-zinc-400' : 'text-slate-500'}>
            <tr>
              <th className="px-3 py-1">Abschnitt</th>
              <th className="px-3 py-1">Dauer</th>
              <th className="px-3 py-1">Tatsächlicher Start</th>
              <th className="px-3 py-1">Berechnetes Ende</th>
              <th className="px-3 py-1">Status</th>
              <th className="px-3 py-1">Verschiebung</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.segment.id} className={highContrast ? 'bg-white/5' : 'bg-slate-50'}>
                <td className="rounded-l-xl px-3 py-3 font-semibold">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: row.segment.color }}>
                      <SegmentIcon name={row.segment.icon} className="h-4 w-4" />
                    </span>
                    <span>{row.segment.title}</span>
                  </div>
                </td>
                <td className="px-3 py-3 tabular-nums">{row.segment.durationMinutes} Min.</td>
                <td className="px-3 py-3 tabular-nums">{row.actualStart ? formatTime(row.actualStart) : formatTime(row.projectedStart)}</td>
                <td className="px-3 py-3 tabular-nums">{row.actualEnd ? formatTime(row.actualEnd) : formatTime(row.projectedEnd)}</td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${scheduleStatusClass(row.status)}`}>{row.status}</span>
                </td>
                <td className={`rounded-r-xl px-3 py-3 font-semibold tabular-nums ${row.overtimeMs > 0 ? 'text-rose-600' : ''}`}>
                  {row.overtimeMs > 0 ? `+${formatClock(row.overtimeMs)} überzogen` : formatShift(row.driftMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:hidden">
        {rows.map((row) => (
          <div key={row.segment.id} className={`rounded-2xl border p-3 ${highContrast ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold">{row.segment.title}</p>
                <p className={`text-xs ${highContrast ? 'text-zinc-400' : 'text-slate-500'}`}>{row.segment.durationMinutes} Min. · {formatTime(row.projectedStart)}-{formatTime(row.projectedEnd)}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${scheduleStatusClass(row.status)}`}>{row.status}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <InfoMini label="Start" value={row.actualStart ? formatTime(row.actualStart) : formatTime(row.projectedStart)} />
              <InfoMini label="Ende" value={row.actualEnd ? formatTime(row.actualEnd) : formatTime(row.projectedEnd)} />
              <InfoMini label="Verschiebung" value={row.overtimeMs > 0 ? `+${formatClock(row.overtimeMs)}` : formatShift(row.driftMs)} />
              <InfoMini label="Plan" value={`${formatTime(row.baselineStart)}-${formatTime(row.baselineEnd)}`} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function InfoMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
