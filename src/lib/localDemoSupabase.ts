/**
 * Lokales Demo-Backend: keine Cloud, Daten im Browser (sessionStorage).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const STORE_KEY = 'tafelflow_local_demo_store_v1';
const AUTH_UID_KEY = 'tafelflow_local_demo_auth_uid';
const META_KEY = 'tafelflow_demo_meta';

type Row = Record<string, unknown>;

interface DemoStore {
  sessions: Row[];
  session_members: Row[];
  board_objects: Row[];
  stickies: Row[];
  polls: Row[];
  poll_responses: Row[];
  words: Row[];
  session_pins: Record<string, string>;
}

function emptyStore(): DemoStore {
  return {
    sessions: [],
    session_members: [],
    board_objects: [],
    stickies: [],
    polls: [],
    poll_responses: [],
    words: [],
    session_pins: {},
  };
}

function loadStore(): DemoStore {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return emptyStore();
    const p = JSON.parse(raw) as DemoStore;
    return { ...emptyStore(), ...p, session_pins: p.session_pins || {} };
  } catch {
    return emptyStore();
  }
}

function saveStore() {
  sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
}

let store = loadStore();

function persist() {
  saveStore();
}

function newId() {
  return crypto.randomUUID();
}

function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

type TableName = keyof Omit<DemoStore, 'session_pins'>;

function tableRows(t: TableName): Row[] {
  return store[t] as Row[];
}

function setTableRows(t: TableName, rows: Row[]) {
  (store[t] as Row[]) = rows;
}

type ChanListener = { table: string; filter?: string; cb: (payload: unknown) => void };
const channels = new Map<object, { name: string; listeners: ChanListener[] }>();

function parseFilter(filter: string | undefined): { col: string; val: string } | null {
  if (!filter) return null;
  const m = filter.match(/^(\w+)=eq\.(.+)$/);
  if (!m) return null;
  return { col: m[1], val: m[2] };
}

function rowMatches(row: Row, filter?: string): boolean {
  const p = parseFilter(filter);
  if (!p) return true;
  return String(row[p.col] ?? '') === p.val;
}

function notify(table: string, filter: string | undefined, row?: Row) {
  for (const { listeners } of channels.values()) {
    for (const L of listeners) {
      if (L.table !== table) continue;
      if (!rowMatches(row || {}, L.filter)) continue;
      L.cb({ eventType: '*', new: row });
    }
  }
}

function getAuthUid(): string | null {
  return sessionStorage.getItem(AUTH_UID_KEY);
}

function setAuthUid(id: string) {
  sessionStorage.setItem(AUTH_UID_KEY, id);
}

const authListeners = new Set<(e: string, session: { user: Row } | null) => void>();

function emitAuth(session: { user: Row } | null) {
  for (const fn of authListeners) fn('LOCAL_DEMO', session);
}

class SelectBuilder {
  private filters: { col: string; val: string }[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;

  constructor(
    private table: TableName,
    private fields: string
  ) {}

  eq(col: string, val: string | number) {
    this.filters.push({ col, val: String(val) });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  private filterRows(rows: Row[]): Row[] {
    let r = rows;
    for (const f of this.filters) {
      r = r.filter((x) => String(x[f.col] ?? '') === f.val);
    }
    if (this.orderCol) {
      r = [...r].sort((a, b) => {
        const cmp = String(a[this.orderCol!]).localeCompare(String(b[this.orderCol!]));
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.fields.includes('sessions(*)') && this.table === 'session_members') {
      return r.map((m) => {
        const sid = String(m.session_id);
        const sess = store.sessions.find((s) => String(s.id) === sid) ?? null;
        return { ...m, sessions: sess };
      });
    }
    return r;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: Error | null }> {
    const rows = this.filterRows([...tableRows(this.table)]);
    return { data: (rows[0] as Row) ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: Error | null }> {
    const rows = this.filterRows([...tableRows(this.table)]);
    if (rows.length !== 1) return { data: null, error: new Error('PGRST116') };
    return { data: rows[0] as Row, error: null };
  }

  then<TResult1 = { data: Row[]; error: Error | null }>(
    onfulfilled?: (value: { data: Row[]; error: Error | null }) => TResult1 | PromiseLike<TResult1>
  ): Promise<TResult1> {
    return Promise.resolve(this.runMany()).then(onfulfilled as (v: { data: Row[]; error: Error | null }) => TResult1);
  }

  private runMany(): { data: Row[]; error: Error | null } {
    return { data: this.filterRows([...tableRows(this.table)]) as Row[], error: null };
  }
}

class UpdateBuilder {
  private filters: { col: string; val: string }[] = [];

  constructor(
    private table: TableName,
    private patch: Row
  ) {}

  eq(col: string, val: string | number) {
    this.filters.push({ col, val: String(val) });
    return this;
  }

  then(
    onfulfilled?: (value: { data: Row | null; error: Error | null }) => unknown
  ): Promise<{ data: Row | null; error: Error | null }> {
    return Promise.resolve(this.exec()).then(onfulfilled as (v: { data: Row | null; error: Error | null }) => unknown) as Promise<{
      data: Row | null;
      error: Error | null;
    }>;
  }

  private exec(): { data: Row | null; error: Error | null } {
    const arr = tableRows(this.table);
    const idx = arr.findIndex((r) => this.filters.every((f) => String(r[f.col] ?? '') === f.val));
    if (idx < 0) return { data: null, error: new Error('Not found') };
    arr[idx] = { ...arr[idx], ...this.patch };
    setTableRows(this.table, arr);
    persist();
    const row = arr[idx];
    notify(this.table, `id=eq.${row.id}`, row);
    if (this.table === 'stickies') notify('stickies', `session_id=eq.${row.session_id}`, row);
    if (this.table === 'polls') notify('polls', `session_id=eq.${row.session_id}`, row);
    if (this.table === 'sessions') notify('sessions', `id=eq.${row.id}`, row);
    return { data: row, error: null };
  }
}

class DeleteBuilder {
  private filters: { col: string; val: string }[] = [];

  constructor(private table: TableName) {}

  eq(col: string, val: string | number) {
    this.filters.push({ col, val: String(val) });
    return this;
  }

  then(onfulfilled?: (value: { data: unknown; error: Error | null }) => unknown): Promise<{ data: unknown; error: Error | null }> {
    return Promise.resolve(this.exec()).then(onfulfilled as (v: { data: unknown; error: Error | null }) => unknown) as Promise<{
      data: unknown;
      error: Error | null;
    }>;
  }

  private match(r: Row) {
    return this.filters.every((f) => String(r[f.col] ?? '') === f.val);
  }

  private exec(): { data: unknown; error: Error | null } {
    if (this.table === 'sessions') {
      const hits = store.sessions.filter((r) => this.match(r));
      for (const s of hits) {
        const sid = String(s.id);
        delete store.session_pins[sid];
        store.session_members = store.session_members.filter((m) => String(m.session_id) !== sid);
        store.board_objects = store.board_objects.filter((b) => String(b.session_id) !== sid);
        store.stickies = store.stickies.filter((x) => String(x.session_id) !== sid);
        store.polls = store.polls.filter((p) => String(p.session_id) !== sid);
        store.poll_responses = store.poll_responses.filter((p) => String(p.session_id) !== sid);
        store.words = store.words.filter((w) => String(w.session_id) !== sid);
        notify('sessions', `id=eq.${sid}`, s);
      }
      store.sessions = store.sessions.filter((r) => !this.match(r));
      persist();
      return { data: null, error: null };
    }

    const arr = tableRows(this.table);
    const hit = arr.find((r) => this.match(r));
    setTableRows(
      this.table,
      arr.filter((r) => !this.match(r))
    );
    persist();
    if (hit) {
      if (this.table === 'board_objects') notify('board_objects', `session_id=eq.${hit.session_id}`, hit);
      if (this.table === 'stickies') notify('stickies', `session_id=eq.${hit.session_id}`, hit);
      if (this.table === 'poll_responses') {
        notify('poll_responses', `session_id=eq.${hit.session_id}`, hit);
      }
      if (this.table === 'polls') {
        const pid = String(hit.id);
        store.poll_responses = store.poll_responses.filter((r) => String(r.poll_id) !== pid);
        notify('polls', `session_id=eq.${hit.session_id}`, hit);
        persist();
      }
      if (this.table === 'words') notify('words', `session_id=eq.${hit.session_id}`, hit);
    }
    return { data: null, error: null };
  }
}

async function insertRows(table: TableName, payload: Row | Row[]): Promise<{ data: Row[]; error: Error | null }> {
  const list = Array.isArray(payload) ? payload : [payload];
  const out: Row[] = [];
  for (const raw of list) {
    const row: Row = { ...raw, id: (raw.id as string) || newId() };
    if (!row.created_at) row.created_at = new Date().toISOString();
    tableRows(table).push(row);
    out.push(row);
    if (table === 'session_members') {
      notify('session_members', `user_id=eq.${row.user_id}`, row);
    } else if (row.session_id != null) {
      notify(table, `session_id=eq.${row.session_id}`, row);
    }
    if (table === 'sessions') notify('sessions', `id=eq.${row.id}`, row);
  }
  persist();
  return { data: out, error: null };
}

async function rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: Error | null }> {
  const uid = getAuthUid();

  if (name === 'get_session_join_preview') {
    const code = String(params.p_room_code ?? '').toUpperCase().trim();
    const s = store.sessions.find((x) => String(x.room_code).toUpperCase() === code);
    if (!s) return { data: [], error: null };
    if (String(s.status) !== 'active') return { data: [], error: null };
    return { data: [{ session_id: s.id, session_name: s.name }], error: null };
  }

  if (!uid) return { data: null, error: new Error('Nicht angemeldet') };

  if (name === 'create_session') {
    const sessionId = newId();
    let code = randomRoomCode();
    while (store.sessions.some((x) => String(x.room_code) === code)) code = randomRoomCode();
    const session: Row = {
      id: sessionId,
      room_code: code,
      name: String(params.p_name ?? '').trim(),
      status: 'active',
      presentation_mode: false,
      permissions: {
        writeBoard: true,
        drawBoard: true,
        addSticky: true,
        moveSticky: true,
        organizeBrainstorm: true,
        answerPoll: true,
        submitWord: true,
      },
      created_at: new Date().toISOString(),
    };
    store.sessions.push(session);
    store.session_pins[sessionId] = String(params.p_pin ?? '');
    const mem: Row = {
      session_id: sessionId,
      user_id: uid,
      role: 'teacher',
      display_name: 'Lehrkraft',
    };
    store.session_members.push(mem);
    persist();
    notify('session_members', `user_id=eq.${uid}`, mem);
    notify('sessions', `id=eq.${sessionId}`, session);
    return { data: [{ session_id: sessionId, room_code: code }], error: null };
  }

  if (name === 'join_session_as_student') {
    const code = String(params.p_room_code ?? '').toUpperCase().trim();
    const s = store.sessions.find((x) => String(x.room_code).toUpperCase() === code);
    if (!s) return { data: null, error: new Error('Sitzung nicht gefunden') };
    if (String(s.status) !== 'active') return { data: null, error: new Error('Sitzung ist beendet') };
    const sid = String(s.id);
    const existing = store.session_members.find((m) => String(m.session_id) === sid && String(m.user_id) === uid);
    if (existing) {
      if (String(existing.role) !== 'teacher') {
        existing.display_name = String(params.p_display_name ?? '').trim();
      }
    } else {
      store.session_members.push({
        session_id: sid,
        user_id: uid,
        role: 'student',
        display_name: String(params.p_display_name ?? '').trim(),
      });
    }
    persist();
    notify('session_members', `user_id=eq.${uid}`, existing || store.session_members.at(-1)!);
    return { data: sid, error: null };
  }

  if (name === 'join_session_as_teacher') {
    const code = String(params.p_room_code ?? '').toUpperCase().trim();
    const s = store.sessions.find((x) => String(x.room_code).toUpperCase() === code);
    if (!s) return { data: null, error: new Error('Sitzung nicht gefunden') };
    const sid = String(s.id);
    if (store.session_pins[sid] !== String(params.p_pin ?? '')) {
      return { data: null, error: new Error('Falsche PIN') };
    }
    let existing = store.session_members.find((m) => String(m.session_id) === sid && String(m.user_id) === uid);
    if (existing) {
      existing.role = 'teacher';
      existing.display_name = 'Lehrkraft';
    } else {
      existing = {
        session_id: sid,
        user_id: uid,
        role: 'teacher',
        display_name: 'Lehrkraft',
      };
      store.session_members.push(existing);
    }
    persist();
    notify('session_members', `user_id=eq.${uid}`, existing);
    return { data: sid, error: null };
  }

  if (name === 'assign_sticky_heading') {
    const stickyId = String(params.p_sticky_id ?? '');
    const underRaw = params.p_under_heading_id;
    const underId = underRaw === null || underRaw === undefined || underRaw === '' ? null : String(underRaw);
    const row = store.stickies.find((s) => String(s.id) === stickyId);
    if (!row || String(row.sticky_type ?? 'note') !== 'note') {
      return { data: null, error: new Error('Ungültige Karte') };
    }
    const sid = String(row.session_id);
    const sess = store.sessions.find((s) => String(s.id) === sid);
    const isTeacher = store.session_members.some(
      (m) => String(m.session_id) === sid && String(m.user_id) === uid && m.role === 'teacher'
    );
    const perms = (sess?.permissions ?? {}) as Record<string, boolean>;
    const canOrganize =
      Boolean(perms.organizeBrainstorm !== false) && Boolean(perms.moveSticky !== false);
    const member = store.session_members.some((m) => String(m.session_id) === sid && String(m.user_id) === uid);
    if (underId) {
      const h = store.stickies.find((s) => String(s.id) === underId);
      if (!h || String(h.session_id) !== sid || String(h.sticky_type ?? 'note') !== 'heading') {
        return { data: null, error: new Error('Ungültige Überschrift') };
      }
    }
    if (isTeacher) {
      row.under_heading_id = underId;
      persist();
      notify('stickies', `session_id=eq.${sid}`, row);
      return { data: null, error: null };
    }
    if (String(sess?.status) === 'active' && canOrganize && member) {
      row.under_heading_id = underId;
      persist();
      notify('stickies', `session_id=eq.${sid}`, row);
      return { data: null, error: null };
    }
    return { data: null, error: new Error('Keine Berechtigung') };
  }

  return { data: null, error: new Error('Unknown RPC') };
}

function createChannel(name: string) {
  const pending: ChanListener[] = [];
  const handle = {
    on(_ev: string, config: { table?: string; filter?: string }, cb: (p: unknown) => void) {
      pending.push({ table: config.table || '', filter: config.filter, cb });
      return handle;
    },
    subscribe(cb?: (s: string) => void) {
      channels.set(handle, { name, listeners: [...pending] });
      pending.length = 0;
      cb?.('SUBSCRIBED');
      return handle;
    },
  };
  return handle;
}

function removeChannel(ch: object) {
  channels.delete(ch);
}

export function createLocalDemoSupabase(): SupabaseClient {
  const auth = {
    async getSession() {
      const id = getAuthUid();
      if (!id) return { data: { session: null }, error: null };
      const meta = JSON.parse(sessionStorage.getItem(META_KEY) || '{}') as Record<string, string>;
      return { data: { session: { user: { id, user_metadata: meta } } }, error: null };
    },
    async getUser() {
      const id = getAuthUid();
      if (!id) return { data: { user: null }, error: null };
      const meta = JSON.parse(sessionStorage.getItem(META_KEY) || '{}') as Record<string, string>;
      return { data: { user: { id, user_metadata: meta } }, error: null };
    },
    onAuthStateChange(fn: (event: string, session: { user: Row } | null) => void) {
      authListeners.add(fn);
      const id = getAuthUid();
      fn('INITIAL', id ? { user: { id, user_metadata: JSON.parse(sessionStorage.getItem(META_KEY) || '{}') } } : null);
      return {
        data: {
          subscription: {
            unsubscribe: () => authListeners.delete(fn),
          },
        },
      };
    },
    async signInAnonymously() {
      let id = getAuthUid();
      if (!id) {
        id = newId();
        setAuthUid(id);
      }
      const meta = JSON.parse(sessionStorage.getItem(META_KEY) || '{}');
      const user = { id, user_metadata: meta };
      emitAuth({ user });
      return { data: { user }, error: null };
    },
    async updateUser(opts: { data?: Record<string, unknown> }) {
      const id = getAuthUid();
      if (!id) return { data: { user: null }, error: new Error('no user') };
      const prev = JSON.parse(sessionStorage.getItem(META_KEY) || '{}') as Record<string, string>;
      const next = { ...prev, ...(opts.data as Record<string, string>) };
      sessionStorage.setItem(META_KEY, JSON.stringify(next));
      const user = { id, user_metadata: next };
      emitAuth({ user });
      return { data: { user }, error: null };
    },
  };

  const from = (table: string) => {
    const t = table as TableName;
    return {
      select(fields: string) {
        return new SelectBuilder(t, fields);
      },
      insert(payload: Row | Row[]) {
        return insertRows(t, payload);
      },
      update(patch: Row) {
        return new UpdateBuilder(t, patch);
      },
      delete() {
        return new DeleteBuilder(t);
      },
    };
  };

  return {
    auth,
    from,
    rpc,
    channel: createChannel,
    removeChannel,
  } as unknown as SupabaseClient;
}
