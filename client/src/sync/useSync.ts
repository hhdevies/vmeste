import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { HostStateInput, PlaybackState } from '../../../shared/protocol';
import type { ServerClock } from '../lib/clock';
import { clamp } from '../lib/util';
import type { PlayerAdapter } from '../players';
import { socket } from '../socket';

/* ──────────────────────────────────────────────────────────────────────────
 * ЯДРО СИНХРОНИЗАЦИИ
 *
 * Хост — единственный источник истины. Он шлёт команды { playing, position, rate },
 * сервер ставит на них серверную метку updatedAt и рассылает всем.
 *
 * Зритель каждые 250 мс вычисляет, где видео ДОЛЖНО быть сейчас:
 *     expected = position + (serverNow − updatedAt) · rate      (если playing)
 * и сравнивает с фактической позицией:
 *   |drift| > HARD  → жёсткая перемотка (seek) с небольшим упреждением
 *   |drift| > SOFT  → мягкая подстройка скорости (0.9×…1.1×), незаметно для глаза
 *   иначе           → обычная скорость комнаты
 * После seek — пауза 1.5 с, чтобы не уйти в цикл перемоток, пока плеер буферизует.
 *
 * Хост вдобавок раз в 4 с шлёт «heartbeat» — свою реальную позицию, чтобы
 * у всех корректировался накопившийся дрейф (буферизация хоста, неточность rate).
 * ────────────────────────────────────────────────────────────────────────── */

const TICK_MS = 250;
const REPORT_MS = 1000;
const HEARTBEAT_MS = 4000;
const SOFT_DRIFT = 0.08; // сек
const SEEK_COOLDOWN_MS = 1500;

export function expectedPosition(s: PlaybackState, serverNow: number): number {
  return s.playing ? s.position + ((serverNow - s.updatedAt) / 1000) * s.rate : s.position;
}

export interface SyncView {
  time: number;
  duration: number;
  paused: boolean;
  buffering: boolean;
}

interface Options {
  adapter: PlayerAdapter | null;
  ready: boolean;
  isHost: boolean;
  /** Пользователь нажал «Войти в зал» — до этого браузер не даст запустить звук */
  engaged: boolean;
  stateRef: MutableRefObject<PlaybackState>;
  clock: ServerClock;
  onAutoplayBlocked: () => void;
}

export function useSync(opts: Options) {
  const o = useRef(opts);
  o.current = opts;
  const lastSeek = useRef(0);
  const lastReport = useRef(0);
  const lastBeat = useRef(0);
  const [view, setView] = useState<SyncView>({ time: 0, duration: 0, paused: true, buffering: false });

  const tryPlay = useCallback((a: PlayerAdapter) => {
    a.play().catch((e: unknown) => {
      if ((e as DOMException)?.name === 'NotAllowedError') o.current.onAutoplayBlocked();
    });
  }, []);

  /** Подогнать локальный плеер под состояние комнаты. force — без порогов и кулдауна. */
  const reconcile = useCallback(
    (force = false) => {
      const { adapter: a, ready, stateRef, clock, engaged } = o.current;
      if (!a || !ready || (!engaged && !force)) return;
      const s = stateRef.current;
      const dur = a.getDuration();
      let expected = expectedPosition(s, clock.now());
      if (dur > 0) expected = Math.min(expected, dur);

      if (s.playing && a.isPaused()) tryPlay(a);
      else if (!s.playing && !a.isPaused()) a.pause();
      if (a.isBuffering() && !force) return;

      const drift = a.getTime() - expected;
      const now = performance.now();
      const hard = a.supportsFineRate ? 1.0 : 1.5;
      const needSeek = force || Math.abs(drift) > hard || (!s.playing && Math.abs(drift) > 0.25);
      if (needSeek && (force || now - lastSeek.current > SEEK_COOLDOWN_MS)) {
        // Упреждение компенсирует время, которое плеер потратит на seek
        const lead = s.playing ? (a.supportsFineRate ? 0.15 : 0.4) * s.rate : 0;
        a.seek(Math.max(0, expected + lead));
        a.setRate(s.rate);
        lastSeek.current = now;
        return;
      }

      if (s.playing && a.supportsFineRate) {
        // P-регулятор: впереди на 0.4 с → 0.9×, позади → 1.1×
        const target = Math.abs(drift) > SOFT_DRIFT ? s.rate * (1 - clamp(drift * 0.25, -0.1, 0.1)) : s.rate;
        if (Math.abs(a.getRate() - target) > 0.004) a.setRate(target);
      } else if (a.getRate() !== s.rate) {
        a.setRate(s.rate);
      }
    },
    [tryPlay],
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const { adapter: a, ready, isHost, engaged } = o.current;
      if (!a || !ready) return;
      if (!isHost) reconcile();

      const now = performance.now();
      if (now - lastReport.current >= REPORT_MS) {
        lastReport.current = now;
        socket.emit('viewer:report', {
          position: a.getTime(),
          status: !engaged ? 'idle' : a.isBuffering() ? 'buffering' : a.isPaused() ? 'paused' : 'playing',
        });
      }

      if (isHost && engaged && now - lastBeat.current >= HEARTBEAT_MS && !a.isBuffering()) {
        lastBeat.current = now;
        const s = o.current.stateRef.current;
        // Heartbeat только уточняет позицию и никогда сам не ставит паузу:
        // плеер хоста может «стоять» из‑за медленной загрузки YouTube или фоновой вкладки.
        // Play/pause меняются только явными командами хоста (и концом фильма).
        const ended = a.getDuration() > 0 && a.getTime() >= a.getDuration() - 0.5;
        if (ended && s.playing) {
          socket.emit('host:state', { playing: false, position: a.getTime(), rate: s.rate });
        } else if (!document.hidden && s.playing === !a.isPaused()) {
          socket.emit('host:state', { playing: s.playing, position: a.getTime(), rate: s.rate });
        }
      }

      setView({ time: a.getTime(), duration: a.getDuration(), paused: a.isPaused(), buffering: a.isBuffering() });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [reconcile]);

  /** Команда хоста: применяем локально сразу (без ожидания сервера) и отправляем */
  const command = useCallback(
    (patch: Partial<HostStateInput>) => {
      const { adapter: a, stateRef, clock } = o.current;
      if (!a) return;
      const next: HostStateInput = {
        playing: patch.playing ?? !a.isPaused(),
        position: patch.position ?? a.getTime(),
        rate: patch.rate ?? stateRef.current.rate,
      };
      if (patch.position !== undefined) a.seek(next.position);
      a.setRate(next.rate);
      if (next.playing) tryPlay(a);
      else a.pause();
      stateRef.current = { ...next, updatedAt: clock.now(), seq: stateRef.current.seq };
      socket.emit('host:state', next);
      lastBeat.current = performance.now();
    },
    [tryPlay],
  );

  /** Принудительно встать на позицию комнаты (кнопка «Синхронизироваться», вход в зал) */
  const resync = useCallback(() => reconcile(true), [reconcile]);

  return { view, command, resync, reconcile };
}
