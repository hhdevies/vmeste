/**
 * Единый интерфейс плеера. Логика синхронизации работает только с ним,
 * поэтому добавить новый источник (Vimeo, Twitch, Kinescope…) = написать ещё один адаптер.
 */
export interface PlayerAdapter {
  /** Может ли плеер плавно менять скорость (0.93×, 1.04×) для мягкой подстройки */
  readonly supportsFineRate: boolean;
  /** Отклоняется с ошибкой name === 'NotAllowedError', если браузер заблокировал автоплей */
  play(): Promise<void>;
  pause(): void;
  seek(t: number): void;
  setRate(r: number): void;
  getRate(): number;
  getTime(): number;
  /** 0 — неизвестно / прямой эфир */
  getDuration(): number;
  isPaused(): boolean;
  isBuffering(): boolean;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  destroy(): void;
}

export type AdapterEvent = 'ready' | 'error';
export type AdapterEmit = (e: AdapterEvent, message?: string) => void;
