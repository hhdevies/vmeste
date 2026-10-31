import type { AppSocket } from '../socket';

/**
 * Синхронизация часов с сервером по схеме NTP:
 *   offset = serverNow − (t0 + rtt/2)
 * Делаем серию пингов и берём замер с минимальным RTT — он самый точный.
 * После этого clock.now() ≈ Date.now() на сервере (точность ~ rtt/2, обычно < 30 мс).
 */
export class ServerClock {
  private offset = 0;
  private timer: number | undefined;
  rtt = 0;

  constructor(private socket: AppSocket) {}

  now(): number {
    return Date.now() + this.offset;
  }

  private running = false;

  async start() {
    this.running = true;
    await this.burst(6);
    if (!this.running) return; // stop() успели вызвать во время замеров
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => void this.burst(3), 30_000);
  }

  stop() {
    this.running = false;
    window.clearInterval(this.timer);
  }

  private ping(): Promise<{ rtt: number; offset: number } | null> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const wall0 = Date.now();
      this.socket.timeout(3000).emit('time:ping', wall0, (err, serverNow) => {
        if (err) return resolve(null);
        const rtt = performance.now() - t0;
        resolve({ rtt, offset: serverNow - (wall0 + rtt / 2) });
      });
    });
  }

  private async burst(n: number) {
    let best: { rtt: number; offset: number } | null = null;
    for (let i = 0; i < n; i++) {
      const s = await this.ping();
      if (s && (!best || s.rtt < best.rtt)) best = s;
    }
    if (best) {
      this.offset = best.offset;
      this.rtt = best.rtt;
    }
  }
}
