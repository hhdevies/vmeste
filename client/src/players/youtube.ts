import type { AdapterEmit, PlayerAdapter } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  apiPromise ??= new Promise<void>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('yt api'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

// Состояния YT.PlayerState
const PLAYING = 1;
const BUFFERING = 3;

/** YouTube через IFrame Player API. Плавно менять скорость нельзя — только дискретные значения. */
export class YouTubeAdapter implements PlayerAdapter {
  readonly supportsFineRate = false;
  private player: any = null;
  private ready = false;
  private destroyed = false;
  private pending: Promise<void> | null = null;
  private playToken = 0;

  constructor(container: HTMLElement, videoId: string, emit: AdapterEmit) {
    const mount = document.createElement('div');
    container.appendChild(mount);
    loadApi()
      .then(() => {
        if (this.destroyed) return;
        this.player = new window.YT.Player(mount, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              this.ready = true;
              emit('ready');
            },
            onError: (e: { data: number }) => emit('error', ytError(e.data)),
          },
        });
      })
      .catch(() => emit('error', 'Не удалось загрузить YouTube (блокировщик рекламы или нет сети?)'));
  }

  private get st(): number {
    return this.ready ? this.player.getPlayerState() : -1;
  }

  /** YouTube не возвращает промис из playVideo, поэтому ждём фактического старта до 6 с */
  play(): Promise<void> {
    if (!this.ready || this.st === PLAYING || this.st === BUFFERING) return Promise.resolve();
    this.player.playVideo();
    if (this.pending) return this.pending;
    const token = ++this.playToken;
    const t0 = Date.now();
    this.pending = new Promise<void>((resolve, reject) => {
      const check = () => {
        if (this.destroyed || token !== this.playToken) return resolve(); // отменено паузой
        if (this.st === PLAYING || this.st === BUFFERING) return resolve();
        if ((Date.now() - t0 > 6000 && this.st !== -1) || Date.now() - t0 > 15000) return reject(new DOMException('YouTube autoplay blocked', 'NotAllowedError'));
        setTimeout(check, 200);
      };
      check();
    }).finally(() => (this.pending = null));
    return this.pending;
  }
  pause() {
    this.playToken++;
    if (this.ready) this.player.pauseVideo();
  }
  seek(t: number) {
    if (this.ready) this.player.seekTo(Math.max(0, t), true);
  }
  setRate(r: number) {
    if (this.ready) this.player.setPlaybackRate(r);
  }
  getRate() {
    return this.ready ? this.player.getPlaybackRate() : 1;
  }
  getTime() {
    return this.ready ? this.player.getCurrentTime() : 0;
  }
  getDuration() {
    return this.ready ? this.player.getDuration() || 0 : 0;
  }
  isPaused() {
    return !(this.st === PLAYING || this.st === BUFFERING);
  }
  isBuffering() {
    return this.st === BUFFERING;
  }
  setVolume(v: number) {
    if (this.ready) this.player.setVolume(Math.round(v * 100));
  }
  setMuted(m: boolean) {
    if (!this.ready) return;
    if (m) this.player.mute();
    else this.player.unMute();
  }
  destroy() {
    this.destroyed = true;
    try {
      this.player?.destroy();
    } catch {
      /* noop */
    }
  }
}

function ytError(code: number): string {
  if (code === 101 || code === 150) return 'Автор запретил встраивание этого видео на другие сайты';
  if (code === 100) return 'Видео удалено или скрыто';
  if (code === 2) return 'Некорректный id видео';
  return 'Ошибка YouTube-плеера';
}
