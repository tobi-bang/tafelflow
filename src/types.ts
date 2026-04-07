export type SessionStatus = 'active' | 'locked' | 'archived';

export interface SessionPermissions {
  writeBoard: boolean;
  drawBoard: boolean;
  addSticky: boolean;
  moveSticky: boolean;
  /** Fremde Ideen einer Überschrift zuordnen (Moderation, RPC assign_sticky_heading). */
  organizeBrainstorm: boolean;
  answerPoll: boolean;
  submitWord: boolean;
  /** Live-Abstimmung (lokaler Demo-State) */
  livePoll: boolean;
  /** Peer-Feedback (lokaler Demo-State) */
  peerFeedback: boolean;
}

export interface Session {
  id: string;
  room_code: string;
  name: string;
  status: SessionStatus;
  createdAt: string;
  permissions: SessionPermissions;
  /** Optimierung für Beamer/Tafel: größere Darstellung, Fokus auf LK-Bedienung */
  presentationMode: boolean;
}

export interface BoardObject {
  id: string;
  type: 'path' | 'text' | 'shape';
  data: unknown;
  color: string;
  authorId: string;
  createdAt: string;
}

export type StickyKind = 'note' | 'heading';

export interface StickyNote {
  id: string;
  content: string;
  color: string;
  authorName: string;
  authorId: string;
  x: number;
  y: number;
  status: 'pending' | 'published';
  createdAt: string;
  stickyType: StickyKind;
  underHeadingId: string | null;
}

export type PollType = 'single' | 'multiple' | 'open';

export interface Poll {
  id: string;
  question: string;
  type: PollType;
  options?: string[];
  active: boolean;
  createdAt: string;
}

export interface PollResponse {
  id: string;
  pollId: string;
  authorId: string;
  answer: string;
  createdAt: string;
}

export interface WordEntry {
  id: string;
  word: string;
  authorId: string;
  createdAt: string;
}

/** Minimaler App-Nutzer (Supabase Auth, meist anonym) */
export interface AppUser {
  id: string;
  displayName: string | null;
}
