// TV mode: the interface driven by a remote. Arrow keys move the focus to the
// nearest control on screen (spatial navigation), OK clicks it, Back closes
// what is open or goes back, media keys reach the player, and the layout is
// scaled for a screen watched from the sofa. It turns on by itself on Android
// TV / Google TV (and the Rivo TV app), Samsung Tizen, LG webOS and other TV
// browsers, and can be forced from Settings → Appearance or with ?tv=1 / ?tv=0.

export type TvPref = 'auto' | 'on' | 'off';
const KEY = 'hc.tv';

// The Android TV app (tv/android) exposes this bridge to the page.
type Bridge = { exit?: () => void; changeServer?: () => void; server?: () => string; version?: () => string; keepAwake?: (on: boolean) => void };
export const tvApp = (): Bridge | undefined => (window as any).RivoTV;

const tvUA = /Rivo-TV|Android TV|GoogleTV|Google TV|\bAFT[A-Z]|BRAVIA|SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|HbbTV|VIDAA|Opera TV|OMI\/|CrKey|\bDTV\b|Roku/i;

export function tvPref(): TvPref {
  try { const v = localStorage.getItem(KEY); return v === 'on' || v === 'off' ? v : 'auto'; } catch { return 'auto'; }
}

export function setTvPref(p: TvPref) {
  try { if (p === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* private mode */ }
  window.location.reload();
}

export const tvDetected = () => !!tvApp() || tvUA.test(navigator.userAgent);

let on = false;
export const isTv = () => on;

// Remote keys arrive with different names on different TVs; this maps the
// platform key codes to the standard KeyboardEvent.key values.
const codes: Record<number, string> = {
  461: 'GoBack', 10009: 'GoBack', 166: 'GoBack', // webOS, Tizen, BrowserBack
  415: 'MediaPlay', 19: 'MediaPause', 10252: 'MediaPlayPause', 179: 'MediaPlayPause',
  417: 'MediaFastForward', 412: 'MediaRewind', 413: 'MediaStop', 178: 'MediaStop',
  425: 'MediaTrackNext', 424: 'MediaTrackPrevious', 176: 'MediaTrackNext', 177: 'MediaTrackPrevious',
  13: 'Enter', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
};
export function tvKey(e: KeyboardEvent): string {
  if (e.key && e.key !== 'Unidentified') {
    if (e.key === 'BrowserBack' || e.key === 'Back' || e.key === 'XF86Back') return 'GoBack';
    return e.key;
  }
  return codes[e.keyCode] || e.key;
}

// ---------- spatial navigation ----------

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[role="slider"]';
type Dir = 'up' | 'down' | 'left' | 'right';
const dirs: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function visible(el: HTMLElement): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  if (el.closest('[aria-hidden="true"],[inert],.hk')) return null;
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || Number(st.opacity) === 0) return null;
  return r;
}

// The layer the focus may move in: an open dialog keeps it inside.
function scopeRoot(): ParentNode {
  const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"],[role="menu"]');
  return modals.length ? modals[modals.length - 1] : document;
}

function candidates(scope: ParentNode): [HTMLElement, DOMRect][] {
  const out: [HTMLElement, DOMRect][] = [];
  scope.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
    const r = visible(el);
    if (r) out.push([el, r]);
  });
  return out;
}

// gap is how far b lies past a in the direction; overlap-aware cross distance
// keeps the focus in the same row or column when there is one.
function score(a: DOMRect, b: DOMRect, d: Dir): number | null {
  const ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
  const bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2;
  let gap: number, cross: number;
  if (d === 'left' || d === 'right') {
    if (d === 'right' ? bx <= ax + 1 || b.right <= a.right : bx >= ax - 1 || b.left >= a.left) return null;
    gap = Math.max(0, d === 'right' ? b.left - a.right : a.left - b.right);
    const ov = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    cross = ov > 0 ? Math.abs(ay - by) / 8 : -ov + Math.abs(ay - by) / 4;
  } else {
    if (d === 'down' ? by <= ay + 1 || b.bottom <= a.bottom : by >= ay - 1 || b.top >= a.top) return null;
    gap = Math.max(0, d === 'down' ? b.top - a.bottom : a.top - b.bottom);
    const ov = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    // Vertical moves prefer what is under the focus, then the left-most item.
    cross = ov > 0 ? Math.abs(b.left - a.left) / 8 : -ov + Math.abs(ax - bx) / 4;
  }
  return gap + cross * 3;
}

function bringIntoView(el: HTMLElement, d?: Dir) {
  const calm = document.documentElement.querySelector('.app.calm') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: d === 'up' || d === 'down' ? 'center' : 'nearest', inline: 'nearest', behavior: calm ? 'auto' : 'smooth' });
}

export function focusEl(el: HTMLElement, d?: Dir) {
  el.focus({ preventScroll: true });
  bringIntoView(el, d);
}

// The first control of the page content, for when nothing has the focus.
export function focusFirst(scope: ParentNode = scopeRoot()): boolean {
  const main = scope === document ? document.querySelector('main') || document : scope;
  const vh = window.innerHeight;
  const all = candidates(main);
  // Past the header: the hero's Play button or the first poster, not "Back".
  const body = all.filter(([el]) => !el.closest('.topbar'));
  const pool = body.length ? body : all;
  const list = pool.filter(([, r]) => r.bottom > 0 && r.top < vh);
  const pick = (list.length ? list : pool).sort(([, a], [, b]) => (a.top - b.top) || (a.left - b.left))[0];
  if (!pick) return false;
  focusEl(pick[0]);
  return true;
}

// focusPage puts the focus on a new page's main action (Play / Watch now),
// once it has rendered, unless the user already moved it.
let pageTimer = 0;
export function focusPage() {
  if (!on) return;
  window.clearTimeout(pageTimer);
  let tries = 0;
  const tick = () => {
    const a = document.activeElement;
    if (a && a !== document.body) return;
    if (document.querySelector('.player')) return;
    const vh = window.innerHeight;
    const main = candidates(document.querySelector('main') || document).filter(([el, r]) => !el.closest('.topbar') && r.bottom > 0 && r.top < vh);
    const primary = main.find(([el]) => el.matches('[data-tv-first],.btn-w,.btn-d'));
    if (primary) { focusEl(primary[0]); return; }
    if (++tries < 10) { pageTimer = window.setTimeout(tick, 300); return; }
    focusFirst();
  };
  pageTimer = window.setTimeout(tick, 300);
}

// move shifts the focus one step; false when there is nowhere to go.
export function move(d: Dir, scope: ParentNode = scopeRoot()): boolean {
  const cur = document.activeElement as HTMLElement | null;
  const all = candidates(scope);
  const at = cur && cur !== document.body && all.find(([el]) => el === cur);
  if (!at) return focusFirst(scope);
  let best: HTMLElement | null = null, bs = Infinity;
  for (const [el, r] of all) {
    if (el === cur || el.contains(cur) || cur!.contains(el)) continue;
    const s = score(at[1], r, d);
    if (s !== null && s < bs) { bs = s; best = el; }
  }
  if (!best) {
    // At the top of the page there may be content above the first control.
    if (d === 'up' && window.scrollY > 0) { window.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
    return false;
  }
  focusEl(best, d);
  return true;
}

// ---------- Back ----------

let navigate: ((to: string | number) => void) | null = null;
export function setTvNavigate(f: typeof navigate) { navigate = f; }

function escape() {
  const t = (document.activeElement as HTMLElement | null) || document.body;
  t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
}

// back is what the remote's Back does. It returns 'exit' when there is
// nothing left to close and the app itself should close.
export function back(): 'handled' | 'exit' {
  const a = document.activeElement as HTMLElement | null;
  if (document.querySelector('.player,[aria-modal="true"],[role="menu"]')) { escape(); return 'handled'; }
  if (a && a.matches('input:not([type=range]):not([type=checkbox]),textarea')) { a.blur(); return 'handled'; }
  const idx = (window.history.state && window.history.state.idx) || 0;
  if (idx > 0) { window.history.back(); return 'handled'; }
  if (window.location.pathname !== '/') { navigate ? navigate('/') : window.location.assign('/'); return 'handled'; }
  return 'exit';
}

function exitApp() {
  const app = tvApp();
  if (app?.exit) { app.exit(); return; }
  try { (window as any).tizen?.application.getCurrentApplication().exit(); return; } catch { /* not Tizen */ }
  try { (window as any).webOS?.platformBack(); } catch { /* not webOS */ }
}

// ---------- install ----------

function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  const k = tvKey(e);
  const t = e.target as HTMLElement;
  const typing = t?.matches?.('input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea');
  if (k === 'GoBack' || (k === 'Backspace' && !typing)) {
    e.preventDefault();
    if (back() === 'exit') exitApp();
    return;
  }
  // The player drives its own keys.
  if (document.querySelector('.player')) return;
  const d = dirs[k];
  if (d) {
    if (t?.matches?.('select')) return;
    if (t?.matches?.('input[type=range]') && (d === 'left' || d === 'right')) return;
    if (typing && (d === 'left' || d === 'right')) {
      const i = t as HTMLInputElement;
      const end = (i.value || '').length;
      try { if (d === 'left' ? i.selectionStart !== 0 : i.selectionEnd !== end) return; } catch { /* types without a caret */ }
    }
    if (move(d)) e.preventDefault();
    return;
  }
  if (k === 'Enter' && t?.matches?.('input[type=checkbox],input[type=radio],[role="switch"],[role="checkbox"],[tabindex]:not(a):not(button):not(input):not(select):not(textarea)')) {
    e.preventDefault();
    t.click();
  }
}

// Tizen hands media keys to a page only after it asks for them.
function registerTizenKeys() {
  const dev = (window as any).tizen?.tvinputdevice;
  if (!dev) return;
  for (const k of ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious']) {
    try { dev.registerKey(k); } catch { /* key not on this remote */ }
  }
}

export function installTv() {
  const q = new URLSearchParams(window.location.search).get('tv');
  if (q === '1' || q === '0') { try { localStorage.setItem(KEY, q === '1' ? 'on' : 'off'); } catch { /* private mode */ } }
  const p = tvPref();
  on = p === 'on' || (p === 'auto' && tvDetected());
  if (!on) return;
  document.documentElement.classList.add('tv');
  registerTizenKeys();
  window.addEventListener('keydown', onKey);
  // The Android TV app sends Back and the media keys here.
  (window as any).rivoTvBack = () => back();
  (window as any).rivoTvKey = (key: string) => {
    const t = (document.activeElement as HTMLElement | null) || document.body;
    t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
}
