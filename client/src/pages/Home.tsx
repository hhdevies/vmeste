import { useState } from 'react';
import { parseVideoUrl } from '../lib/source';
import { getNickname, setNickname } from '../lib/util';
import { socket } from '../socket';

export function Home({ navigate }: { navigate: (path: string) => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [nick, setNick] = useState(getNickname());
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = url.trim() ? parseVideoUrl(url) : null;
  const kindLabel = parsed && !('error' in parsed) ? { youtube: 'YouTube', hls: 'HLS-поток', file: parsed.title ?? 'Видеофайл' }[parsed.kind] : null;

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!parsed) return setError('Вставьте ссылку на видео');
    if ('error' in parsed) return setError(parsed.error);
    if (!nick.trim()) return setError('Как вас зовут?');
    setNickname(nick.trim());
    setBusy(true);
    socket.timeout(5000).emit('room:create', { name: name.trim(), password: password || undefined, source: parsed }, (err, res) => {
      setBusy(false);
      if (err) return setError('Сервер не отвечает');
      if (!res.ok) return setError(res.error);
      if (password) sessionStorage.setItem(`wp:pw:${res.roomId}`, password);
      navigate(`/room/${res.roomId}`);
    });
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const m = code.trim().match(/([a-z0-9]{6,12})\/?$/i);
    if (m) navigate(`/room/${m[1].toLowerCase()}`);
  };

  return (
    <div className="home">
      <div className="marquee">
        <div className="marquee-lights" aria-hidden />
        <h1>
          Вместе<span className="dot">.</span>
        </h1>
        <p>Смотрите кино с друзьями синхронно — где бы вы ни были. Без регистрации.</p>
      </div>

      <form className="card" onSubmit={create}>
        <h2>Новый кинозал</h2>
        <label>
          Ссылка на видео
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="YouTube, Google Drive, .mp4, .m3u8…"
            inputMode="url"
            autoFocus
          />
          {kindLabel && <span className="hint ok">✓ {kindLabel}</span>}
          {parsed && 'error' in parsed && <span className="hint bad">{parsed.error}</span>}
        </label>
        <div className="row">
          <label>
            Название
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Пятничное кино" maxLength={60} />
          </label>
          <label>
            Пароль <span className="dim">(необязательно)</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" />
          </label>
        </div>
        <label>
          Ваше имя
          <input value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Например, Аня" maxLength={32} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? 'Создаём…' : 'Создать комнату'}
        </button>
      </form>

      <form className="card join" onSubmit={join}>
        <h2>Есть код?</h2>
        <div className="row">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код или ссылка на комнату" />
          <button className="secondary">Войти</button>
        </div>
      </form>
    </div>
  );
}
