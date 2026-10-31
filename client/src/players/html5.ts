import Hls from 'hls.js';
import type { VideoSource } from '../../../shared/protocol';
import type { AdapterEmit, PlayerAdapter } from './types';

/** <video> для .mp4/.webm/прямых ссылок и HLS (.m3u8) через hls.js */
export class Html5Adapter implements PlayerAdapter {
  readonly supportsFineRate = true;
  readonly video: HTMLVideoElement;
  private hls: Hls | null = null;
  private buffering = false;

  constructor(container: HTMLElement, source: VideoSource, private emit: AdapterEmit) {
    const v = document.createElement('video');
    v.className = 'video-el';
    v.playsInline = true; // iOS: не уходить в системный полноэкранный режим
    v.preload = 'auto';
    v.controls = false; // свои контролы — чтобы клики не-хоста не ломали синхронизацию
    // ВАЖНО: не ставим crossOrigin — иначе серверы без CORS-заголовков перестанут отдавать видео
    this.video = v;
    container.appendChild(v);

    const on = (e: string, f: () => void) => v.addEventListener(e, f);
    on('loadedmetadata', () => emit('ready'));
    on('waiting', () => (this.buffering = true));
    on('seeking', () => (this.buffering = true));
    on('playing', () => (this.buffering = false));
    on('canplay', () => (this.buffering = false));
    on('seeked', () => (this.buffering = false));
    on('error', () => emit('error', mediaError(v.error)));

    if (source.kind === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else emit('error', `HLS: ${data.details}. Возможно, сервер не отдаёт CORS-заголовки.`);
      });
      hls.loadSource(source.url);
      hls.attachMedia(v);
      this.hls = hls;
    } else {
      v.src = source.url; // Safari умеет HLS нативно
    }
  }

  play() {
    return this.video.play();
  }
  pause() {
    this.video.pause();
  }
  seek(t: number) {
    this.video.currentTime = Math.max(0, t);
  }
  setRate(r: number) {
    this.video.playbackRate = r;
  }
  getRate() {
    return this.video.playbackRate;
  }
  getTime() {
    return this.video.currentTime;
  }
  getDuration() {
    const d = this.video.duration;
    return Number.isFinite(d) ? d : 0;
  }
  isPaused() {
    return this.video.paused;
  }
  isBuffering() {
    return this.buffering || this.video.readyState < 3;
  }
  setVolume(v: number) {
    this.video.volume = v;
  }
  setMuted(m: boolean) {
    this.video.muted = m;
  }
  destroy() {
    this.hls?.destroy();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }
}

function mediaError(e: MediaError | null): string {
  switch (e?.code) {
    case 2:
      return 'Сетевая ошибка при загрузке видео';
    case 3:
      return 'Видео повреждено или кодек не поддерживается';
    case 4:
      return 'Источник недоступен или формат не поддерживается браузером (нужен mp4/H.264, webm или m3u8)';
    default:
      return 'Не удалось воспроизвести видео';
  }
}
