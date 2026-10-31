import type { VideoSource } from '../../../shared/protocol';
import { Html5Adapter } from './html5';
import type { AdapterEmit, PlayerAdapter } from './types';
import { YouTubeAdapter } from './youtube';

export type { PlayerAdapter } from './types';

export function createAdapter(container: HTMLElement, source: VideoSource, emit: AdapterEmit): PlayerAdapter {
  if (source.kind === 'youtube' && source.videoId) return new YouTubeAdapter(container, source.videoId, emit);
  return new Html5Adapter(container, source, emit);
}
