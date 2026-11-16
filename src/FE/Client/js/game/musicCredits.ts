// "Âm nhạc" credits at the end of the sound panel (VUAN-5): the songs heard in this session, newest first, with author,
// licence and a link to the original page. Author and link come from the music library index; a song from outside the
// library shows what its case says (title, source, licence).
import { escapeHtml } from '../utils/dom.js';
import type { SceneMusic } from './audioController.js';

export const MUSIC_INDEX_URL = '/assets/audio/music/index.json';
const MAX_CREDITS = 8;
const SOURCE_NAMES: Record<string, string> = { opengameart: 'OpenGameArt', kenney: 'Kenney', pixabay: 'Pixabay' };

type LibraryTrack = { file: string; title: string; author: string; source: string; sourceUrl: string; license: string };
let library: Promise<Map<string, LibraryTrack>> | null = null;

/** Path of a music URL on this site (/assets/...), or the URL itself for another host. */
function key(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin ? parsed.pathname : parsed.href;
  } catch { return url; }
}

function loadLibrary(): Promise<Map<string, LibraryTrack>> {
  library ??= fetch(MUSIC_INDEX_URL)
    .then((response) => response.ok ? response.json() : { tracks: [] })
    .then((index) => new Map<string, LibraryTrack>((index?.tracks ?? []).map((track: LibraryTrack) => [track.file, track])))
    .catch(() => new Map());
  return library;
}

export function renderMusicCredits(tr: (en: string, vi: string) => string): string {
  return `<div class="game-audio-credits" data-audio-credits hidden><p class="game-audio-credits-title">${tr('Music', 'Âm nhạc')}</p><ul data-audio-credit-list></ul></div>`;
}

function creditLine(music: SceneMusic, track: LibraryTrack | undefined, tr: (en: string, vi: string) => string): string {
  const title = `<cite>${escapeHtml(track?.title ?? music.title ?? tr('Untitled', 'Không tên'))}</cite>`;
  const source = track?.source ?? music.source ?? '';
  if (source === 'claude-8bit') return `<li>${title} · ${tr('composed for Sir Locked', 'Sir Locked tự sáng tác')}</li>`;
  const parts = [title];
  if (track?.author) parts.push(escapeHtml(track.author));
  const licence = track?.license ?? music.license;
  if (licence) parts.push(escapeHtml(licence));
  const page = track?.sourceUrl ?? '';
  const name = SOURCE_NAMES[source] ?? (source ? escapeHtml(source) : '');
  if (/^https:\/\//.test(page)) parts.push(`<a href="${escapeHtml(page)}" target="_blank" rel="noopener noreferrer">${name || tr('Source', 'Nguồn')}</a>`);
  else if (name) parts.push(name);
  return `<li>${parts.join(' · ')}</li>`;
}

/** Keeps the credits of the songs heard so far; call add() with each area's music. */
export function createMusicCredits(root: ParentNode, tr: (en: string, vi: string) => string) {
  const heard = new Map<string, SceneMusic>();
  let disposed = false;
  let paintRevision = 0;
  /** The list on screen matches `heard` (the sound panel may not exist yet when the first area loads). */
  let shown = false;
  async function paint() {
    const revision = ++paintRevision;
    const tracks = await loadLibrary();
    if (disposed || revision !== paintRevision) return;
    const box = root.querySelector<HTMLElement>('[data-audio-credits]');
    const list = box?.querySelector<HTMLElement>('[data-audio-credit-list]');
    if (!box || !list) { shown = false; return; }
    const entries = [...heard.entries()].reverse();
    list.innerHTML = entries.map(([path, music]) => creditLine(music, tracks.get(path), tr)).join('');
    box.hidden = entries.length === 0;
    box.closest('details')?.classList.toggle('has-credits', entries.length > 0);
    shown = true;
  }
  return {
    add(music: SceneMusic | null | undefined) {
      if (disposed || !music || typeof music.url !== 'string' || !music.url) return;
      const path = key(music.url);
      if (shown && [...heard.keys()].at(-1) === path) return; // same area song, already on screen
      shown = false;
      if (heard.has(path)) heard.delete(path);
      heard.set(path, music);
      while (heard.size > MAX_CREDITS) heard.delete(heard.keys().next().value as string);
      void paint();
    },
    /** The credit list as plain data, for tests. */
    entries: () => [...heard.keys()].reverse(),
    dispose() { disposed = true; },
  };
}
