import type { VideoSource } from '../../../shared/protocol';

/** Определяет тип источника по ссылке */
export function parseVideoUrl(raw: string): VideoSource | { error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: 'Это не похоже на ссылку' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Нужна http(s)-ссылка' };
  const host = url.hostname.replace(/^(www|m|music)\./, '');

  // YouTube: watch?v=, youtu.be/, /embed/, /shorts/, /live/
  let yt: string | null = null;
  if (host === 'youtu.be') yt = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    yt = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1] ?? null;
  }
  if (yt) {
    return /^[\w-]{11}$/.test(yt)
      ? { kind: 'youtube', url: url.toString(), videoId: yt, title: 'YouTube' }
      : { error: 'Не удалось распознать id видео YouTube' };
  }

  // Google Drive: превращаем в прямую ссылку на скачивание.
  // Файл должен быть открыт «для всех, у кого есть ссылка». Работает не всегда — см. README.
  if (host === 'drive.google.com') {
    const id = url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? url.searchParams.get('id');
    if (!id) return { error: 'Не удалось найти id файла Google Drive' };
    return {
      kind: 'file',
      url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
      title: 'Google Drive',
    };
  }

  if (/\.m3u8$/i.test(url.pathname)) return { kind: 'hls', url: url.toString() };
  return { kind: 'file', url: url.toString() };
}
