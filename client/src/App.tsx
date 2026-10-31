import { useCallback, useEffect, useState } from 'react';
import { Home } from './pages/Home';
import { RoomPage } from './pages/RoomPage';

/** Минимальный роутер: «/» и «/room/:id» — без лишних зависимостей */
export function App() {
  const [path, setPath] = useState(location.pathname);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((p: string) => {
    history.pushState(null, '', p);
    setPath(p);
  }, []);

  const m = path.match(/^\/room\/([a-z0-9]+)/i);
  if (m) return <RoomPage key={m[1]} roomId={m[1].toLowerCase()} navigate={navigate} />;
  return <Home navigate={navigate} />;
}
