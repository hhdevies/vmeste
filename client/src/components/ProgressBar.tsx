import { useRef, useState } from 'react';
import type { Viewer } from '../../../shared/protocol';
import { clamp, fmtTime } from '../lib/util';

interface Props {
  time: number;
  duration: number;
  viewers: Viewer[];
  selfId: string;
  canSeek: boolean;
  onSeek: (t: number) => void;
}

/** Общая шкала с маркерами позиций всех зрителей */
export function ProgressBar({ time, duration, viewers, selfId, canSeek, onSeek }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pct = (t: number) => (duration > 0 ? `${clamp((t / duration) * 100, 0, 100)}%` : '0%');

  const posFromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1) * duration;
  };

  const shown = drag ?? time;

  return (
    <div
      ref={ref}
      className={`pbar ${canSeek ? 'seekable' : ''}`}
      onPointerMove={(e) => {
        if (!duration) return;
        const t = posFromEvent(e);
        setHover(t);
        if (drag !== null) setDrag(t);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        if (!canSeek || !duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(posFromEvent(e));
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        onSeek(posFromEvent(e));
        setDrag(null);
      }}
      title={canSeek ? undefined : 'Перематывать может только хост'}
    >
      <div className="pbar-track">
        <div className="pbar-fill" style={{ width: pct(shown) }} />
        {hover !== null && <div className="pbar-hover" style={{ left: pct(hover) }} data-t={fmtTime(hover)} />}
      </div>
      {viewers
        .filter((v) => v.online && v.id !== selfId)
        .map((v) => (
          <div
            key={v.id}
            className={`pbar-marker ${v.isHost ? 'host' : ''} ${v.status}`}
            style={{ left: pct(v.position), background: v.color }}
            title={`${v.name} — ${fmtTime(v.position)}`}
          >
            <span className="pbar-marker-label" style={{ color: v.color }}>
              {v.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        ))}
      <div className="pbar-thumb" style={{ left: pct(shown) }} />
    </div>
  );
}
