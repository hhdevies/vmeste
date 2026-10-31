import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../shared/protocol';
import { socket } from '../socket';

const REACTIONS = ['😂', '😮', '😢', '🔥', '❤️', '👏', '😱', '🍿'];

export function Chat({ messages, selfId }: { messages: ChatMessage[]; selfId: string }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Автопрокрутка, только если пользователь у нижнего края
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    socket.emit('chat:send', t);
    setText('');
    stick.current = true;
  };

  return (
    <section className="chat">
      <h3 className="panel-title">Чат</h3>
      <div
        ref={listRef}
        className="chat-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && <div className="chat-empty">Пока тихо. Скажите «привет» 👋</div>}
        {messages.map((m) =>
          m.kind === 'system' ? (
            <div key={m.id} className="msg system">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`msg ${m.authorId === selfId ? 'mine' : ''}`}>
              <span className="msg-author" style={{ color: m.color }}>
                {m.author}
              </span>
              <span className="msg-text">{m.text}</span>
            </div>
          ),
        )}
      </div>
      <div className="reaction-bar">
        {REACTIONS.map((r) => (
          <button key={r} onClick={() => socket.emit('chat:react', r)} aria-label={`Реакция ${r}`}>
            {r}
          </button>
        ))}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Сообщение…" maxLength={500} />
        <button type="submit" disabled={!text.trim()}>
          ➤
        </button>
      </form>
    </section>
  );
}
