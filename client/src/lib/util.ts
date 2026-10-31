export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtDrift(d: number): string {
  const a = Math.abs(d);
  if (a < 1) return '';
  const v = a < 60 ? `${Math.round(a)} с` : fmtTime(a);
  return d > 0 ? `+${v}` : `−${v}`;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Стабильный id вкладки: переживает перезагрузку, но не делится между вкладками */
export function getClientId(): string {
  const KEY = 'wp:clientId';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    // randomUUID есть только в secure context (https/localhost); в LAN по http — фолбэк
    id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export function getNickname(): string {
  try {
    return localStorage.getItem('wp:nick') ?? '';
  } catch {
    return '';
  }
}

export function setNickname(n: string) {
  try {
    localStorage.setItem('wp:nick', n);
  } catch {
    /* приватный режим */
  }
}
