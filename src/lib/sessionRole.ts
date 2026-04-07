export type SessionViewRole = 'teacher' | 'student';

/**
 * Effektive Rolle in der Sitzung: Lehrkraft kann die SuS-Ansicht zur Vorschau simulieren.
 */
export function getEffectiveSessionRole(
  isTeacherFromMembership: boolean,
  previewAsStudent: boolean
): SessionViewRole {
  if (isTeacherFromMembership && !previewAsStudent) return 'teacher';
  return 'student';
}

export function isEffectiveTeacher(
  isTeacherFromMembership: boolean,
  previewAsStudent: boolean
): boolean {
  return getEffectiveSessionRole(isTeacherFromMembership, previewAsStudent) === 'teacher';
}

const STORAGE_KEY = 'tafelflow-preview-as-student';

export function readPreviewAsStudentPreference(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writePreviewAsStudentPreference(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, '1');
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
