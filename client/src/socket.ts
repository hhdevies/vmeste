import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '../../shared/protocol';

/** Пусто = тот же origin (в dev Vite проксирует /socket.io на :3001) */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? '';

export type AppSocket = Socket<ServerToClient, ClientToServer>;

export const socket: AppSocket = io(SERVER_URL || undefined, {
  transports: ['websocket', 'polling'],
  reconnectionDelayMax: 4000,
});
