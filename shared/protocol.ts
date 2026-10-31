// Общий протокол клиент <-> сервер. Только типы: импортируется через `import type`
// и из server/, и из client/, поэтому в рантайме ничего не тянет.

export type SourceKind = 'youtube' | 'hls' | 'file';

export interface VideoSource {
  kind: SourceKind;
  /** Прямая ссылка на медиа (для youtube — исходная ссылка) */
  url: string;
  /** id ролика для youtube */
  videoId?: string;
  title?: string;
}

/**
 * Авторитетное состояние воспроизведения комнаты.
 * Позиция «в любой момент» = position + (now - updatedAt) * rate, если playing.
 * updatedAt — СЕРВЕРНОЕ время (мс), клиенты переводят его через ServerClock.
 */
export interface PlaybackState {
  playing: boolean;
  position: number;
  rate: number;
  updatedAt: number;
  seq: number;
}

export type HostStateInput = Pick<PlaybackState, 'playing' | 'position' | 'rate'>;

/** Что клиент сообщает о себе раз в секунду */
export type LocalStatus = 'playing' | 'paused' | 'buffering' | 'idle';
export interface ViewerReport {
  position: number;
  status: LocalStatus;
}

/** Что сервер рассылает о каждом зрителе (статус считается на сервере) */
export type ViewerStatus = 'watching' | 'paused' | 'buffering' | 'behind' | 'ahead' | 'idle' | 'offline';
export interface Viewer {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  online: boolean;
  position: number;
  /** На сколько секунд зритель впереди (+) или позади (−) комнаты */
  drift: number;
  status: ViewerStatus;
}

export interface ChatMessage {
  id: string;
  kind: 'text' | 'system';
  authorId?: string;
  author?: string;
  color?: string;
  text: string;
  at: number;
}

export interface Subtitles {
  name: string;
  /** Текст .srt или .vtt */
  text: string;
}

export interface RoomSnapshot {
  id: string;
  name: string;
  hasPassword: boolean;
  source: VideoSource;
  state: PlaybackState;
  hostId: string | null;
  viewers: Viewer[];
  messages: ChatMessage[];
  subtitles: Subtitles | null;
}

export interface RoomInfo {
  id: string;
  name: string;
  hasPassword: boolean;
  viewers: number;
}

export type AckResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServer {
  'time:ping': (clientNow: number, ack: (serverNow: number) => void) => void;
  'room:create': (
    p: { name: string; password?: string; source: VideoSource },
    ack: (r: AckResult<{ roomId: string }>) => void,
  ) => void;
  'room:join': (
    p: { roomId: string; clientId: string; nickname: string; password?: string },
    ack: (r: AckResult<{ room: RoomSnapshot }>) => void,
  ) => void;
  'host:state': (s: HostStateInput) => void;
  'host:transfer': (viewerId: string) => void;
  'host:source': (source: VideoSource) => void;
  'viewer:report': (r: ViewerReport) => void;
  'chat:send': (text: string) => void;
  'chat:react': (emoji: string) => void;
  'subs:set': (subs: Subtitles | null) => void;
}

export interface ServerToClient {
  state: (s: PlaybackState) => void;
  viewers: (viewers: Viewer[], hostId: string | null) => void;
  chat: (m: ChatMessage) => void;
  reaction: (r: { emoji: string; from: string; color: string }) => void;
  source: (s: VideoSource) => void;
  subs: (s: Subtitles | null) => void;
}
