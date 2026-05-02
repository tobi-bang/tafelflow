export type ExamSegmentKind = 'preparation' | 'exam' | 'break';

export type ExamTimerStatus = 'setup' | 'ready' | 'running' | 'paused' | 'between' | 'finished';

export type SegmentProgressStatus = 'pending' | 'running' | 'paused' | 'completed' | 'skipped';

export type ExamTimerMode = 'single' | 'split';

export type ExamPaneId = 'A' | 'B';

export type ExamSetupStep =
  | 'choose'
  | 'single-config'
  | 'single-summary'
  | 'split-a'
  | 'split-b'
  | 'split-summary';

export type ExamIconName = 'book' | 'palette' | 'shield' | 'briefcase' | 'calculator' | 'clock';

export interface ExamGeneralData {
  profession: string;
  examType: string;
  examDate: string;
  plannedStartTime: string;
  room?: string;
  notes?: string;
}

export interface PreparationConfig {
  enabled: boolean;
  title: string;
  durationMinutes: number;
}

export interface ExamSection {
  id: string;
  title: string;
  durationMinutes: number;
  description?: string;
  color: string;
  icon: ExamIconName;
  position?: number;
  pauseAfter: boolean;
  breakDurationMinutes: number;
}

export interface BreakSection {
  id: string;
  title: string;
  durationMinutes: number;
  sourceSectionId: string;
}

export interface ExamSegment {
  id: string;
  kind: ExamSegmentKind;
  title: string;
  durationMinutes: number;
  description?: string;
  color: string;
  icon: ExamIconName;
  sourceSectionId?: string;
}

export interface SegmentProgress {
  segmentId: string;
  status: SegmentProgressStatus;
  actualStart?: string;
  actualEnd?: string;
  elapsedBeforeRunMs: number;
  runningSince?: string | null;
}

export interface TimerState {
  status: ExamTimerStatus;
  activeSegmentId: string | null;
  progress: Record<string, SegmentProgress>;
  updatedAt: string;
}

export interface ExamSession {
  id: string;
  label: string;
  general: ExamGeneralData;
  preparation: PreparationConfig;
  sections: ExamSection[];
  timer: TimerState;
  createdAt: string;
  updatedAt: string;
}

export interface ExamTemplate {
  id: string;
  name: string;
  description: string;
  session: ExamSession;
  builtIn?: boolean;
  createdAt: string;
}

export interface SplitScreenSession {
  mode: ExamTimerMode;
  activePane: ExamPaneId;
  boardMode: boolean;
  highContrast: boolean;
  syncControlEnabled: boolean;
  syncNotice?: string | null;
  sessions: Record<ExamPaneId, ExamSession>;
  setup: {
    step: ExamSetupStep;
    selectedMode: ExamTimerMode | null;
    committed: Record<ExamPaneId, boolean>;
    flash?: string | null;
  };
}

export type ScheduleStatus = 'wartet' | 'läuft' | 'pausiert' | 'überzogen' | 'abgeschlossen' | 'übersprungen';

export interface ScheduleRow {
  segment: ExamSegment;
  baselineStart: Date;
  baselineEnd: Date;
  projectedStart: Date;
  projectedEnd: Date;
  actualStart?: Date;
  actualEnd?: Date;
  status: ScheduleStatus;
  delayMs: number;
  overtimeMs: number;
  driftMs: number;
}
