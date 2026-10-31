import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { PlaybackState, Subtitles, VideoSource, Viewer } from '../../../shared/protocol';
import type { ServerClock } from '../lib/clock';
import { cueAt, parseSubtitles } from '../lib/subtitles';
import { fmtTime } from '../lib/util';
import { createAdapter, type PlayerAdapter } from '../players';
import { socket } from '../socket';
import { useSync } from '../sync/useSync';
import { ProgressBar } from './ProgressBar';
import { ReactionLayer } from './ReactionLayer';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface Props {
  source: VideoSource;
  isHost: boolean;
  selfId: string;
  stateRef: MutableRefObject<PlaybackState>;
  /** Меняется при каждом новом состоянии с сервера — чтобы перерисовать кнопку play */
  stateSeq: number;
  clock: ServerClock;
  viewers: Viewer[];
  subtitles: Subtitles | null;
  onDuration: (d: number) => void;
}

export function VideoStage({ source, isHost, selfId, stateRef, stateSeq, clock, viewers, subtitles, onDuration }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [adapter, setAdapter] = useState<PlayerAdapter | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [subsOn, setSubsOn] = useState(true);
  const [subsOffset, setSubsOffset] = useState(0);
  const [mutedByBrowser, setMutedByBrowser] = useState(false);

  // Пересоздаём плеер при смене источника
  useEffect(() => {
    const el = mountRef.current!;
    setReady(false);
    setError(null);
    const a = createAdapter(el, source, (ev, msg) => {
      if (ev === 'ready') setReady(true);
      else setError(msg ?? 'Ошибка плеера');
    });
    setAdapter(a);
    return () => {
      a.destroy();
      el.innerHTML = '';
      setAdapter(null);
    };
  }, [source.kind, source.url, source.videoId]);

  // Громкость применяем и к новому плееру
  useEffect(() => {
    if (!adapter || !ready) return;
    adapter.setVolume(volume);
    adapter.setMuted(muted);
  }, [adapter, ready, volume, muted]);

  // Автоплей со звуком заблокирован → играем без звука и показываем кнопку
  const onAutoplayBlocked = useCallback(() => {
    if (!adapter) return;
    setMuted(true);
    setMutedByBrowser(true);
    adapter.setMuted(true);
    adapter.play().catch(() => undefined);
  }, [adapter]);

  const { view, command, resync, reconcile } = useSync({
    adapter,
    ready,
    isHost,
    engaged,
    stateRef,
    clock,
    onAutoplayBlocked,
  });

  // Новое состояние с сервера → реагируем сразу, не дожидаясь тика
  useEffect(() => {
    if (!isHost) reconcile();
  }, [stateSeq, isHost, reconcile]);

  useEffect(() => onDuration(view.duration), [view.duration, onDuration]);

  // Горячие клавиши хоста: пробел — play/pause, ←/→ — 10 секунд
  useEffect(() => {
    if (!isHost || !engaged) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        command({ playing: view.paused });
      } else if (e.code === 'ArrowLeft') command({ position: Math.max(0, view.time - 10) });
      else if (e.code === 'ArrowRight') command({ position: view.time + 10 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isHost, engaged, command, view.paused, view.time]);

  const engage = () => {
    setEngaged(true);
    resync(); // вызывается внутри клика — браузер разрешит звук
  };

  const roomPlaying = stateRef.current.playing;
  const playing = isHost ? !view.paused : roomPlaying;

  const cues = useMemo(() => (subtitles ? parseSubtitles(subtitles.text) : []), [subtitles]);
  const cue = subsOn && cues.length ? cueAt(cues, view.time - subsOffset) : null;

  const toggleFullscreen = () => {
    const el = stageRef.current!;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => el.classList.toggle('pseudo-fs'));
    else el.classList.toggle('pseudo-fs'); // iOS Safari: fullscreen только для <video>
  };

  const onSubsFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 600_000) return alert('Файл субтитров слишком большой (макс. 600 КБ)');
    const text = await readText(f);
    if (!parseSubtitles(text).length) return alert('Не удалось разобрать субтитры. Нужен .srt или .vtt');
    socket.emit('subs:set', { name: f.name, text });
  };

  return (
    <div ref={stageRef} className="stage">
      <div className="screen">
        <div ref={mountRef} className="player-mount" />
        {/* Перехватываем клики по iframe/видео: управлять может только хост */}
        <div
          className="click-shield"
          onClick={() => isHost && engaged && command({ playing: view.paused })}
          onDoubleClick={toggleFullscreen}
        />
        {cue && <div className="subtitle">{cue}</div>}
        <ReactionLayer />
        {view.buffering && engaged && ready && !error && <div className="spinner" />}
        {!ready && !error && <div className="screen-msg">Загружаем видео…</div>}
        {error && (
          <div className="screen-msg error">
            <strong>Не получается воспроизвести</strong>
            <span>{error}</span>
          </div>
        )}
        {ready && !engaged && !error && (
          <button className="engage" onClick={engage}>
            <span className="engage-icon">▶</span>
            <span>{isHost ? 'Начать сеанс' : 'Войти в зал'}</span>
            <small>{isHost ? 'Вы ведущий: управляете просмотром' : 'Видео подстроится под остальных'}</small>
          </button>
        )}
        {mutedByBrowser && (
          <button
            className="unmute"
            onClick={() => {
              setMuted(false);
              setMutedByBrowser(false);
            }}
          >
            🔇 Браузер выключил звук — включить
          </button>
        )}
      </div>

      <div className="controls">
        <ProgressBar
          time={view.time}
          duration={view.duration}
          viewers={viewers}
          selfId={selfId}
          canSeek={isHost && engaged}
          onSeek={(t) => command({ position: t })}
        />
        <div className="controls-row">
          <button
            className="ctl ctl-play"
            disabled={!isHost || !engaged}
            onClick={() => command({ playing: view.paused })}
            title={isHost ? 'Пробел' : 'Управляет хост'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          {isHost && (
            <>
              <button className="ctl" disabled={!engaged} onClick={() => command({ position: Math.max(0, view.time - 10) })} title="−10 с">
                ↺10
              </button>
              <button className="ctl" disabled={!engaged} onClick={() => command({ position: view.time + 10 })} title="+10 с">
                10↻
              </button>
            </>
          )}
          <span className="time">
            {fmtTime(view.time)} <span className="dim">/ {fmtTime(view.duration)}</span>
          </span>
          <span className="spacer" />
          {!isHost && engaged && (
            <button className="ctl text" onClick={resync} title="Встать на позицию хоста">
              ⟳ Синхр.
            </button>
          )}
          <select
            className="ctl select"
            value={stateRef.current.rate}
            disabled={!isHost || !engaged}
            onChange={(e) => command({ rate: Number(e.target.value) })}
            title="Скорость"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
          <div className="subs-ctl">
            {cues.length > 0 && (
              <>
                <button className={`ctl text ${subsOn ? 'on' : ''}`} onClick={() => setSubsOn(!subsOn)} title={subtitles?.name}>
                  CC
                </button>
                {subsOn && (
                  <>
                    <button className="ctl tiny" onClick={() => setSubsOffset((o) => o - 0.5)} title="Субтитры раньше">
                      −
                    </button>
                    <span className="dim tiny-label">{subsOffset > 0 ? '+' : ''}{subsOffset.toFixed(1)}с</span>
                    <button className="ctl tiny" onClick={() => setSubsOffset((o) => o + 0.5)} title="Субтитры позже">
                      +
                    </button>
                  </>
                )}
              </>
            )}
            {isHost && (
              <>
                <button className="ctl text" onClick={() => fileRef.current?.click()} title="Загрузить .srt / .vtt для всех">
                  {cues.length ? '⇪' : '⇪ Субтитры'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".srt,.vtt,text/vtt"
                  hidden
                  onChange={(e) => {
                    void onSubsFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </>
            )}
          </div>
          <button className="ctl" onClick={() => setMuted(!muted)} title="Звук">
            {muted || volume === 0 ? '🔇' : '🔊'}
          </button>
          <input
            className="volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              setMuted(false);
            }}
          />
          <button className="ctl" onClick={toggleFullscreen} title="Во весь экран">
            ⛶
          </button>
        </div>
      </div>
    </div>
  );
}

/** Читаем как UTF-8; если в тексте «�» — пробуем windows-1251 (частый случай для русских .srt) */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  if (!utf.includes('�')) return utf;
  try {
    return new TextDecoder('windows-1251').decode(buf);
  } catch {
    return utf;
  }
}
