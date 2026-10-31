export interface Cue {
  start: number;
  end: number;
  text: string;
}

// 00:01:02,345 | 01:02.345 | 1:02:03.4
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

function toSec(t: string): number {
  const m = t.match(TIME);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** Парсит .srt и .vtt (формат блоков одинаковый, заголовок WEBVTT просто пропускается) */
export function parseSubtitles(src: string): Cue[] {
  const blocks = src.replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = toSec(a);
    const end = toSec(b);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const text = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '') // <i>, <b>, <font>
      .replace(/\{\\[^}]+\}/g, ''); // {\an8}
    if (text) cues.push({ start, end, text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Активная реплика в момент t (бинарный поиск) */
export function cueAt(cues: Cue[], t: number): string | null {
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // Учитываем перекрывающиеся реплики: смотрим пару предыдущих
  const out: string[] = [];
  for (let k = idx; k >= 0 && k > idx - 3; k--) if (cues[k].end > t) out.unshift(cues[k].text);
  return out.length ? out.join('\n') : null;
}
