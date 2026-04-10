import type {
  Session,
  SessionStatus,
  SessionPermissions,
  BoardObject,
  StickyNote,
  Poll,
  PollResponse,
  WordEntry,
} from '../types';

export function normalizeSessionPermissions(raw: unknown): SessionPermissions {
  const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    writeBoard: p.writeBoard !== false,
    drawBoard: p.drawBoard !== false,
    addSticky: p.addSticky !== false,
    moveSticky: p.moveSticky !== false,
    organizeBrainstorm: p.organizeBrainstorm !== false,
    answerPoll: p.answerPoll !== false,
    submitWord: p.submitWord !== false,
    livePoll: p.livePoll !== false,
    peerFeedback: p.peerFeedback !== false,
    ideasRequireDisplayName: p.ideasRequireDisplayName !== false,
    ideasDefaultScale: (() => {
      const v = p.ideasDefaultScale;
      if (typeof v === 'number' && Number.isFinite(v)) return Math.min(4, Math.max(0.5, v));
      return 1.35;
    })(),
  };
}

export function rowToSession(row: Record<string, unknown> | null): Session | null {
  if (!row || typeof row.id !== 'string') return null;
  const pres = row.presentation_mode;
  return {
    id: row.id,
    room_code: String(row.room_code ?? ''),
    name: String(row.name ?? ''),
    status: row.status as SessionStatus,
    createdAt: String(row.created_at ?? ''),
    permissions: normalizeSessionPermissions(row.permissions),
    presentationMode: pres === true,
  };
}

export function rowToBoardObject(row: Record<string, unknown>): BoardObject {
  return {
    id: String(row.id),
    type: row.type as BoardObject['type'],
    data: row.data,
    color: String(row.color ?? '#000'),
    authorId: String(row.author_id ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}

export function rowToSticky(row: Record<string, unknown>): StickyNote {
  const st = row.sticky_type;
  const stickyType: StickyNote['stickyType'] = st === 'heading' ? 'heading' : 'note';
  const uh = row.under_heading_id;
  const ds = row.display_scale;
  const displayScale =
    typeof ds === 'number' && !Number.isNaN(ds) ? Math.min(4, Math.max(0.5, ds)) : 1;
  return {
    id: String(row.id),
    content: String(row.content ?? ''),
    color: String(row.color ?? ''),
    authorName: String(row.author_name ?? 'Anonym'),
    authorId: String(row.author_id ?? ''),
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    displayScale,
    status: row.status as StickyNote['status'],
    createdAt: String(row.created_at ?? ''),
    stickyType,
    underHeadingId: typeof uh === 'string' && uh ? uh : null,
  };
}

export function rowToPoll(row: Record<string, unknown>): Poll {
  const opts = row.options;
  let options: string[] | undefined;
  if (Array.isArray(opts)) options = opts.map(String);
  else if (opts && typeof opts === 'string') {
    try {
      const p = JSON.parse(opts);
      if (Array.isArray(p)) options = p.map(String);
    } catch {
      /* ignore */
    }
  }
  return {
    id: String(row.id),
    question: String(row.question ?? ''),
    type: (row.type as Poll['type']) || 'single',
    options,
    active: Boolean(row.active),
    createdAt: String(row.created_at ?? ''),
  };
}

export function rowToPollResponse(row: Record<string, unknown>): PollResponse {
  return {
    id: String(row.id),
    pollId: String(row.poll_id ?? ''),
    authorId: String(row.author_id ?? ''),
    answer: String(row.answer ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}

export function rowToWord(row: Record<string, unknown>): WordEntry {
  return {
    id: String(row.id),
    word: String(row.word ?? ''),
    authorId: String(row.author_id ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}
