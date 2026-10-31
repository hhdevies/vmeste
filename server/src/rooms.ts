import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type {
  ChatMessage,
  HostStateInput,
  PlaybackState,
  RoomInfo,
  RoomSnapshot,
  Subtitles,
  VideoSource,
  Viewer,
  ViewerReport,
  ViewerStatus,
} from '../../shared/protocol.js';

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // без 0/o/1/l/i — удобно диктовать
const COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#a3e635'];
/** Порог (сек), после которого зритель считается «отстаёт»/«впереди» */
export const DRIFT_STATUS_THRESHOLD = 3;
const MAX_MESSAGES = 200;
/** Сколько ждём переподключения участника, прежде чем удалить его из комнаты */
const MEMBER_GRACE_MS = 30_000;

export function genId(len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return s;
}

const sha = (s: string) => createHash('sha256').update(s).digest();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Member {
  /** clientId — стабилен между переподключениями (sessionStorage вкладки) */
  id: string;
  name: string;
  color: string;
  joinedAt: number;
  socketId: string | null;
  report: (ViewerReport & { at: number }) | null;
  removeTimer?: NodeJS.Timeout;
}

export type HostChange = 'play' | 'pause' | 'seek' | 'rate' | null;

export class Room {
  readonly members = new Map<string, Member>();
  hostId: string | null = null;
  state: PlaybackState = { playing: false, position: 0, rate: 1, updatedAt: Date.now(), seq: 0 };
  messages: ChatMessage[] = [];
  subtitles: Subtitles | null = null;
  /** Когда комната опустела (для сборщика мусора) */
  emptySince: number | null = Date.now();
  /** Нужно ли разослать список зрителей на ближайшем тике */
  viewersDirty = false;
  private readonly passwordHash: Buffer | null;
  private colorIdx = 0;

  constructor(
    readonly id: string,
    public name: string,
    public source: VideoSource,
    password?: string,
  ) {
    this.passwordHash = password ? sha(password) : null;
  }

  get hasPassword() {
    return this.passwordHash !== null;
  }

  checkPassword(p?: string): boolean {
    if (!this.passwordHash) return true;
    if (!p) return false;
    return timingSafeEqual(this.passwordHash, sha(p));
  }

  /** Где «должно» быть видео в момент at (серверное время) */
  expectedPosition(at = Date.now()): number {
    const s = this.state;
    return s.playing ? s.position + ((at - s.updatedAt) / 1000) * s.rate : s.position;
  }

  onlineCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.socketId) n++;
    return n;
  }

  upsertMember(id: string, name: string, socketId: string): { member: Member; isNew: boolean } {
    let m = this.members.get(id);
    const isNew = !m;
    if (m) {
      clearTimeout(m.removeTimer);
      m.removeTimer = undefined;
      m.name = name;
      m.socketId = socketId;
    } else {
      m = { id, name, color: COLORS[this.colorIdx++ % COLORS.length], joinedAt: Date.now(), socketId, report: null };
      this.members.set(id, m);
    }
    if (!this.hostId || !this.members.has(this.hostId)) this.hostId = id;
    this.emptySince = null;
    this.viewersDirty = true;
    return { member: m, isNew };
  }

  /** Сокет отвалился: держим место MEMBER_GRACE_MS, потом onRemove */
  markOffline(id: string, onRemove: () => void) {
    const m = this.members.get(id);
    if (!m) return;
    m.socketId = null;
    m.removeTimer = setTimeout(onRemove, MEMBER_GRACE_MS);
    if (this.onlineCount() === 0) this.emptySince = Date.now();
    this.viewersDirty = true;
  }

  /** Удаляет участника; возвращает true, если хост сменился */
  removeMember(id: string): boolean {
    const m = this.members.get(id);
    if (m) clearTimeout(m.removeTimer);
    this.members.delete(id);
    this.viewersDirty = true;
    if (this.hostId !== id) return false;
    const rest = [...this.members.values()].sort(
      (a, b) => Number(!!b.socketId) - Number(!!a.socketId) || a.joinedAt - b.joinedAt,
    );
    this.hostId = rest[0]?.id ?? null;
    return this.hostId !== null;
  }

  setHost(id: string): boolean {
    if (!this.members.has(id) || this.hostId === id) return false;
    this.hostId = id;
    this.viewersDirty = true;
    return true;
  }

  /** Применяет команду хоста; возвращает тип изменения для системного сообщения */
  applyHostState(input: HostStateInput): HostChange {
    const prev = this.state;
    const prevExpected = this.expectedPosition();
    const next: PlaybackState = {
      playing: !!input.playing,
      position: clamp(Number(input.position) || 0, 0, 1e7),
      rate: clamp(Number(input.rate) || 1, 0.25, 4),
      updatedAt: Date.now(),
      seq: prev.seq + 1,
    };
    this.state = next;
    if (prev.playing !== next.playing) return next.playing ? 'play' : 'pause';
    if (Math.abs(prevExpected - next.position) > 2) return 'seek';
    if (prev.rate !== next.rate) return 'rate';
    return null;
  }

  resetPlayback() {
    this.state = { playing: false, position: 0, rate: 1, updatedAt: Date.now(), seq: this.state.seq + 1 };
    for (const m of this.members.values()) m.report = null;
  }

  report(id: string, r: ViewerReport) {
    const m = this.members.get(id);
    if (!m) return;
    const status = (['playing', 'paused', 'buffering', 'idle'] as const).includes(r.status) ? r.status : 'idle';
    m.report = { position: clamp(Number(r.position) || 0, 0, 1e7), status, at: Date.now() };
    this.viewersDirty = true;
  }

  viewers(): Viewer[] {
    const now = Date.now();
    const expected = this.expectedPosition(now);
    return [...this.members.values()]
      .sort((a, b) => Number(b.id === this.hostId) - Number(a.id === this.hostId) || a.joinedAt - b.joinedAt)
      .map((m) => {
        const r = m.report;
        let position = r?.position ?? 0;
        let status: ViewerStatus = 'idle';
        let drift = 0;
        if (!m.socketId) status = 'offline';
        else if (r) {
          // Экстраполируем позицию играющего зрителя на «сейчас»
          if (r.status === 'playing') position += ((now - r.at) / 1000) * this.state.rate;
          drift = position - expected;
          if (r.status === 'buffering') status = 'buffering';
          else if (r.status === 'idle') status = 'idle';
          else if (drift < -DRIFT_STATUS_THRESHOLD) status = 'behind';
          else if (drift > DRIFT_STATUS_THRESHOLD) status = 'ahead';
          else status = r.status === 'paused' ? 'paused' : 'watching';
        }
        return {
          id: m.id,
          name: m.name,
          color: m.color,
          isHost: m.id === this.hostId,
          online: !!m.socketId,
          position,
          drift,
          status,
        };
      });
  }

  pushMessage(m: Omit<ChatMessage, 'id' | 'at'>): ChatMessage {
    const msg: ChatMessage = { ...m, id: genId(12), at: Date.now() };
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    return msg;
  }

  snapshot(): RoomSnapshot {
    return {
      id: this.id,
      name: this.name,
      hasPassword: this.hasPassword,
      source: this.source,
      state: this.state,
      hostId: this.hostId,
      viewers: this.viewers(),
      messages: this.messages.slice(-100),
      subtitles: this.subtitles,
    };
  }

  info(): RoomInfo {
    return { id: this.id, name: this.name, hasPassword: this.hasPassword, viewers: this.onlineCount() };
  }
}

/** In-memory хранилище. Для нескольких инстансов — см. README, раздел «Масштабирование». */
export class RoomStore {
  private rooms = new Map<string, Room>();

  create(name: string, source: VideoSource, password?: string): Room {
    let id = genId();
    while (this.rooms.has(id)) id = genId();
    const room = new Room(id, name, source, password);
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  all(): IterableIterator<Room> {
    return this.rooms.values();
  }

  /** Удаляем комнаты, пустующие дольше ttlMs */
  sweep(ttlMs: number) {
    const now = Date.now();
    for (const [id, r] of this.rooms) {
      if (r.emptySince !== null && now - r.emptySince > ttlMs) {
        for (const m of r.members.values()) clearTimeout(m.removeTimer);
        this.rooms.delete(id);
      }
    }
  }
}
