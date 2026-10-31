import { useEffect, useState } from 'react';
import { socket } from '../socket';

interface Floating {
  id: number;
  emoji: string;
  from: string;
  color: string;
  x: number;
}

let seq = 0;

/** Всплывающие реакции поверх видео */
export function ReactionLayer() {
  const [items, setItems] = useState<Floating[]>([]);

  useEffect(() => {
    const onReaction = (r: { emoji: string; from: string; color: string }) => {
      const item = { ...r, id: ++seq, x: 8 + Math.random() * 80 };
      setItems((xs) => [...xs.slice(-30), item]);
      window.setTimeout(() => setItems((xs) => xs.filter((i) => i.id !== item.id)), 2800);
    };
    socket.on('reaction', onReaction);
    return () => {
      socket.off('reaction', onReaction);
    };
  }, []);

  return (
    <div className="reactions" aria-hidden>
      {items.map((i) => (
        <div key={i.id} className="reaction" style={{ left: `${i.x}%` }}>
          <span className="reaction-emoji">{i.emoji}</span>
          <span className="reaction-from" style={{ color: i.color }}>
            {i.from}
          </span>
        </div>
      ))}
    </div>
  );
}
