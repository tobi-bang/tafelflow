import type {
  ExamSegment,
  ExamSection,
  ExamSession,
  ExamTimerStatus,
  ScheduleRow,
  ScheduleStatus,
  SegmentProgress,
} from './types';

export const EXAM_TIMER_WARNING_MS = 20_000;

const MINUTE_MS = 60_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function durationMs(segment: ExamSegment): number {
  return Math.max(0, segment.durationMinutes) * MINUTE_MS;
}

function plannedStartMs(session: ExamSession): number {
  const date = session.general.examDate || new Date().toISOString().slice(0, 10);
  const time = session.general.plannedStartTime || '08:00';
  const ms = new Date(`${date}T${time}:00`).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

export function getOrderedExamSections(session: ExamSession): ExamSection[] {
  return session.sections
    .map((section, index) => {
      const position = Number(section.position ?? index + 1);
      return {
        section,
        index,
        position: Number.isFinite(position) ? position : index + 1,
      };
    })
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map((item) => item.section);
}

function withTimer(session: ExamSession, patch: Partial<ExamSession['timer']>): ExamSession {
  return {
    ...session,
    timer: {
      ...session.timer,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function createSession(session: ExamSession): ExamSession {
  return {
    ...session,
    timer: {
      status: 'setup',
      activeSegmentId: null,
      progress: {},
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function updateSession(session: ExamSession, patch: Partial<ExamSession>): ExamSession {
  return {
    ...session,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

export function buildExamSegments(session: ExamSession): ExamSegment[] {
  const segments: ExamSegment[] = [];
  if (session.preparation.enabled && session.preparation.durationMinutes > 0) {
    segments.push({
      id: 'preparation',
      kind: 'preparation',
      title: session.preparation.title || 'Vorbereitung',
      durationMinutes: session.preparation.durationMinutes,
      color: '#475569',
      icon: 'clock',
    });
  }

  for (const section of getOrderedExamSections(session)) {
    if (section.durationMinutes <= 0) continue;
    segments.push({
      id: section.id,
      kind: 'exam',
      title: section.title || 'Prüfungsteil',
      durationMinutes: section.durationMinutes,
      description: section.description,
      color: section.color || '#2563eb',
      icon: section.icon || 'book',
      sourceSectionId: section.id,
    });
    if (section.pauseAfter && section.breakDurationMinutes > 0) {
      segments.push({
        id: `break-${section.id}`,
        kind: 'break',
        title: `Pause nach ${section.title || 'Prüfungsteil'}`,
        durationMinutes: section.breakDurationMinutes,
        color: '#f59e0b',
        icon: 'clock',
        sourceSectionId: section.id,
      });
    }
  }
  return segments;
}

export function getProgress(session: ExamSession, segmentId: string): SegmentProgress | undefined {
  return session.timer.progress[segmentId];
}

export function getSegmentElapsedMs(progress: SegmentProgress | undefined, now = Date.now()): number {
  if (!progress) return 0;
  const runningSince = parseMs(progress.runningSince);
  const runningMs = progress.status === 'running' && runningSince != null ? Math.max(0, now - runningSince) : 0;
  return Math.max(0, progress.elapsedBeforeRunMs + runningMs);
}

export function calculateCurrentRemainingTime(session: ExamSession, now = Date.now()): number | null {
  const activeId = session.timer.activeSegmentId;
  if (!activeId) return null;
  const segment = buildExamSegments(session).find((item) => item.id === activeId);
  if (!segment) return null;
  const elapsed = getSegmentElapsedMs(getProgress(session, activeId), now);
  return durationMs(segment) - elapsed;
}

export function calculateOvertime(session: ExamSession, now = Date.now()): number {
  const remaining = calculateCurrentRemainingTime(session, now);
  if (remaining == null) return 0;
  return Math.max(0, -remaining);
}

export function calculateActiveDueTime(session: ExamSession, now = Date.now()): Date | null {
  const remaining = calculateCurrentRemainingTime(session, now);
  if (remaining == null) return null;
  return new Date(now + remaining);
}

export function findNextPendingSegment(
  session: ExamSession,
  options: { includeBreaks?: boolean; onlyBreaks?: boolean } = {}
): ExamSegment | null {
  const includeBreaks = options.includeBreaks ?? true;
  const segments = buildExamSegments(session);
  for (const segment of segments) {
    const progress = getProgress(session, segment.id);
    const status = progress?.status ?? 'pending';
    if (status !== 'pending') continue;
    if (options.onlyBreaks && segment.kind !== 'break') continue;
    if (!includeBreaks && segment.kind === 'break') continue;
    return segment;
  }
  return null;
}

export function findNextVisibleSegment(session: ExamSession): ExamSegment | null {
  const segments = buildExamSegments(session);
  if (session.timer.activeSegmentId) {
    const activeIdx = segments.findIndex((segment) => segment.id === session.timer.activeSegmentId);
    return segments.slice(activeIdx + 1).find((segment) => (getProgress(session, segment.id)?.status ?? 'pending') === 'pending') ?? null;
  }
  return segments.find((segment) => (getProgress(session, segment.id)?.status ?? 'pending') === 'pending') ?? null;
}

export function startSection(session: ExamSession, segmentId?: string, now = Date.now()): ExamSession {
  if (session.timer.activeSegmentId) return session;
  const segments = buildExamSegments(session);
  const target =
    (segmentId ? segments.find((segment) => segment.id === segmentId) : null) ??
    findNextPendingSegment(session, { includeBreaks: true });
  if (!target) {
    return withTimer(session, { status: 'finished', activeSegmentId: null });
  }

  const nextProgress: SegmentProgress = {
    segmentId: target.id,
    status: 'running',
    actualStart: iso(now),
    elapsedBeforeRunMs: 0,
    runningSince: iso(now),
  };

  return withTimer(session, {
    status: 'running',
    activeSegmentId: target.id,
    progress: {
      ...session.timer.progress,
      [target.id]: nextProgress,
    },
  });
}

export function startBreak(session: ExamSession, now = Date.now()): ExamSession {
  const target = findNextPendingSegment(session, { onlyBreaks: true });
  if (!target) return session;
  return startSection(session, target.id, now);
}

export function pauseSection(session: ExamSession, now = Date.now()): ExamSession {
  const activeId = session.timer.activeSegmentId;
  if (!activeId) return session;
  const current = getProgress(session, activeId);
  if (!current || current.status !== 'running') return session;
  const elapsed = getSegmentElapsedMs(current, now);
  return withTimer(session, {
    status: 'paused',
    progress: {
      ...session.timer.progress,
      [activeId]: {
        ...current,
        status: 'paused',
        elapsedBeforeRunMs: elapsed,
        runningSince: null,
      },
    },
  });
}

export function resumeSection(session: ExamSession, now = Date.now()): ExamSession {
  const activeId = session.timer.activeSegmentId;
  if (!activeId) return session;
  const current = getProgress(session, activeId);
  if (!current || current.status !== 'paused') return session;
  return withTimer(session, {
    status: 'running',
    progress: {
      ...session.timer.progress,
      [activeId]: {
        ...current,
        status: 'running',
        runningSince: iso(now),
      },
    },
  });
}

/**
 * Beendet eine laufende Pause automatisch, sobald die geplante Pausenzeit erreicht ist
 * (kein Überzugs-Countdown wie bei Prüfungsteilen).
 */
export function autoFinishElapsedBreak(session: ExamSession, now = Date.now()): ExamSession {
  const activeId = session.timer.activeSegmentId;
  if (!activeId || session.timer.status !== 'running') return session;
  const active = buildExamSegments(session).find((s) => s.id === activeId);
  if (!active || active.kind !== 'break') return session;
  const remaining = calculateCurrentRemainingTime(session, now);
  if (remaining == null || remaining > 0) return session;
  return finishSection(session, now);
}

export function finishSection(session: ExamSession, now = Date.now()): ExamSession {
  const activeId = session.timer.activeSegmentId;
  if (!activeId) return session;
  const current = getProgress(session, activeId);
  if (!current) return session;
  const elapsed = getSegmentElapsedMs(current, now);
  const progress: Record<string, SegmentProgress> = {
    ...session.timer.progress,
    [activeId]: {
      ...current,
      status: 'completed',
      actualEnd: iso(now),
      elapsedBeforeRunMs: elapsed,
      runningSince: null,
    },
  };
  const hasPending = buildExamSegments(session).some((segment) => (progress[segment.id]?.status ?? 'pending') === 'pending');
  return withTimer(session, {
    status: hasPending ? 'between' : 'finished',
    activeSegmentId: null,
    progress,
  });
}

export function stopSection(session: ExamSession, now = Date.now()): ExamSession {
  return finishSection(session, now);
}

export function skipSegment(session: ExamSession, segmentId: string, now = Date.now()): ExamSession {
  if (session.timer.activeSegmentId === segmentId) return session;
  const progress: SegmentProgress = {
    segmentId,
    status: 'skipped',
    actualEnd: iso(now),
    elapsedBeforeRunMs: 0,
    runningSince: null,
  };
  return withTimer(session, {
    progress: {
      ...session.timer.progress,
      [segmentId]: progress,
    },
  });
}

export function finishExam(session: ExamSession, now = Date.now()): ExamSession {
  const segments = buildExamSegments(session);
  let next = session;
  if (next.timer.activeSegmentId) {
    next = finishSection(next, now);
  }
  const progress = { ...next.timer.progress };
  for (const segment of segments) {
    const status = progress[segment.id]?.status ?? 'pending';
    if (status === 'pending') {
      progress[segment.id] = {
        segmentId: segment.id,
        status: 'skipped',
        actualEnd: iso(now),
        elapsedBeforeRunMs: 0,
        runningSince: null,
      };
    }
  }
  return withTimer(next, {
    status: 'finished',
    activeSegmentId: null,
    progress,
  });
}

export function resetSession(session: ExamSession): ExamSession {
  return withTimer(session, {
    status: 'ready',
    activeSegmentId: null,
    progress: {},
  });
}

function progressToScheduleStatus(progress: SegmentProgress | undefined, segment: ExamSegment, overtimeMs: number): ScheduleStatus {
  if (!progress) return 'wartet';
  if (progress.status === 'completed') return 'abgeschlossen';
  if (progress.status === 'skipped') return 'übersprungen';
  if (progress.status === 'paused') return 'pausiert';
  if (progress.status === 'running' && overtimeMs > 0) return 'überzogen';
  if (progress.status === 'running') return segment.kind === 'break' ? 'läuft' : 'läuft';
  return 'wartet';
}

export function calculateProjectedSchedule(session: ExamSession, now = Date.now()): ScheduleRow[] {
  const segments = buildExamSegments(session);
  const rows: ScheduleRow[] = [];
  let baselineCursor = plannedStartMs(session);
  const anyStarted = Object.values(session.timer.progress).some((progress) => progress.actualStart);
  let cursor = anyStarted ? plannedStartMs(session) : Math.max(plannedStartMs(session), now);

  for (const segment of segments) {
    const segmentDuration = durationMs(segment);
    const progress = getProgress(session, segment.id);
    const baselineStart = baselineCursor;
    const baselineEnd = baselineStart + segmentDuration;
    baselineCursor = baselineEnd;

    let projectedStart = cursor;
    let projectedEnd = cursor + segmentDuration;
    let actualStart: Date | undefined;
    let actualEnd: Date | undefined;
    let overtimeMs = 0;

    if (progress?.actualStart) {
      const start = parseMs(progress.actualStart) ?? cursor;
      actualStart = new Date(start);
      projectedStart = start;
    }

    if (progress?.status === 'completed' || progress?.status === 'skipped') {
      const end = parseMs(progress.actualEnd) ?? projectedStart;
      actualEnd = new Date(end);
      projectedEnd = end;
      cursor = end;
    } else if (progress?.status === 'running' || progress?.status === 'paused') {
      const elapsed = getSegmentElapsedMs(progress, now);
      const remaining = segmentDuration - elapsed;
      overtimeMs = Math.max(0, -remaining);
      projectedEnd = remaining >= 0 ? now + remaining : now;
      cursor = projectedEnd;
    } else {
      projectedStart = cursor;
      projectedEnd = cursor + segmentDuration;
      cursor = projectedEnd;
    }

    const status = progressToScheduleStatus(progress, segment, overtimeMs);
    rows.push({
      segment,
      baselineStart: new Date(baselineStart),
      baselineEnd: new Date(baselineEnd),
      projectedStart: new Date(projectedStart),
      projectedEnd: new Date(projectedEnd),
      actualStart,
      actualEnd,
      status,
      delayMs: Math.max(0, projectedStart - baselineStart),
      overtimeMs,
      driftMs: projectedEnd - baselineEnd,
    });
  }

  return rows;
}

export function getProjectedTotalEnd(session: ExamSession, now = Date.now()): Date | null {
  const rows = calculateProjectedSchedule(session, now);
  return rows.at(-1)?.projectedEnd ?? null;
}

export function getActiveSegment(session: ExamSession): ExamSegment | null {
  const activeId = session.timer.activeSegmentId;
  if (!activeId) return null;
  return buildExamSegments(session).find((segment) => segment.id === activeId) ?? null;
}

export function deriveSessionStatus(session: ExamSession, now = Date.now()): ExamTimerStatus | 'overtime' {
  if (session.timer.status === 'finished') return 'finished';
  if (session.timer.status === 'paused') return 'paused';
  if (session.timer.activeSegmentId && calculateOvertime(session, now) > 0) return 'overtime';
  return session.timer.status;
}
