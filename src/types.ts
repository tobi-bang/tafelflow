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
  /** Live-Abstimmung */
  livePoll: boolean;
  /** Peer-Feedback */
  peerFeedback: boolean;
  /** Pictureload: Bilder hochladen (Bilderwand) */
  pictureload: boolean;
  /** Pictureload: SuS-Uploads erst nach Lehrkraft-Freigabe für alle sichtbar (Moderation). */
  pictureloadModeration: boolean;
  /**
   * Wenn true: SuS geben bei Beitritt einen Anzeigenamen an (sichtbar bei Ideen).
   * Wenn false: Name optional; Ideen ohne Namenszeile übersichtlicher.
   */
  ideasRequireDisplayName: boolean;
  /** Standard-display_scale (0.5–4) für neu erstellte Ideenkarten. */
  ideasDefaultScale: number;
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
  type: 'path' | 'text' | 'shape' | 'module' | 'board_page' | 'board_meta';
  data: unknown;
  color: string;
  authorId: string;
  createdAt: string;
}

export interface BoardModule {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
  data: BoardModuleData;
}

export interface BoardPage {
  id: string;
  title: string;
  order: number;
}

export type BoardRole = 'teacher' | 'student';

export interface BoardModuleData {
  pageId?: string;
  zIndex?: number;
  title?: string;
  text?: string;
  /** Schriftgröße im Textmodul (px), z. B. 18–32 für Tafel / Beamer. */
  textFontSizePx?: number;
  /** Lehrkraft-Freigabe: SuS dürfen Inhalt bearbeiten (bei freigegebenen Modulen). */
  editableByStudents?: boolean;
  [key: string]: unknown;
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
  /** Anzeigegröße auf dem Board (Skalierung, typ. 0.5–4) */
  displayScale: number;
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

export type PictureloadModerationStatus = 'pending' | 'approved' | 'rejected';

/** Eintrag in der Pictureload-Bilderwand (Datei liegt in Supabase Storage). */
export interface PictureloadImage {
  id: string;
  sessionId: string;
  storagePath: string;
  authorId: string;
  authorDisplayName: string | null;
  contentType: string;
  createdAt: string;
  moderationStatus: PictureloadModerationStatus;
}

/** Minimaler App-Nutzer (Supabase Auth, meist anonym) */
export interface AppUser {
  id: string;
  displayName: string | null;
}
