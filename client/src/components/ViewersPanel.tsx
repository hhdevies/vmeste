import type { Viewer, ViewerStatus } from '../../../shared/protocol';
import { clamp, fmtDrift, fmtTime } from '../lib/util';

const LABEL: Record<ViewerStatus, string> = {
  watching: 'смотрит',
  paused: 'пауза',
  buffering: 'загрузка',
  behind: 'отстаёт',
  ahead: 'впереди',
  idle: 'ещё не вошёл',
  offline: 'офлайн',
};

interface Props {
  viewers: Viewer[];
  selfId: string;
  duration: number;
  canTransfer: boolean;
  onTransfer: (id: string) => void;
}

export function ViewersPanel({ viewers, selfId, duration, canTransfer, onTransfer }: Props) {
  return (
    <section className="viewers">
      <h3 className="panel-title">
        Зрители <span className="count">{viewers.filter((v) => v.online).length}</span>
      </h3>
      <ul>
        {viewers.map((v) => {
          const pct = duration > 0 ? clamp((v.position / duration) * 100, 0, 100) : 0;
          const drift = v.status === 'behind' || v.status === 'ahead' ? fmtDrift(v.drift) : '';
          return (
            <li key={v.id} className={`viewer st-${v.status}`}>
              <div className="avatar" style={{ background: v.color }}>
                {v.name.slice(0, 1).toUpperCase()}
                {v.isHost && <span className="crown" title="Хост">👑</span>}
              </div>
              <div className="v-main">
                <div className="v-top">
                  <span className="v-name">
                    {v.name}
                    {v.id === selfId && <span className="dim"> (вы)</span>}
                  </span>
                  <span className="badge">
                    {LABEL[v.status]}
                    {drift && ` ${drift}`}
                  </span>
                </div>
                <div className="v-bar">
                  <div style={{ width: `${pct}%`, background: v.color }} />
                </div>
                <div className="v-time">{fmtTime(v.position)}</div>
              </div>
              {canTransfer && v.id !== selfId && v.online && (
                <button className="link-btn" onClick={() => onTransfer(v.id)} title="Передать управление">
                  👑 сделать хостом
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
