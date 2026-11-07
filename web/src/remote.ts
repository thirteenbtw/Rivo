// Remote control between Rivo windows: Rivo on the TV (or a PC) is a
// "screen", and a phone opens the Remote page to drive it. A screen names
// itself on its event stream, reports what it shows, and runs the commands
// the server hands it there: open a title, player controls, remote keys and
// text typed on the phone.
import { api } from './api';
import { back, focusFirst, isTv, move, tvApp } from './tv';
import { tr } from './i18n';

export type ScreenTrack = { index: number; label: string };
export type ScreenPlayer = {
  title: string; info?: string; poster?: string; paused: boolean; waiting: boolean; position: number; duration: number;
  volume: number; muted: boolean; audio: ScreenTrack[]; subs: ScreenTrack[]; audioSel: number; subSel: number; hasNext: boolean; error?: string;
};
export type ScreenState = { path: string; title: string; typing: boolean; player?: ScreenPlayer | null };
export type Screen = { id: string; name: string; tv: boolean; addr: string; since: number; state?: ScreenState };

export type RemoteCmd =
  | { cmd: 'open'; path: string }
  | { cmd: 'key'; key: string }
  | { cmd: 'text'; value: string; submit?: boolean }
  | { cmd: 'toggle' | 'play' | 'pause' | 'close' | 'next' }
  | { cmd: 'seek'; to: number }
  | { cmd: 'seekBy'; by: number }
  | { cmd: 'volume'; level: number }
  | { cmd: 'mute'; on: boolean }
  | { cmd: 'audio'; index: number }
  | { cmd: 'sub'; index: number };

// ---------- who this window is ----------

function randomId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return 's-' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Per tab: two tabs of one browser are two screens; a reload keeps the id.
let id = '';
export function screenId(): string {
  if (id) return id;
  try { id = sessionStorage.getItem('hc.screen') || ''; } catch { /* private mode */ }
  if (!id) { id = randomId(); try { sessionStorage.setItem('hc.screen', id); } catch { /* private mode */ } }
  return id;
}

// A phone is the remote, not a screen: it would only clutter the list.
export function isPhone(): boolean {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return !!coarse && Math.min(window.screen.width, window.screen.height) < 600 && !isTv();
}

export const acceptsRemote = () => !isPhone();

const NAME = 'hc.screenName';
export function defaultScreenName(): string {
  const ua = navigator.userAgent;
  if (tvApp() || isTv()) {
    if (/Tizen/i.test(ua)) return 'Samsung TV';
    if (/Web0S|webOS/i.test(ua)) return 'LG TV';
    return tr('Телевизор', 'TV');
  }
  if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__) return tr('Rivo на ПК', 'Rivo on PC');
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : tr('Браузер', 'Browser');
  return os ? `${br} · ${os}` : br;
}
export function screenName(): string {
  try { return localStorage.getItem(NAME) || defaultScreenName(); } catch { return defaultScreenName(); }
}
export function setScreenName(n: string) {
  try { if (n.trim()) localStorage.setItem(NAME, n.trim()); else localStorage.removeItem(NAME); } catch { /* private mode */ }
}

// The event stream URL: a screen names itself so it gets its commands there.
export function eventsUrl(): string {
  if (!acceptsRemote()) return '/api/events';
  const q = new URLSearchParams({ screen: screenId(), name: screenName() });
  if (isTv()) q.set('tv', '1');
  return '/api/events?' + q;
}

// ---------- what this screen shows ----------

let player: ScreenPlayer | null = null;
let attached = false;
let timer = 0;
let lastSent = 0;
let lastJson = '';

function typingNow() {
  const a = document.activeElement as HTMLElement | null;
  return !!a?.matches?.('input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea');
}

function snapshot(): ScreenState {
  return { path: window.location.pathname + window.location.search, title: document.title, typing: typingNow(), player };
}

function send() {
  timer = 0;
  if (!attached || !acceptsRemote()) return;
  const body = JSON.stringify(snapshot());
  if (body === lastJson) return;
  lastJson = body;
  lastSent = Date.now();
  fetch(`/api/screens/${screenId()}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body })
    .then((r) => { if (r.status === 404) lastJson = ''; }) // not registered yet: the next report retries
    .catch(() => { lastJson = ''; });
}

// report queues a state update; at most one a second unless urgent.
export function report(urgent = false) {
  if (!attached) return;
  if (urgent) { window.clearTimeout(timer); timer = window.setTimeout(send, 50); return; }
  if (timer) return;
  timer = window.setTimeout(send, Math.max(50, 1000 - (Date.now() - lastSent)));
}

export function reportPlayer(p: ScreenPlayer | null) {
  const urgent = !player || !p || player.paused !== p.paused || player.audioSel !== p.audioSel || player.subSel !== p.subSel || player.volume !== p.volume || player.muted !== p.muted || Math.abs(player.position - p.position) > 5;
  player = p;
  report(urgent);
}

// Called by the event stream: connected (the server now lists this screen).
export function screenAttached(on: boolean) {
  attached = on && acceptsRemote();
  lastJson = '';
  if (attached) report(true);
}

// ---------- running commands ----------

type PlayerHandler = (c: RemoteCmd) => boolean;
let playerHandler: PlayerHandler | null = null;
export function setPlayerHandler(h: PlayerHandler | null) { playerHandler = h; }

let navigate: ((to: string) => void) | null = null;
export function setRemoteNavigate(f: typeof navigate) { navigate = f; }

function keyDown(key: string) {
  const t = (document.activeElement as HTMLElement | null) || document.body;
  t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function remoteKey(key: string) {
  const inPlayer = !!document.querySelector('.player');
  if (key === 'GoBack') { back(); return; }
  if (key === 'Home') { navigate?.('/'); return; }
  if (inPlayer || key.startsWith('Media')) { keyDown(key); return; }
  const d = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as Record<string, 'up' | 'down' | 'left' | 'right' | undefined>)[key];
  const a = document.activeElement as HTMLElement | null;
  if (d) {
    // A slider takes ←/→ itself.
    if (a?.matches?.('input[type=range]') && (d === 'left' || d === 'right')) { keyDown(key); return; }
    move(d);
    return;
  }
  if (key === 'Enter') {
    if (!a || a === document.body) { focusFirst(); return; }
    if (a.matches('input,textarea,select')) { keyDown('Enter'); a.closest('form')?.requestSubmit(); return; }
    a.click();
  }
}

// Typing from the phone: into the focused field, or a search.
function typeText(value: string, submit?: boolean) {
  const a = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (a && typingNow()) {
    const proto = a instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(a, value);
    a.dispatchEvent(new Event('input', { bubbles: true }));
    if (submit) {
      a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      a.closest('form')?.requestSubmit();
    }
  } else if (value.trim()) {
    navigate?.('/search?q=' + encodeURIComponent(value.trim()));
  }
  report(true);
}

export function runRemote(c: RemoteCmd) {
  switch (c.cmd) {
    case 'open':
      // Only this app's own pages.
      if (typeof c.path === 'string' && c.path.startsWith('/') && !c.path.startsWith('//')) navigate?.(c.path);
      return;
    case 'key': if (typeof c.key === 'string') remoteKey(c.key); return;
    case 'text': typeText(String(c.value ?? ''), c.submit); return;
  }
  playerHandler?.(c);
}

// ---------- the phone side ----------

export const sendRemote = (screen: string, c: RemoteCmd) => api.post(`/api/screens/${encodeURIComponent(screen)}/command`, c);

export function playPath(t: { fileId?: number; itemId?: number; torrent?: string; file?: number; start?: number; audio?: number; sub?: number }): string {
  const q = new URLSearchParams();
  if (t.torrent) {
    q.set('file', String(t.file ?? -1));
    return `/play/torrent/${t.torrent}?${q}`;
  }
  if (t.itemId) q.set('item', String(t.itemId));
  if (t.start && t.start > 0) q.set('start', String(Math.floor(t.start)));
  if (t.audio !== undefined && t.audio >= 0) q.set('audio', String(t.audio));
  if (t.sub !== undefined && t.sub >= 0) q.set('sub', String(t.sub));
  const s = q.toString();
  return `/play/${t.fileId}${s ? '?' + s : ''}`;
}
