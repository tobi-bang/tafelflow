import type { BoardModule, BoardModuleData, BoardObject, BoardPage, BoardRole } from '../types';

export interface BoardPath {
  id: string;
  pageId: string;
  color: string;
  points: { x: number; y: number }[];
}

export interface BoardStateSnapshot {
  pages: BoardPage[];
  modules: BoardModule[];
  paths: BoardPath[];
}

type BoardMetaData = {
  kind?: string;
  activePageId?: string;
};

export function buildBoardState(objects: BoardObject[], activePageId: string): BoardStateSnapshot {
  const pages = objects
    .filter((o) => o.type === 'board_page')
    .map(readBoardPageFromObject)
    .filter((p): p is BoardPage => Boolean(p))
    .sort((a, b) => a.order - b.order);

  const normalizedPages = pages.length > 0 ? pages : [{ id: 'default', title: 'Seite 1', order: 0 }];

  const modules = objects
    .filter((o) => o.type === 'module')
    .map(readBoardModuleFromObject)
    .filter((m): m is BoardModule => Boolean(m))
    .filter((m) => String(m.data.pageId ?? 'default') === activePageId)
    .sort((a, b) => Number(a.data.zIndex ?? 1) - Number(b.data.zIndex ?? 1));

  const paths = objects
    .filter((o) => o.type === 'path')
    .map(readBoardPathFromObject)
    .filter((p): p is BoardPath => Boolean(p))
    .filter((p) => p.pageId === activePageId);

  return { pages: normalizedPages, modules, paths };
}

export function readBoardModuleFromObject(obj: BoardObject): BoardModule | null {
  const raw = obj.data as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return null;
  const type = typeof raw.type === 'string' ? raw.type : 'unknown';
  return {
    id: obj.id,
    type,
    x: Number(raw.x ?? 80),
    y: Number(raw.y ?? 120),
    width: Number(raw.width ?? 380),
    height: Number(raw.height ?? 260),
    locked: Boolean(raw.locked),
    data: ((raw.data as BoardModuleData | undefined) ?? {
      pageId: 'default',
      editableByStudents: false,
    }) as BoardModuleData,
  };
}

export function readBoardPageFromObject(obj: BoardObject): BoardPage | null {
  if (obj.type !== 'board_page') return null;
  const d = obj.data as Record<string, unknown>;
  const id = typeof d.id === 'string' ? d.id : null;
  if (!id) return null;
  return {
    id,
    title: typeof d.title === 'string' && d.title.trim() ? d.title : 'Seite',
    order: Number(d.order ?? 0),
  };
}

export function readBoardPathFromObject(obj: BoardObject): BoardPath | null {
  if (obj.type !== 'path') return null;
  const d = obj.data as Record<string, unknown>;
  const points = readPathPoints(obj.data);
  return {
    id: obj.id,
    pageId: String(d?.pageId ?? 'default'),
    color: obj.color,
    points,
  };
}

export function readPathPoints(data: unknown): { x: number; y: number }[] {
  if (Array.isArray(data)) return data as { x: number; y: number }[];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d?.points)) return d.points as { x: number; y: number }[];
  return [];
}

export function getObjectPageId(obj: BoardObject): string {
  if (obj.type === 'module') {
    const raw = obj.data as Record<string, unknown>;
    const inner = raw.data as Record<string, unknown> | undefined;
    return String(inner?.pageId ?? 'default');
  }
  if (obj.type === 'path') {
    const d = obj.data as Record<string, unknown>;
    return String(d?.pageId ?? 'default');
  }
  return 'default';
}

export function canTeacherManageModule(role: BoardRole): boolean {
  return role === 'teacher';
}

export function canStudentEditModuleContent(role: BoardRole, module: BoardModule): boolean {
  return (
    role === 'student' &&
    module.type === 'text' &&
    module.locked !== true &&
    module.data.editableByStudents === true
  );
}

export function readBoardMetaData(obj: BoardObject): BoardMetaData | null {
  if (obj.type !== 'board_meta') return null;
  const data = obj.data as Record<string, unknown>;
  return {
    kind: typeof data?.kind === 'string' ? data.kind : undefined,
    activePageId: typeof data?.activePageId === 'string' ? data.activePageId : undefined,
  };
}

export function getSyncedActivePageId(objects: BoardObject[]): string | null {
  const meta = objects.find((o) => {
    if (o.type !== 'board_meta') return false;
    const data = o.data as Record<string, unknown>;
    return data?.kind === 'board_session';
  });
  if (!meta) return null;
  const data = readBoardMetaData(meta);
  return data?.activePageId ?? null;
}
