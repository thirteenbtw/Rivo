import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Hls from 'hls.js';
import { api, clientCaps, fmtSize, fmtTime, type Item, type Playback, type PlayTrack, type StreamStatus } from '../api';
import { useApp } from '../state';
import { tr } from '../i18n';
import { Icon, PauseGlyph, PlayGlyph } from '../components/Icon';
import { focusEl, isTv, move, tvApp, tvKey } from '../tv';
import { reportPlayer, setPlayerHandler, type RemoteCmd } from '../remote';

type Cue = { start: number; end: number; text: string };
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

function parseVTT(src: string): Cue[] {
  const toSec = (s: string) => {
    const p = s.trim().replace(',', '.').split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  const out: Cue[] = [];
  for (const block of src.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (text) out.push({ start: toSec(a), end: toSec(b.trim().split(/\s+/)[0]), text });
  }
  return out;
}

// Full-screen player (FR-7..FR-10): direct play or HLS transcode, own subtitle
// rendering with offset, tracks popover, hotkeys, progress sync, next episode.
export default function Player() {
  const { fileId, hash } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { openCast, state, toast } = useApp();
  const itemId = Number(params.get('item') || 0);
  const torrentFile = Number(params.get('file') ?? -1);
  const video = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [pb, setPb] = useState<Playback | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cur, setCur] = useState(0); // movie time
  const [buffered, setBuffered] = useState(0);
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(true);
  const [vol, setVol] = useState(() => Number(localStorage.getItem('hc.vol') ?? 1));
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [panel, setPanel] = useState<null | 'subs' | 'audio' | 'speed'>(null);
  const [subIdx, setSubIdx] = useState<number>(() => Number(params.get('sub') ?? -1));
  const [cues, setCues] = useState<Cue[]>([]);
  const [subDelay, setSubDelay] = useState(0);
  const [hover, setHover] = useState<{ f: number; t: number } | null>(null);
  const [idle, setIdle] = useState(false);
  const [next, setNext] = useState<Item | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [stream, setStream] = useState<StreamStatus | null>(null);
  const [autoNext, setAutoNext] = useState(true);
  const lastSaved = useRef(0);
  const idleTimer = useRef<number>();
  const overBars = useRef(false);
  const startAt = useRef(Number(params.get('start') || 0));
  const opts = useRef({ audio: params.get('audio') ?? '', burn: '', nodirect: false });

  const offset = pb?.mode === 'hls' ? pb.offset : 0;
  const duration = pb?.duration || video.current?.duration || 0;

  // Load (or reload, after an audio switch or a far seek) the playback session.
  // A torrent stream opened without a start resumes where it was left (the
  // server knows the position); later reloads always name their position.
  const loaded = useRef(false);
  const subsPicked = useRef(false);
  const load = useCallback(async (start: number) => {
    setErr(null); setWaiting(true);
    const q = new URLSearchParams(clientCaps());
    if (start > 0 || (hash && loaded.current)) q.set('start', String(Math.floor(start)));
    loaded.current = true;
    if (opts.current.audio !== '') q.set('audio', opts.current.audio);
    if (opts.current.burn) { q.set('sub', opts.current.burn); q.set('burn', '1'); }
    if (opts.current.nodirect) q.set('nodirect', '1');
    if (!subsPicked.current && params.get('sub') === null) q.set('autosub', '1');
    try {
      const url = hash ? `/api/torrents/${hash}/play?file=${torrentFile}&${q}` : `/api/play/${fileId}?${q}`;
      const p = await api.get<Playback>(url);
      // The first answer carries the default subtitles (settings: language).
      if (!subsPicked.current) {
        subsPicked.current = true;
        const d = params.get('sub') === null && p.subs.find((x) => x.selected && !x.bitmap);
        if (d) setSubIdx(d.index);
      }
      setPb((old) => {
        if (old?.session && old.session !== p.session) api.del(`/api/hls/${old.session}`).catch(() => {});
        return p;
      });
    } catch (e: any) { setErr(e.message); }
  }, [fileId, hash, torrentFile]);

  useEffect(() => { load(startAt.current); }, [load]);

  // Attach the source when the session changes.
  useEffect(() => {
    const v = video.current;
    if (!pb || !v) return;
    hlsRef.current?.destroy(); hlsRef.current = null;
    const seekTo = pb.mode === 'direct' ? pb.start : 0;
    const onMeta = () => { if (seekTo > 0) v.currentTime = seekTo; v.play().catch(() => setPaused(true)); };
    v.addEventListener('loadedmetadata', onMeta, { once: true });
    if (pb.mode === 'hls' && Hls.isSupported()) {
      const h = new Hls({ maxBufferLength: 60, manifestLoadingMaxRetry: 30, manifestLoadingRetryDelay: 1000, levelLoadingMaxRetry: 30 });
      h.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
        else setErr(tr('Ошибка воспроизведения потока', 'Stream playback error') + ` (${d.type}: ${d.details}${d.error?.message ? ', ' + d.error.message : ''})`);
      });
      h.loadSource(pb.url);
      h.attachMedia(v);
      hlsRef.current = h;
    } else {
      v.src = pb.url;
    }
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, [pb]);

  // The file is played as is when the browser should decode it; if it cannot
  // after all (an error, or a picture-less video), ask for a remux instead.
  const directFailed = useCallback(() => {
    if (pb?.mode !== 'direct' || opts.current.nodirect) return false;
    opts.current.nodirect = true;
    load(video.current?.currentTime || pb.start || 0);
    return true;
  }, [pb, load]);
  useEffect(() => {
    const v = video.current;
    if (!v || pb?.mode !== 'direct') return;
    const check = () => { if (v.videoWidth === 0) directFailed(); };
    v.addEventListener('loadedmetadata', check, { once: true });
    return () => v.removeEventListener('loadedmetadata', check);
  }, [pb, directFailed]);

  useEffect(() => () => { hlsRef.current?.destroy(); }, []);
  useEffect(() => () => { if (pb?.session) api.del(`/api/hls/${pb.session}`).catch(() => {}); }, [pb?.session]);

  // Subtitles, in movie time, shown by our own renderer. The server pulls the
  // track out from the player's position on and hands over cues as it reads
  // through the file (a 4K file or a downloading torrent takes minutes to
  // read in full), so they are polled until done. Cues of a track are kept
  // across seeks; a seek outside what was extracted starts from there.
  const subUrl = pb?.subs.find((s) => s.index === subIdx)?.url?.split('?')[0] || '';
  const subRanges = useRef<{ from: number; end: number; done: boolean }[]>([]);
  const [subFrom, setSubFrom] = useState<number | null>(null);
  useEffect(() => {
    setCues([]);
    subRanges.current = [];
    setSubFrom(subUrl && !opts.current.burn ? Math.max(0, Math.floor((video.current?.currentTime || 0) + offset - 10)) : null);
  }, [subUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (subFrom === null || !subUrl || subRanges.current.some((r) => subFrom >= r.from - 1 && subFrom <= (r.done ? Infinity : r.end + 60))) return;
    const range = { from: subFrom, end: subFrom, done: false };
    subRanges.current.push(range);
    let gone = false, timer = 0, fails = 0;
    const poll = () => fetch(`${subUrl}?from=${subFrom}`).then(async (r) => {
      if (!r.ok) throw new Error(await r.text());
      const got = parseVTT(await r.text());
      if (gone) return;
      range.done = r.headers.get('X-Subs-Done') !== '0';
      if (got.length) {
        range.end = Math.max(range.end, got[got.length - 1].end);
        setCues((old) => {
          const seen = new Set(old.map((c) => `${c.start}|${c.text}`));
          const add = got.filter((c) => !seen.has(`${c.start}|${c.text}`));
          return add.length ? [...old, ...add].sort((x, y) => x.start - y.start) : old;
        });
      }
      if (!range.done) timer = window.setTimeout(poll, 3000);
    }).catch(() => {
      if (gone) return;
      if (++fails < 3) { timer = window.setTimeout(poll, 3000); return; }
      range.done = true;
      toast(tr('Не удалось загрузить субтитры', 'Could not load subtitles'));
    });
    poll();
    return () => { gone = true; clearTimeout(timer); if (!range.done) subRanges.current = subRanges.current.filter((r) => r !== range); };
  }, [subFrom, subUrl, toast]);
  useEffect(() => {
    if (subFrom === null || subRanges.current.some((r) => cur >= r.from - 1 && cur <= (r.done ? Infinity : r.end + 60))) return;
    setSubFrom(Math.max(0, Math.floor(cur - 10)));
  }, [cur, subFrom]);

  // Next episode and autoplay preference.
  useEffect(() => {
    if (!itemId) return;
    api.get<{ next: Item | null }>(`/api/items/${itemId}`).then((r) => setNext(r.next)).catch(() => {});
    api.get<{ autoNext: string }>('/api/settings').then((s) => setAutoNext(s.autoNext !== '0')).catch(() => {});
  }, [itemId]);

  // Torrent buffer status while streaming.
  useEffect(() => {
    if (!hash) return;
    let stop = false;
    const tick = () => api.get<StreamStatus>(`/api/torrents/${hash}/stream?file=${torrentFile}&cells=120`).then((s) => !stop && setStream(s)).catch(() => {});
    tick();
    const id = window.setInterval(tick, 2000);
    return () => { stop = true; clearInterval(id); };
  }, [hash, torrentFile]);

  const tfile = hash ? pb?.torrentFile ?? -1 : -1;
  const saveProgress = useCallback((force = false) => {
    if ((!itemId && tfile < 0) || !duration || cur <= 0) return;
    const now = Date.now();
    if (!force && now - lastSaved.current < 10000) return;
    lastSaved.current = now;
    const [url, body] = itemId ? [`/api/items/${itemId}/progress`, { position: cur, duration, device: 'pc' }]
      : [`/api/torrents/${hash}/progress`, { file: tfile, position: cur, duration }];
    fetch(url, {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify(body),
    }).catch(() => {});
  }, [itemId, hash, tfile, cur, duration]);

  useEffect(() => { if (!paused) saveProgress(); }, [cur, paused, saveProgress]);
  useEffect(() => {
    const onHide = () => saveProgress(true);
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); };
  }, [saveProgress]);
  const saveRef = useRef(saveProgress); saveRef.current = saveProgress;
  useEffect(() => () => saveRef.current(true), []);

  useEffect(() => { if (video.current) { video.current.volume = vol; video.current.muted = muted; } try { localStorage.setItem('hc.vol', String(vol)); } catch { /* ignore */ } }, [vol, muted]);
  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed, pb]);

  // Seeking: inside the transcoded range locally, otherwise restart transcoding.
  const seek = (t: number) => {
    const v = video.current;
    if (!v || !pb) return;
    t = Math.max(0, Math.min(duration - 1, t));
    if (pb.mode === 'direct') { v.currentTime = t; return; }
    const local = t - pb.offset;
    let end = 0;
    for (let i = 0; i < v.seekable.length; i++) end = Math.max(end, v.seekable.end(i));
    if (local >= 0 && local <= end - 2) v.currentTime = local;
    else { setCur(t); load(t); }
  };
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); };
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else root.current?.requestFullscreen().catch(() => {}); };
  const close = () => { saveProgress(true); if (window.history.length > 1) nav(-1); else nav('/'); };

  const pickAudio = (idx: number) => { opts.current.audio = String(idx); setPanel(null); load(cur); };
  const pickSub = (i: number) => {
    const t = pb?.subs.find((s) => s.index === i);
    setPanel(null);
    setSubIdx(i);
    if (t?.bitmap || opts.current.burn) {
      // Picture subtitles (PGS/VobSub) can only be burned in by the server.
      opts.current.burn = t?.bitmap ? String(i) : '';
      load(cur);
    }
  };

  const tv = isTv();
  useEffect(() => () => tvApp()?.keepAwake?.(false), []);
  const controls = useRef<HTMLElement>(null);
  // On a remote: with the controls hidden ←/→ seek and OK pauses; ↑/↓ bring
  // the controls up and the arrows then walk them (the position bar still
  // seeks with ←/→). The controls hide again by themselves and give the
  // arrows back to seeking.
  const onTvKey = (e: KeyboardEvent, k: string): boolean => {
    const t = e.target as HTMLElement;
    const inUi = !!t?.closest?.('header,footer,section,button');
    if (k === 'GoBack' || k === 'Escape' || k === 'Backspace') return false; // handled below as Escape
    if (!inUi) {
      if (k === 'ArrowLeft') { seek(cur - 10); return true; }
      if (k === 'ArrowRight') { seek(cur + 10); return true; }
      if (k === 'Enter' || k === ' ') { toggle(); return true; }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        const b = controls.current?.querySelector<HTMLElement>('button');
        if (b) focusEl(b);
        return true;
      }
      return false;
    }
    if (t.getAttribute('role') === 'slider' && (k === 'ArrowLeft' || k === 'ArrowRight')) return false;
    const d = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as Record<string, 'up' | 'down' | 'left' | 'right'>)[k];
    if (d) {
      if (!move(d, root.current!) && d === 'down') t.blur();
      return true;
    }
    return false;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const k = tvKey(e);
      // Remote media keys work everywhere, TV mode or not.
      switch (k) {
        case 'MediaPlayPause': e.preventDefault(); toggle(); wake(); return;
        case 'MediaPlay': e.preventDefault(); video.current?.play().catch(() => {}); wake(); return;
        case 'MediaPause': e.preventDefault(); video.current?.pause(); wake(); return;
        case 'MediaFastForward': e.preventDefault(); seek(cur + 30); wake(); return;
        case 'MediaRewind': e.preventDefault(); seek(cur - 30); wake(); return;
        case 'MediaStop': e.preventDefault(); close(); return;
        case 'MediaTrackNext': if (next) { e.preventDefault(); goNext(); } return;
      }
      if (tv && onTvKey(e, k)) { e.preventDefault(); wake(); return; }
      if ((e.target as HTMLElement).closest('input,select,textarea')) return;
      switch (e.key) {
        case ' ': case 'k': case 'л': case 'Enter': if (e.key === 'Enter' && (e.target as HTMLElement).closest('button,[role=slider]')) break; e.preventDefault(); toggle(); break;
        case 'ArrowLeft': e.preventDefault(); seek(cur - 10); break;
        case 'ArrowRight': e.preventDefault(); seek(cur + 10); break;
        case 'ArrowUp': e.preventDefault(); setVol((v) => Math.min(1, v + 0.1)); break;
        case 'ArrowDown': e.preventDefault(); setVol((v) => Math.max(0, v - 0.1)); break;
        case 'f': case 'F': case 'а': case 'А': fullscreen(); break;
        case 'm': case 'ь': setMuted((m) => !m); break;
        case 's': case 'S': case 'ы': case 'Ы': setPanel((p) => (p === 'subs' ? null : 'subs')); break;
        case 'Escape': case 'GoBack': if (panel) setPanel(null); else if (!document.fullscreenElement || tv) close(); break;
      }
      wake();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const wake = () => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (overBars.current) return;
      setIdle(true);
      // Hidden controls give the remote's arrows back to seeking.
      if (tv && root.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    }, tv ? 5000 : 3000);
  };
  // Listen on the document, not the player div: in fullscreen (WebView2 in
  // particular) mouse events don't always reach the React handler on the
  // fullscreen element, and the controls would never come back.
  useEffect(() => {
    const evs = ['pointermove', 'mousemove', 'pointerdown', 'wheel', 'touchstart'];
    evs.forEach((e) => document.addEventListener(e, wake, { capture: true, passive: true }));
    document.addEventListener('fullscreenchange', wake);
    return () => {
      evs.forEach((e) => document.removeEventListener(e, wake, { capture: true }));
      document.removeEventListener('fullscreenchange', wake);
      window.clearTimeout(idleTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Next episode countdown.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { goNext(); return; }
    const id = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [countdown]); // eslint-disable-line react-hooks/exhaustive-deps
  const goNext = () => {
    setCountdown(null);
    const f = next?.files?.[0];
    if (next && f) nav(`/play/${f.id}?item=${next.id}`, { replace: true });
  };

  // A phone driving this screen: it sees what plays and sends the controls.
  const remoteRef = useRef<(c: RemoteCmd) => boolean>(() => false);
  remoteRef.current = (c) => {
    const v = video.current;
    switch (c.cmd) {
      case 'toggle': toggle(); break;
      case 'play': v?.play().catch(() => {}); break;
      case 'pause': v?.pause(); break;
      case 'seek': if (isFinite(c.to)) seek(c.to); break;
      case 'seekBy': if (isFinite(c.by)) seek(cur + c.by); break;
      case 'volume': if (isFinite(c.level)) { setMuted(false); setVol(Math.max(0, Math.min(1, c.level))); } break;
      case 'mute': setMuted(!!c.on); break;
      case 'audio': if (pb?.audio.some((a) => a.index === c.index)) pickAudio(c.index); break;
      case 'sub': if (c.index === -1 || pb?.subs.some((s) => s.index === c.index)) pickSub(c.index); break;
      case 'close': close(); return true;
      case 'next': if (next) goNext(); break;
      default: return false;
    }
    wake();
    return true;
  };
  useEffect(() => {
    setPlayerHandler((c) => remoteRef.current(c));
    return () => { setPlayerHandler(null); reportPlayer(null); };
  }, []);
  const secs = Math.floor(cur);
  useEffect(() => {
    reportPlayer({
      title: pb?.title || '', info: pb ? pb.info || pb.summary : '', paused, waiting, position: secs, duration: Math.floor(duration),
      volume: Math.round(vol * 100) / 100, muted, error: err || undefined, hasNext: !!next,
      audio: (pb?.audio || []).map((a) => ({ index: a.index, label: a.label })),
      subs: (pb?.subs || []).map((s) => ({ index: s.index, label: s.label })),
      audioSel: pb?.audio.find((a) => a.selected)?.index ?? -1, subSel: subIdx,
    });
  }, [pb, secs, duration, paused, waiting, vol, muted, err, next, subIdx]);

  const onTime = () => {
    const v = video.current!;
    const t = offset + v.currentTime;
    setCur(t);
    let b = 0;
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1) b = Math.max(b, v.buffered.end(i));
    setBuffered(offset + b);
    if (next && autoNext && countdown === null && duration > 0 && duration - t < 25 && duration - t > 1 && !paused) setCountdown(10);
  };

  const subNow = cues.filter((c) => cur - subDelay >= c.start && cur - subDelay <= c.end).map((c) => c.text).join('\n');
  const pct = duration ? cur / duration : 0;
  const bpct = duration ? Math.min(1, buffered / duration) : 0;
  const curSub = pb?.subs.find((s) => s.index === subIdx);
  const showUI = !idle || paused || !!panel;
  const castNow = () => {
    video.current?.pause();
    // The TV picker lives outside the player, so it can't show over a fullscreen element.
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (hash) openCast({ torrent: hash, file: torrentFile, title: pb?.title });
    else openCast({ fileId: Number(fileId), itemId: itemId || undefined, start: cur, title: pb?.title, audio: opts.current.audio !== '' ? Number(opts.current.audio) : undefined, sub: subIdx >= 0 ? subIdx : undefined });
  };
  const external = async () => {
    try { await api.post(`/api/files/${fileId}/external?start=${Math.floor(cur)}`); video.current?.pause(); toast(tr('Открыто во внешнем плеере', 'Opened in external player')); } catch (e: any) { toast(e.message); }
  };

  // Where on the bar the mouse is, as a fraction: clientX and the rect are in
  // the same (unzoomed) units, so the ratio holds under the interface zoom.
  const barAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0;
    return { f, t: f * duration };
  };

  return (
    <div ref={root} className="player" style={{ position: 'fixed', inset: 0, background: '#000000', color: '#FFFFFF', zIndex: 40, cursor: showUI ? 'default' : 'none', fontFamily: "'Inter',sans-serif" }}>
      <video ref={video} playsInline onClick={toggle} onDoubleClick={fullscreen}
        onTimeUpdate={onTime} onPlay={() => { setPaused(false); tvApp()?.keepAwake?.(true); }} onPause={() => { setPaused(true); saveProgress(true); tvApp()?.keepAwake?.(false); }}
        onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)} onCanPlay={() => setWaiting(false)}
        onEnded={() => { saveProgress(true); if (next && autoNext) goNext(); }}
        onError={() => { if (!hlsRef.current && !directFailed()) setErr(tr('Браузер не смог открыть файл. Попробуйте внешний плеер или отправьте на ТВ.', 'The browser could not open this file.')); }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000000' }} />
      {/* Keeps something painted over the video. When nothing is drawn on top,
          Chromium/WebView2 on Windows hands fullscreen video to a hardware
          overlay and stops painting the page: hidden controls never come back
          and subtitles don't show until something else redraws. */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: '#00000001', pointerEvents: 'none' }} />

      {/* Top bar: close on the left, the (localized) title centered over the picture,
          the "position is saved" note on the right. */}
      <header onMouseEnter={() => { overBars.current = true; wake(); }} onMouseLeave={() => { overBars.current = false; wake(); }} style={{ position: 'absolute', left: 0, right: 0, top: 0, minHeight: 96, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'start', gap: 16, padding: '20px 24px 40px', background: 'linear-gradient(#000000D9,#00000000)', opacity: showUI ? 1 : 0.001, transition: 'opacity .3s' }}>
        <button className="pb pb-lg" onClick={close} aria-label={tr('Закрыть плеер', 'Close player')} style={{ justifySelf: 'start' }}><Icon name="close" size={26} /></button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, textAlign: 'center', paddingTop: 4 }}>
          <h1 style={{ margin: 0, fontSize: 'calc(clamp(18px, 2.2vw, 28px) * var(--fs))', fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.2, maxWidth: 'min(900px, calc(var(--vw) - 200px))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 2px 12px #00000080' }}>{pb?.title || tr('Загрузка…', 'Loading…')}</h1>
          {pb && <span style={{ marginTop: 4, fontSize: 'calc(12px * var(--fs))', color: '#A9ADB4' }} title={pb.reason}>{[pb.info || pb.summary, pb.encoder && pb.mode === 'hls' ? pb.encoder.toUpperCase() : ''].filter(Boolean).join(' · ')}</span>}
        </div>
        {(itemId > 0 || tfile >= 0) ? (
          <span className="pl-saved" style={{ justifySelf: 'end', maxWidth: '100%', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderRadius: 999, background: '#FFFFFF1A', fontSize: 'calc(12px * var(--fs))', color: '#D4D7DC', whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3CCB7F' }} />{itemId ? tr('Позиция сохраняется · синхр. с ТВ', 'Position is saved · synced with TV') : tr('Позиция сохраняется', 'Position is saved')}
          </span>
        ) : <span />}
      </header>

      {(waiting || !pb) && !err && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, fontSize: 'calc(13px * var(--fs))', color: '#D4D7DC' }}>
            <span className="spin" style={{ width: 36, height: 36, borderWidth: 3, borderColor: '#FFFFFF33', borderTopColor: 'var(--acc)' }} />
            {stream && !stream.ready ? `${tr('Буферизация', 'Buffering')} ${fmtSize(stream.buffered)} / ${fmtSize(stream.target)} · ${stream.seeds} ${tr('сидов', 'seeds')}`
              : pb?.mode === 'hls' ? tr('Готовим поток…', 'Preparing stream…') : ''}
          </div>
        </div>
      )}
      {err && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24 }}>
          <div style={{ maxWidth: 460, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <div style={{ fontSize: 'calc(16px * var(--fs))', fontWeight: 700 }}>{tr('Не удалось воспроизвести', 'Playback failed')}</div>
            <div style={{ fontSize: 'calc(13px * var(--fs))', color: '#C9CCD1' }}>{err}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn btn-w sm" onClick={() => load(cur)}>{tr('Повторить', 'Retry')}</button>
              {state?.local && !hash && <button className="btn btn-g sm" onClick={external}>{tr('Внешний плеер', 'External player')}</button>}
              <button className="btn btn-g sm" onClick={close}>{tr('Назад', 'Back')}</button>
            </div>
          </div>
        </div>
      )}

      {subNow && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: showUI ? 170 : 60, textAlign: 'center', pointerEvents: 'none', transition: 'bottom .3s', padding: '0 24px' }}>
          <span style={{ display: 'inline-block', padding: '4px 10px', background: '#000000B3', fontSize: 'calc(clamp(18px,2.2vw,28px) * var(--fs))', fontWeight: 600, lineHeight: 1.35, whiteSpace: 'pre-line' }}>{subNow}</span>
        </div>
      )}

      {countdown !== null && next && (
        <div style={{ position: 'absolute', right: 24, bottom: 140, width: 300, borderRadius: 16, background: '#FFFFFF', color: '#111214', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 20px 60px #00000080' }}>
          <div style={{ fontSize: 'calc(12px * var(--fs))', color: '#6B6F76' }}>{tr('Следующая серия через', 'Next episode in')} {countdown} {tr('с', 's')}</div>
          <div style={{ fontWeight: 700 }}>С{next.season}·Э{next.episode} {next.epTitle}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-d sm" onClick={goNext}><PlayGlyph size={14} />{tr('Смотреть', 'Play')}</button>
            <button className="btn btn-l sm" style={{ background: '#F2F2F0', color: '#111214' }} onClick={() => setCountdown(null)}>{tr('Отмена', 'Cancel')}</button>
          </div>
        </div>
      )}

      {panel && pb && (
        <section aria-label={tr('Дорожки', 'Tracks')} style={{ position: 'absolute', right: 24, bottom: 132, width: 'min(340px, calc(var(--vw) - 48px))', maxHeight: 'calc(var(--vh) - 200px)', overflow: 'auto', borderRadius: 16, background: '#FFFFFF', color: '#111214', boxShadow: '0 20px 60px #00000080', padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div role="tablist" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 999, background: '#F2F2F0', marginBottom: 6 }}>
            {([['subs', tr('Субтитры', 'Subtitles')], ['audio', tr('Аудио', 'Audio')], ['speed', tr('Скорость', 'Speed')]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={panel === k} onClick={() => setPanel(k)}
                style={{ flex: 1, height: 32, borderRadius: 999, border: 0, background: panel === k ? '#111214' : 'transparent', color: panel === k ? '#FFFFFF' : '#2A2C30', font: "600 calc(12px * var(--fs)) 'Inter',sans-serif", cursor: 'pointer' }}>{l}</button>
            ))}
          </div>
          {panel === 'subs' && (
            <>
              <Opt on={subIdx < 0} name={tr('Выключены', 'Off')} onClick={() => pickSub(-1)} />
              {pb.subs.map((s) => {
                const [name, meta] = trackText(s);
                return <Opt key={s.index} on={s.index === subIdx} name={name} meta={meta + (s.bitmap ? ' · ' + tr('вжигаются', 'burned in') : '')} onClick={() => pickSub(s.index)} />;
              })}
              {pb.subs.length === 0 && <div style={{ fontSize: 'calc(12px * var(--fs))', color: '#6B6F76', padding: '4px 10px' }}>{hash ? tr('Субтитры потока доступны после загрузки', 'Stream subtitles appear after download') : tr('В файле нет субтитров. Положите .srt рядом с видео — он появится здесь.', 'No subtitles. Put an .srt next to the video.')}</div>}
              <div style={{ height: 1, background: '#ECECE9', margin: '4px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', fontSize: 'calc(12px * var(--fs))', color: '#4A4D52' }}>
                {tr('Сдвиг', 'Offset')}
                <button className="opt" aria-label={tr('Раньше на 0,1 с', 'Earlier by 0.1 s')} onClick={() => setSubDelay((d) => Math.round((d - 0.1) * 10) / 10)} style={{ width: 32, minHeight: 32, padding: 0, justifyContent: 'center', background: '#F2F2F0' }}>−</button>
                <span className="mono">{subDelay >= 0 ? '+' : ''}{subDelay.toFixed(1)} {tr('с', 's')}</span>
                <button className="opt" aria-label={tr('Позже на 0,1 с', 'Later by 0.1 s')} onClick={() => setSubDelay((d) => Math.round((d + 0.1) * 10) / 10)} style={{ width: 32, minHeight: 32, padding: 0, justifyContent: 'center', background: '#F2F2F0' }}>+</button>
                {subDelay !== 0 && <button className="opt" onClick={() => setSubDelay(0)} style={{ width: 'auto', minHeight: 32 }}>{tr('Сброс', 'Reset')}</button>}
              </div>
              {curSub && <div style={{ fontSize: 'calc(11px * var(--fs))', color: '#6B6F76', padding: '0 10px' }}>{tr('Сейчас:', 'Now:')} {curSub.label}</div>}
            </>
          )}
          {panel === 'audio' && pb.audio.map((a) => {
            const [name, meta] = trackText(a);
            return <Opt key={a.index} on={a.selected} name={name} meta={meta} onClick={() => pickAudio(a.index)} />;
          })}
          {panel === 'audio' && pb.audio.length === 0 && <div style={{ fontSize: 'calc(12px * var(--fs))', color: '#6B6F76', padding: '4px 10px' }}>{tr('Звуковых дорожек нет', 'No audio tracks')}</div>}
          {panel === 'speed' && speeds.map((s) => <Opt key={s} on={speed === s} name={`${s}×`} onClick={() => { setSpeed(s); setPanel(null); }} />)}
        </section>
      )}

      <footer ref={controls} onMouseEnter={() => { overBars.current = true; wake(); }} onMouseLeave={() => { overBars.current = false; wake(); }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '48px 28px 18px', background: 'linear-gradient(#00000000,#000000D9 45%)', display: 'flex', flexDirection: 'column', gap: 10, opacity: showUI ? 1 : 0.001, transition: 'opacity .3s' }}>
        {stream && (
          <div style={{ display: 'flex', gap: 14, fontSize: 'calc(11px * var(--fs))', color: '#A9ADB4' }} className="mono">
            <span>{tr('Загружено', 'Downloaded')} {Math.round(stream.progress * 100)}%</span><span>↓ {fmtSize(stream.down)}/s</span><span>{stream.seeds} {tr('сидов', 'seeds')} · {stream.peers} {tr('пиров', 'peers')}</span>
          </div>
        )}
        {/* Full-width progress with the time left on the right. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div role="slider" tabIndex={0} aria-label={tr('Позиция', 'Position')} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(cur)} aria-valuetext={fmtTime(cur)}
            onMouseMove={(e) => setHover(barAt(e))} onMouseLeave={() => setHover(null)} onClick={(e) => seek(barAt(e).t)}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation(); if (e.key === 'ArrowLeft') seek(cur - 5); if (e.key === 'ArrowRight') seek(cur + 5); }}
            className="pl-bar" style={{ flex: 1, height: 20, display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
            <div className="pl-track" style={{ position: 'relative', width: '100%', borderRadius: 3, background: '#FFFFFF2E' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bpct * 100}%`, borderRadius: 3, background: '#FFFFFF59' }} />
              {hover && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${hover.f * 100}%`, borderRadius: 3, background: '#FFFFFF40' }} />}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, borderRadius: 3, background: 'var(--acc)' }} />
              <div className="pl-knob" style={{ position: 'absolute', left: `${pct * 100}%`, top: '50%', borderRadius: '50%', background: 'var(--acc)', transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 3px #00000040' }} />
              {/* Positioned in % of the track, not in px: the interface zoom
                  (zoom.ts) scales px offsets but the mouse is measured unscaled,
                  so a px left drifted further right the further along you hovered. */}
              {hover && <div style={{ position: 'absolute', left: `${hover.f * 100}%`, bottom: 16, transform: 'translateX(-50%)', padding: '4px 9px', borderRadius: 8, background: '#FFFFFF', color: '#111214', fontSize: 'calc(12px * var(--fs))', fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none' }} className="mono">{fmtTime(hover.t)}</div>}
            </div>
          </div>
          <span className="mono" style={{ fontSize: 'calc(14px * var(--fs))', color: '#E6E8EB', minWidth: 72, textAlign: 'right' }} title={`${fmtTime(cur)} / ${fmtTime(duration)}`}>−{fmtTime(Math.max(0, duration - cur))}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="pb pb-lg" onClick={toggle} aria-label={paused ? tr('Смотреть', 'Play') : tr('Пауза', 'Pause')}>{paused ? <PlayGlyph size={26} /> : <PauseGlyph size={26} />}</button>
          <button className="pb pb-lg" onClick={() => seek(cur - 10)} aria-label={tr('Назад 10 секунд', 'Back 10 seconds')}><Skip10 dir={-1} /></button>
          <button className="pb pb-lg" onClick={() => seek(cur + 10)} aria-label={tr('Вперёд 10 секунд', 'Forward 10 seconds')}><Skip10 dir={1} /></button>
          {/* A TV has its own volume on the remote. */}
          {!tv && (
            <div className="pl-vol" style={{ display: 'flex', alignItems: 'center' }}>
              <button className="pb pb-lg" onClick={() => setMuted((m) => !m)} aria-label={muted ? tr('Включить звук', 'Unmute') : tr('Выключить звук', 'Mute')}><Icon name={muted || vol === 0 ? 'mute' : 'volume'} size={26} /></button>
              <input type="range" className="rng" min={0} max={1} step={0.05} value={muted ? 0 : vol} aria-label={tr('Громкость', 'Volume')}
                onChange={(e) => { setVol(Number(e.target.value)); setMuted(false); }} />
            </div>
          )}
          <span className="mono pl-now" style={{ marginLeft: 10, fontSize: 'calc(13px * var(--fs))', color: '#A9ADB4' }}>{fmtTime(cur)} / {fmtTime(duration)}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {next && <button className="pb" onClick={goNext} aria-label={tr('Следующая серия', 'Next episode')} style={{ width: 'auto', height: 44, padding: '0 14px', borderRadius: 999, background: '#FFFFFF1A', font: "600 calc(13px * var(--fs)) 'Inter',sans-serif" }}>{tr('След. серия', 'Next')} ›</button>}
            <button className="pb pb-lg" onClick={() => setPanel(panel === 'subs' ? null : 'subs')} aria-label={tr('Субтитры', 'Subtitles')} aria-expanded={panel === 'subs'} style={{ background: panel === 'subs' ? '#FFFFFF2E' : undefined }}><Icon name="subs" size={26} /></button>
            <button className="pb pb-lg" onClick={() => setPanel(panel === 'audio' || panel === 'speed' ? null : 'audio')} aria-label={tr('Настройки: звук и скорость', 'Settings: audio and speed')} aria-expanded={panel === 'audio' || panel === 'speed'} style={{ background: panel === 'audio' || panel === 'speed' ? '#FFFFFF2E' : undefined, position: 'relative' }}>
              <Gear />
              {speed !== 1 && <span style={{ position: 'absolute', right: 2, bottom: 4, padding: '0 4px', borderRadius: 6, background: 'var(--acc)', color: '#111214', font: "800 calc(9px * var(--fs))/14px 'Inter',sans-serif" }}>{speed}×</span>}
            </button>
            <button className="pb pb-lg" onClick={castNow} aria-label={tr('Отправить на ТВ', 'Send to TV')}><Icon name="cast" size={26} /></button>
            {state?.local && !hash && <button className="pb pb-lg" onClick={external} aria-label={tr('Открыть во внешнем плеере', 'Open in external player')}><Icon name="external" size={24} /></button>}
            {!tvApp() && <button className="pb pb-lg" onClick={fullscreen} aria-label={tr('Во весь экран', 'Fullscreen')}><Icon name="fullscreen" size={26} /></button>}
          </div>
        </div>
      </footer>
    </div>
  );
}

// Older servers send only label ("name · meta · meta").
function trackText(t: PlayTrack): [string, string] {
  if (t.name) return [t.name, t.meta || ''];
  const [name, ...meta] = t.label.split(' · ');
  return [name, meta.join(' · ')];
}

function Opt({ on, name, meta, onClick }: { on: boolean; name: string; meta?: string; onClick: () => void }) {
  return (
    <button className="opt" onClick={onClick} aria-pressed={on}>
      <span style={{ width: 16, display: 'grid', placeItems: 'center', color: 'var(--acc-dk)' }}>{on && <Icon name="check" size={16} />}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: meta ? '6px 0' : 0 }}>
        <span style={{ fontWeight: on ? 700 : 500, overflowWrap: 'anywhere' }}>{name}</span>
        {meta && <span style={{ fontSize: 'calc(11px * var(--fs))', color: '#6B6F76' }}>{meta}</span>}
      </span>
    </button>
  );
}

// 10-second skip: a circular arrow with "10" inside.
function Skip10({ dir }: { dir: 1 | -1 }) {
  const back = dir < 0;
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={back ? 'M4.5 12a7.5 7.5 0 1 0 2.3-5.4' : 'M19.5 12a7.5 7.5 0 1 1-2.3-5.4'} />
      <path d={back ? 'M4.2 3.6v3.6h3.6' : 'M19.8 3.6v3.6h-3.6'} />
      <text x="12" y="15.4" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="700" fontFamily="Inter, sans-serif">10</text>
    </svg>
  );
}

function Gear() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
