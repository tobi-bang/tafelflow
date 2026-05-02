import type { ExamSection, ExamSession, ExamTemplate } from './types';

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextHourTime(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

export function createExamSection(partial: Partial<ExamSection> = {}): ExamSection {
  return {
    id: partial.id ?? makeId('section'),
    title: partial.title ?? 'Prüfungsteil',
    durationMinutes: partial.durationMinutes ?? 45,
    description: partial.description ?? '',
    color: partial.color ?? '#2563eb',
    icon: partial.icon ?? 'book',
    position: partial.position,
    pauseAfter: partial.pauseAfter ?? false,
    breakDurationMinutes: partial.breakDurationMinutes ?? 15,
  };
}

export function createDefaultExamSession(label = 'Prüfung A'): ExamSession {
  const now = new Date().toISOString();
  return {
    id: makeId('exam'),
    label,
    general: {
      profession: '',
      examType: 'Schulprüfung',
      examDate: todayIsoDate(),
      plannedStartTime: nextHourTime(),
      room: '',
      notes: '',
    },
    preparation: {
      enabled: true,
      title: 'Vorbereitungszeit',
      durationMinutes: 10,
    },
    sections: [
      createExamSection({
        title: 'Prüfungsteil 1',
        durationMinutes: 45,
        color: '#2563eb',
        icon: 'book',
        pauseAfter: false,
      }),
    ],
    timer: {
      status: 'setup',
      activeSegmentId: null,
      progress: {},
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createMalerExamTemplate(): ExamTemplate {
  const session = createDefaultExamSession('Maler und Lackierer – Prüfung Teil 2');
  session.general = {
    profession: 'Maler und Lackierer',
    examType: 'Prüfung Teil 2',
    examDate: todayIsoDate(),
    plannedStartTime: '08:10',
    room: '',
    notes: '',
  };
  session.preparation = {
    enabled: true,
    title: 'Kundenauftrag lesen',
    durationMinutes: 10,
  };
  session.sections = [
    createExamSection({
      title: 'Durchführung von Fassaden-, Raum- und Objektgestaltungen',
      durationMinutes: 75,
      description: '',
      color: '#2563eb',
      icon: 'palette',
      pauseAfter: true,
      breakDurationMinutes: 15,
    }),
    createExamSection({
      title: 'Durchführung von Instandhaltungs- und Bautenschutzmaßnahmen',
      durationMinutes: 75,
      description: '',
      color: '#0f766e',
      icon: 'shield',
      pauseAfter: true,
      breakDurationMinutes: 15,
    }),
    createExamSection({
      title: 'Wirtschafts- und Sozialkunde',
      durationMinutes: 60,
      description: '',
      color: '#7c3aed',
      icon: 'briefcase',
      pauseAfter: false,
      breakDurationMinutes: 0,
    }),
  ];
  return {
    id: 'maler-pruefung-teil-2',
    name: 'Maler und Lackierer – Prüfung Teil 2',
    description: 'Vorbereitung, drei Prüfungsteile und individuell einstellbare Pausen.',
    session,
    builtIn: true,
    createdAt: session.createdAt,
  };
}

export function createFahrzeuglackiererRoomTemplate(): ExamTemplate {
  const session = createDefaultExamSession('Fahrzeuglackierer – Prüfung im selben Raum');
  session.general = {
    profession: 'Fahrzeuglackierer',
    examType: 'Prüfung',
    examDate: todayIsoDate(),
    plannedStartTime: '08:10',
    room: '',
    notes: 'Geeignet für die zweite Prüfung im selben Raum / Splitscreen.',
  };
  session.preparation = {
    enabled: false,
    title: 'Vorbereitung',
    durationMinutes: 0,
  };
  session.sections = [
    createExamSection({
      title: 'Beschichtungstechnik und Gestaltung',
      durationMinutes: 180,
      description: '',
      color: '#2563eb',
      icon: 'palette',
      pauseAfter: false,
      breakDurationMinutes: 0,
    }),
    createExamSection({
      title: 'Instandsetzung und Instandhaltung',
      durationMinutes: 120,
      description: '',
      color: '#0f766e',
      icon: 'shield',
      pauseAfter: false,
      breakDurationMinutes: 0,
    }),
    createExamSection({
      title: 'Wirtschafts- und Sozialkunde',
      durationMinutes: 60,
      description: '',
      color: '#7c3aed',
      icon: 'briefcase',
      pauseAfter: false,
      breakDurationMinutes: 0,
    }),
  ];
  return {
    id: 'fahrzeuglackierer-pruefung-selber-raum',
    name: 'Fahrzeuglackierer – Prüfung im selben Raum',
    description: 'Zweite Prüfung im selben Raum / Splitscreen: drei Bereiche, Vorbereitung optional, Pausen frei einstellbar.',
    session,
    builtIn: true,
    createdAt: session.createdAt,
  };
}

export const BUILT_IN_EXAM_TEMPLATES: ExamTemplate[] = [
  createMalerExamTemplate(),
  createFahrzeuglackiererRoomTemplate(),
];

export function cloneSessionForUse(session: ExamSession, label?: string): ExamSession {
  const now = new Date().toISOString();
  return {
    ...structuredClone(session),
    id: makeId('exam'),
    label: label ?? session.label,
    timer: {
      status: 'setup',
      activeSegmentId: null,
      progress: {},
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function cloneTemplateForUse(template: ExamTemplate, label?: string): ExamSession {
  return cloneSessionForUse(template.session, label);
}

export function createTemplateFromSession(session: ExamSession, name: string): ExamTemplate {
  const now = new Date().toISOString();
  return {
    id: makeId('template'),
    name,
    description: `${session.general.profession || 'Prüfung'} · ${session.general.examType || 'Vorlage'}`,
    session: cloneSessionForUse(session, session.label),
    createdAt: now,
  };
}
