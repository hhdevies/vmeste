import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import type { ClientToServer, ServerToClient, VideoSource } from '../../shared/protocol.js';
import { RoomStore, type Room } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3001);
const ROOM_TTL_MS = 10 * 60_000; // пустая комната живёт 10 минут
const MAX_SUBS_BYTES = 600_000;

interface SocketData {
  roomId?: string;
  clientId?: string;
  chatTimes: number[];
}
type IO = Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>;
type WSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

const store = new RoomStore();
const app = express();
const http = createServer(app);
const io: IO = new Server(http, {
  cors: { origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true },
  maxHttpBufferSize: 1e6,
  pingInterval: 10_000,
  pingTimeout: 8_000,
});

// ───────────────────────── REST ─────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: [...store.all()].length }));
app.get('/api/rooms/:id', (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'not_found' });
  res.json(room.info());
});

// В продакшене сервер сам раздаёт собранный клиент
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ───────────────────────── helpers ─────────────────────────
const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function validSource(s: unknown): VideoSource | null {
  if (!s || typeof s !== 'object') return null;
  const src = s as VideoSource;
  if (!['youtube', 'hls', 'file'].includes(src.kind)) return null;
  try {
    const u = new URL(src.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  if (src.kind === 'youtube' && !/^[\w-]{11}$/.test(src.videoId ?? '')) return null;
  return { kind: src.kind, url: src.url.slice(0, 2000), videoId: src.videoId, title: str(src.title, 200) || undefined };
}

function system(room: Room, text: string) {
  io.to(room.id).emit('chat', room.pushMessage({ kind: 'system', text }));
}

function sendViewers(room: Room) {
  room.viewersDirty = false;
  io.to(room.id).emit('viewers', room.viewers(), room.hostId);
}

/** Комната + участник, от имени которого пришло событие */
function ctx(socket: WSocket) {
  const { roomId, clientId } = socket.data;
  const room = roomId ? store.get(roomId) : undefined;
  const member = room && clientId ? room.members.get(clientId) : undefined;
  if (!room || !member || member.socketId !== socket.id) return null;
  return { room, member, isHost: room.hostId === member.id };
}

function leave(socket: WSocket) {
  const { roomId, clientId } = socket.data;
  socket.data.roomId = undefined;
  if (!roomId || !clientId) return;
  const room = store.get(roomId);
  const m = room?.members.get(clientId);
  if (!room || !m || m.socketId !== socket.id) return;
  socket.leave(roomId);
  room.markOffline(clientId, () => {
    const name = m.name;
    const hostChanged = room.removeMember(clientId);
    system(room, `${name} вышел(а)`);
    if (hostChanged) {
      const h = room.members.get(room.hostId!);
      if (h) system(room, `${h.name} теперь хост`);
    }
    sendViewers(room);
  });
  sendViewers(room);
}

// ───────────────────────── Socket.io ─────────────────────────
io.on('connection', (socket) => {
  socket.data.chatTimes = [];

  // NTP-подобная синхронизация часов: клиент меряет RTT и смещение
  socket.on('time:ping', (_clientNow, ack) => {
    if (typeof ack === 'function') ack(Date.now());
  });

  socket.on('room:create', (p, ack) => {
    if (typeof ack !== 'function') return;
    const source = validSource(p?.source);
    if (!source) return ack({ ok: false, error: 'Некорректная ссылка на видео' });
    const name = str(p.name, 60) || 'Кинозал';
    const password = str(p.password, 100) || undefined;
    const room = store.create(name, source, password);
    ack({ ok: true, roomId: room.id });
  });

  socket.on('room:join', (p, ack) => {
    if (typeof ack !== 'function') return;
    const room = store.get(str(p?.roomId, 20));
    if (!room) return ack({ ok: false, error: 'not_found' });
    if (!room.checkPassword(p.password)) return ack({ ok: false, error: 'wrong_password' });
    const clientId = str(p.clientId, 64);
    const nickname = str(p.nickname, 32) || 'Гость';
    if (!clientId) return ack({ ok: false, error: 'bad_request' });

    if (socket.data.roomId && socket.data.roomId !== room.id) leave(socket);

    // Если тот же clientId сидит с другого сокета (дубль вкладки) — выкидываем старый
    const prev = room.members.get(clientId);
    if (prev?.socketId && prev.socketId !== socket.id) io.sockets.sockets.get(prev.socketId)?.disconnect(true);

    const { isNew } = room.upsertMember(clientId, nickname, socket.id);
    socket.data.roomId = room.id;
    socket.data.clientId = clientId;
    socket.join(room.id);
    ack({ ok: true, room: room.snapshot() });
    if (isNew) system(room, `${nickname} присоединился(-ась)`);
    sendViewers(room);
  });

  socket.on('host:state', (s) => {
    const c = ctx(socket);
    if (!c || !c.isHost || !s) return;
    const change = c.room.applyHostState(s);
    // Шлём всем, включая хоста: у него обновится seq
    io.to(c.room.id).emit('state', c.room.state);
    const n = c.member.name;
    if (change === 'play') system(c.room, `▶ ${n} запустил(а) воспроизведение`);
    else if (change === 'pause') system(c.room, `⏸ ${n} поставил(а) на паузу на ${fmt(c.room.state.position)}`);
    else if (change === 'seek') system(c.room, `⏩ ${n} перемотал(а) на ${fmt(c.room.state.position)}`);
    else if (change === 'rate') system(c.room, `${n} изменил(а) скорость: ${c.room.state.rate}×`);
    c.room.viewersDirty = true;
  });

  socket.on('host:transfer', (viewerId) => {
    const c = ctx(socket);
    if (!c || !c.isHost) return;
    if (c.room.setHost(str(viewerId, 64))) {
      system(c.room, `👑 ${c.member.name} передал(а) управление: ${c.room.members.get(c.room.hostId!)!.name}`);
      sendViewers(c.room);
    }
  });

  socket.on('host:source', (s) => {
    const c = ctx(socket);
    const source = validSource(s);
    if (!c || !c.isHost || !source) return;
    c.room.source = source;
    c.room.subtitles = null;
    c.room.resetPlayback();
    io.to(c.room.id).emit('source', source);
    io.to(c.room.id).emit('subs', null);
    io.to(c.room.id).emit('state', c.room.state);
    system(c.room, `🎬 ${c.member.name} сменил(а) видео`);
  });

  socket.on('viewer:report', (r) => {
    const c = ctx(socket);
    if (c && r) c.room.report(c.member.id, r);
  });

  // Анти-флуд: не больше 5 сообщений/реакций за 3 секунды
  const allowChat = () => {
    const now = Date.now();
    socket.data.chatTimes = socket.data.chatTimes.filter((t) => now - t < 3000);
    if (socket.data.chatTimes.length >= 5) return false;
    socket.data.chatTimes.push(now);
    return true;
  };

  socket.on('chat:send', (text) => {
    const c = ctx(socket);
    const t = str(text, 500);
    if (!c || !t || !allowChat()) return;
    const msg = c.room.pushMessage({ kind: 'text', authorId: c.member.id, author: c.member.name, color: c.member.color, text: t });
    io.to(c.room.id).emit('chat', msg);
  });

  socket.on('chat:react', (emoji) => {
    const c = ctx(socket);
    const e = str(emoji, 8);
    if (!c || !e || !allowChat()) return;
    io.to(c.room.id).emit('reaction', { emoji: e, from: c.member.name, color: c.member.color });
  });

  socket.on('subs:set', (subs) => {
    const c = ctx(socket);
    if (!c || !c.isHost) return;
    if (subs && (typeof subs.text !== 'string' || subs.text.length > MAX_SUBS_BYTES)) return;
    c.room.subtitles = subs ? { name: str(subs.name, 120) || 'subtitles.srt', text: subs.text } : null;
    io.to(c.room.id).emit('subs', c.room.subtitles);
    system(c.room, subs ? `💬 ${c.member.name} загрузил(а) субтитры «${c.room.subtitles!.name}»` : `${c.member.name} убрал(а) субтитры`);
  });

  socket.on('disconnect', () => leave(socket));
});

// Список зрителей рассылаем не чаще раза в секунду (батчинг)
setInterval(() => {
  for (const room of store.all()) if (room.viewersDirty) sendViewers(room);
}, 1000);
setInterval(() => store.sweep(ROOM_TTL_MS), 60_000);

http.listen(PORT, () => console.log(`▶ watchparty server on http://localhost:${PORT}`));
