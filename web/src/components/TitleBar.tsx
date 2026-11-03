import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../state';
import { t, tr } from '../i18n';
import { Icon } from './Icon';
import { AppMark, Wordmark } from './Brand';

// The app's title bar: one strip that spans the window and stays above the
// page — the mark and the wordmark, back and forward, where you are, the
// search, and the two live switches (background, TV). It is part of the
// shell, not of a page, so the search is the same keystroke away everywhere.
export function TitleBar({ catalog, types }: { catalog: boolean; types: boolean }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { prefs, setPrefs, devices, cast } = useApp();
  const [q, setQ] = useState(params.get('q') || '');
  const [kind, setKind] = useState(params.get('kind') || '');
  const [scrolled, setScrolled] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const bgOn = prefs.bg !== 'off';
  const playing = cast[0];
  const tv = playing ? playing.deviceName : devices.find((d) => d.online)?.name;

  // The bar is transparent over the page and turns into a frosted strip as
  // soon as something scrolls under it.
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The URL owns the query and the type; the field follows it except while the
  // user is typing in it, so Back and links never fight the keyboard.
  useEffect(() => {
    if (document.activeElement !== input.current) setQ(params.get('q') || '');
    setKind(params.get('kind') || '');
  }, [params]);

  // On Home, results open as you type.
  const typed = useRef(false);
  useEffect(() => {
    if (!catalog || !typed.current) return;
    const id = window.setTimeout(() => nav(`/?search=1${q.trim() ? '&q=' + encodeURIComponent(q.trim()) : ''}`, { replace: true }), 400);
    return () => window.clearTimeout(id);
  }, [q, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (k = kind, text = q) => {
    if (catalog) { nav(`/?search=1${text.trim() ? '&q=' + encodeURIComponent(text.trim()) : ''}`); return; }
    if (!text.trim()) return;
    nav(`/search?q=${encodeURIComponent(text.trim())}${k ? '&kind=' + k : ''}`);
  };

  const where = section(loc.pathname);
  const pill = (on: boolean) => 'tb-pill' + (on ? ' on' : '');
  const typePills: [string, string][] = catalog
    ? [['', t('movies')], ['tv', t('shows')], ['people', t('people')]]
    : [['', t('all')], ['movie', t('movies')], ['show', t('shows')], ['people', t('people')]];
  const pick = (k: string) => {
    if (catalog) { nav(k === 'people' ? '/people' : k ? `/?kind=${k}` : '/'); return; }
    setKind(k);
    if (q.trim()) go(k);
  };

  return (
    <header className={'titlebar' + (scrolled ? ' on' : '')}>
      <div className="tb-left">
        <Link to="/" className="tb-brand" aria-label="Rivo">
          <AppMark size={26} />
          <Wordmark hot={!!playing} style={{ fontSize: 'calc(17px * var(--fs))' }} />
        </Link>
        <div className="tb-nav">
          <button className="tb-ico" aria-label={t('back')} title={t('back')} onClick={() => nav(-1)}><Icon name="left" size={18} /></button>
          <button className="tb-ico" aria-label={t('forward')} title={t('forward')} onClick={() => nav(1)}><Icon name="right" size={18} /></button>
        </div>
        <span className="tb-sep" aria-hidden="true" />
        <span className="tb-where" title={where}>{where}</span>
      </div>
      <form role="search" className="tb-search" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <Icon name="search" size={17} />
        <label className="sr" htmlFor="q">{tr('Поиск', 'Search')}</label>
        <input id="q" ref={input} value={q} onChange={(e) => { typed.current = true; setQ(e.target.value); }}
          onFocus={() => { if (catalog && !params.get('search') && !params.get('q')) nav('/?search=1'); }}
          placeholder={catalog ? tr('Найти фильм или сериал', 'Find a movie or show') : t('searchPh')}
          autoComplete="off" />
        {q
          ? <button type="button" className="tb-x" aria-label={tr('Очистить', 'Clear')} onClick={() => { typed.current = false; setQ(''); if (catalog) nav('/'); input.current?.focus(); }}><Icon name="close" size={13} /></button>
          : <span className="tb-kbd mono" aria-hidden="true">Ctrl K</span>}
      </form>
      <div className="tb-right">
        {types && (
          <div role="group" aria-label={tr('Тип', 'Type')} className="tb-seg">
            {typePills.map(([k, label]) => {
              const on = catalog ? (k === 'people' ? loc.pathname === '/people' : loc.pathname === '/' && (params.get('kind') || '') === k) : kind === k;
              return <button key={k} className={pill(on)} aria-pressed={on} onClick={() => pick(k)}>{label}</button>;
            })}
          </div>
        )}
        <Link className={'tb-live' + (playing ? ' casting' : '')} to="/devices" title={tv || t('devices')}>
          {playing ? <span className="tb-dot" aria-hidden="true" /> : <Icon name="cast" size={16} />}
          <span className="tb-live-t">{tv || t('devices')}</span>
        </Link>
        <button className={'tb-ico' + (bgOn ? ' on' : '')} aria-pressed={bgOn} aria-label={bgOn ? t('liveBg') : t('bgOff')}
          title={bgOn ? t('liveBg') : t('bgOff')} onClick={() => setPrefs({ bg: bgOn ? 'off' : 'static' })}>
          <Icon name="sparkle" size={17} />
        </button>
      </div>
    </header>
  );
}

// The bar names the section the window is on, taken from the route: the pages
// themselves start with the title of what they show, not of where they are.
function section(path: string): string {
  if (path === '/') return t('home');
  if (path === '/people' || path.startsWith('/person')) return t('people');
  if (path.startsWith('/catalog')) return t('catalog');
  if (path.startsWith('/library/movies')) return t('movies');
  if (path.startsWith('/library/shows')) return t('shows');
  if (path.startsWith('/library/favorites')) return t('favorites');
  if (path.startsWith('/library/later')) return t('later');
  if (path.startsWith('/library')) return t('library');
  if (path === '/search') return t('search');
  if (path.startsWith('/movie') || path.startsWith('/show')) return t('library');
  if (path === '/lists') return t('myLists');
  if (path === '/torrents') return t('torrents');
  if (path === '/devices') return t('devices');
  if (path === '/settings') return t('settings');
  if (path === '/profiles') return t('profile');
  return '';
}
