import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, PlaybackState, RoomInfo, RoomSnapshot, Subtitles, VideoSource, Viewer } from '../../../shared/protocol';
import { Chat } from '../components/Chat';
import { VideoStage } from '../components/VideoStage';
import { ViewersPanel } from '../components/ViewersPanel';
import { ServerClock } from '../lib/clock';
import { parseVideoUrl } from '../lib/source';
import { getClientId, getNickname, setNickname } from '../lib/util';
import { SERVER_URL, socket } from '../socket';

type Phase = 'loading' | 'not-found' | 'form' | 'joining' | 'in';

export function RoomPage({ roomId, navigate }: { roomId: string; navigate: (p: string) => void }) {
  const clientId = useMemo(getClientId, []);
  const clock = useMemo(() => new ServerClock(socket), []);
  const [phase, setPhase] = useState<Phase>('loading');
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [nick, setNick] = useState(getNickname());
  const [password, setPassword] = useState(sessionStorage.getItem(`wp:pw:${roomId}`) ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [source, setSource] = useState<VideoSource | null>(null);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [subs, setSubs] = useState<Subtitles | null>(null);
  const [duration, setDuration] = useState(0);
  const [stateSeq, setStateSeq] = useState(0);
  const [tab, setTab] = useState<'chat' | 'viewers'>('chat');
  const [copied, setCopied] = useState(false);
  const stateRef = useRef<PlaybackState>({ playing: false, position: 0, rate: 1, updatedAt: 0, seq: 0 });
  const creds = useRef<{ nickname: string; password?: string } | null>(null);

  // 1. Узнаём, существует ли комната и нужен ли пароль
  useEffect(() => {
    fetch(`${SERVER_URL}/api/rooms/${roomId}`)
      .then((r) => (r.ok ? (r.json() as Promise<RoomInfo>) : null))
      .then((i) => {
        if (!i) return setPhase('not-found');
        setInfo(i);
        const savedNick = getNickname();
        const savedPw = sessionStorage.getItem(`wp:pw:${roomId}`) ?? undefined;
        if (savedNick && (!i.hasPassword || savedPw)) join(savedNick, savedPw);
        else setPhase('form');
      })
      .catch(() => setPhase('not-found'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const applySnapshot = (r: RoomSnapshot) => {
    setRoom(r);
    setSource(r.source);
    setViewers(r.viewers);
    setHostId(r.hostId);
    setMessages(r.messages);
    setSubs(r.subtitles);
    stateRef.current = r.state;
    setStateSeq((x) => x + 1);
  };

  // 2. Вход в комнату (и повторный вход после переподключения)
  const join = useCallback(
    (nickname: string, pw?: string) => {
      creds.current = { nickname, password: pw };
      setPhase((p) => (p === 'in' ? p : 'joining'));
      socket.timeout(8000).emit('room:join', { roomId, clientId, nickname, password: pw }, (err, res) => {
        if (err) {
          setFormError('Сервер не отвечает');
          return setPhase('form');
        }
        if (!res.ok) {
          if (res.error === 'not_found') return setPhase('not-found');
          sessionStorage.removeItem(`wp:pw:${roomId}`);
          setFormError(res.error === 'wrong_password' ? 'Неверный пароль' : res.error);
          return setPhase('form');
        }
        if (pw) sessionStorage.setItem(`wp:pw:${roomId}`, pw);
        applySnapshot(res.room);
        setPhase('in');
      });
    },
    [roomId, clientId],
  );

  // 3. Подписки на события комнаты
  useEffect(() => {
    if (phase !== 'in') return;
    void clock.start();
    const onState = (s: PlaybackState) => {
      stateRef.current = s;
      setStateSeq((x) => x + 1);
    };
    const onViewers = (v: Viewer[], h: string | null) => {
      setViewers(v);
      setHostId(h);
    };
    const onChat = (m: ChatMessage) => setMessages((ms) => [...ms.slice(-199), m]);
    const onReconnect = () => creds.current && join(creds.current.nickname, creds.current.password);
    socket.on('state', onState);
    socket.on('viewers', onViewers);
    socket.on('chat', onChat);
    socket.on('source', setSource);
    socket.on('subs', setSubs);
    socket.on('connect', onReconnect);
    return () => {
      clock.stop();
      socket.off('state', onState);
      socket.off('viewers', onViewers);
      socket.off('chat', onChat);
      socket.off('source', setSource);
      socket.off('subs', setSubs);
      socket.off('connect', onReconnect);
    };
  }, [phase, clock, join]);

  const onDuration = useCallback((d: number) => setDuration(d), []);

  if (phase === 'loading' || phase === 'joining') return <div className="center-msg">Открываем зал…</div>;
  if (phase === 'not-found')
    return (
      <div className="center-msg">
        <h2>Комната не найдена</h2>
        <p className="dim">Возможно, она закрылась — пустые комнаты живут 10 минут.</p>
        <button className="primary" onClick={() => navigate('/')}>
          Создать новую
        </button>
      </div>
    );

  if (phase === 'form')
    return (
      <div className="home">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nick.trim()) return setFormError('Введите имя');
            setNickname(nick.trim());
            setFormError(null);
            join(nick.trim(), password || undefined);
          }}
        >
          <h2>{info?.name ?? 'Кинозал'}</h2>
          <p className="dim">Сейчас в зале: {info?.viewers ?? 0}</p>
          <label>
            Ваше имя
            <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} autoFocus />
          </label>
          {info?.hasPassword && (
            <label>
              Пароль
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
            </label>
          )}
          {formError && <div className="form-error">{formError}</div>}
          <button className="primary">Войти</button>
        </form>
      </div>
    );

  const isHost = hostId === clientId;
  const online = viewers.filter((v) => v.online).length;

  const share = async () => {
    const link = location.href;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: room?.name, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      prompt('Скопируйте ссылку', link);
    }
  };

  const changeVideo = () => {
    const raw = prompt('Новая ссылка на видео');
    if (!raw) return;
    const s = parseVideoUrl(raw);
    if ('error' in s) return alert(s.error);
    socket.emit('host:source', s);
  };

  return (
    <div className="room">
      <header className="topbar">
        <a
          className="logo"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          Вместе<span className="dot">.</span>
        </a>
        <div className="room-title">
          <strong>{room?.name}</strong>
          <span className="dim">
            {room?.hasPassword && '🔒 '}код {roomId} · {online} в зале
          </span>
        </div>
        <span className="spacer" />
        {isHost && (
          <button className="secondary sm" onClick={changeVideo}>
            Сменить видео
          </button>
        )}
        <button className="primary sm" onClick={share}>
          {copied ? '✓ Скопировано' : 'Пригласить'}
        </button>
      </header>

      <main className="room-grid">
        <div className="stage-col">
          {source && (
            <VideoStage
              source={source}
              isHost={isHost}
              selfId={clientId}
              stateRef={stateRef}
              stateSeq={stateSeq}
              clock={clock}
              viewers={viewers}
              subtitles={subs}
              onDuration={onDuration}
            />
          )}
          <div className="role-hint">
            {isHost ? '👑 Вы управляете просмотром. Пробел — пауза, ← → — перемотка.' : `Управляет: ${viewers.find((v) => v.isHost)?.name ?? '—'}`}
          </div>
        </div>

        <aside className="side">
          <div className="tabs">
            <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
              Чат
            </button>
            <button className={tab === 'viewers' ? 'active' : ''} onClick={() => setTab('viewers')}>
              Зрители · {online}
            </button>
          </div>
          <div className={`side-pane viewers-pane ${tab === 'viewers' ? 'show' : ''}`}>
            <ViewersPanel
              viewers={viewers}
              selfId={clientId}
              duration={duration}
              canTransfer={isHost}
              onTransfer={(id) => socket.emit('host:transfer', id)}
            />
          </div>
          <div className={`side-pane chat-pane ${tab === 'chat' ? 'show' : ''}`}>
            <Chat messages={messages} selfId={clientId} />
          </div>
        </aside>
      </main>
    </div>
  );
}
