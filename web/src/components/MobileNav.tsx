// Phone layout from the mobile design: a bottom tab bar with labels, a
// "now playing on the TV" bar above it, and the greeting header on Home.
// Both are in the DOM on every screen size; CSS shows them only on phones
// (styles.css, "phone layout").
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useApp } from '../state';
import { t, tr } from '../i18n';
import { Icon, PauseGlyph, PlayGlyph } from './Icon';
import { Art } from './Art';
import { screenId, sendRemote } from '../remote';

type Tab = { to: string; icon: string; label: string; on: (path: string, search: string) => boolean };

const homePaths = ['/library', '/catalog/', '/movie/', '/show/', '/person', '/people'];

export function MobileNav() {
  const { torrents, screens } = useApp();
  const { pathname, search } = useLocation();
  if (pathname.startsWith('/play')) return null;
  const searching = (p: string, s: string) => p === '/search' || (p === '/' && /[?&](search=1|q=)/.test(s));
  const tabs: Tab[] = [
    { to: '/', icon: 'home', label: t('home'), on: (p, s) => (p === '/' && !searching(p, s)) || homePaths.some((x) => p.startsWith(x)) },
    { to: '/?search=1', icon: 'search', label: tr('Поиск', 'Search'), on: searching },
    { to: '/remote', icon: 'remote', label: tr('Пульт', 'Remote'), on: (p) => p.startsWith('/remote') || p.startsWith('/devices') },
    { to: '/torrents', icon: 'download', label: tr('Загрузки', 'Downloads'), on: (p) => p.startsWith('/torrents') },
    { to: '/settings', icon: 'sliders', label: t('settings'), on: (p) => p.startsWith('/settings') || p.startsWith('/profiles') || p.startsWith('/lists') },
  ];
  const active = torrents?.items.filter((x) => ['downloading', 'streaming', 'meta'].includes(x.status)).length || 0;
  const tvOnline = screens.some((s) => s.id !== screenId() && s.tv);
  return (
    <>
      {!pathname.startsWith('/remote') && <NowPlaying />}
      <nav className="mnav" aria-label={tr('Разделы', 'Sections')}>
        {tabs.map((x) => {
          const on = x.on(pathname, search);
          return (
            <NavLink key={x.to} to={x.to} className={'mtab' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined}>
              <span style={{ position: 'relative', display: 'grid' }}>
                <Icon name={x.icon} size={22} />
                {x.to === '/remote' && tvOnline && <span className="mdot" style={{ background: 'var(--prog)' }} aria-label={tr('Телевизор в сети', 'TV online')} />}
                {x.to === '/torrents' && active > 0 && <span className="mdot" style={{ background: 'var(--acc)' }} aria-label={`${active} ${tr('активных', 'active')}`} />}
              </span>
              {x.label}
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}

// NowPlaying: what a TV (or another Rivo screen) is playing, with play/pause;
// a tap opens the remote for it.
function NowPlaying() {
  const { screens, toast } = useApp();
  const s = screens.find((x) => x.id !== screenId() && x.state?.player?.title);
  const p = s?.state?.player;
  if (!s || !p) return null;
  const pct = p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  return (
    <div className="mnow">
      <Link to={`/remote/${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, color: '#FFFFFF' }}>
        <Art src={p.poster} title={p.title} style={{ width: 44, height: 44, borderRadius: 10, flex: 'none' }} />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 'calc(13.5px * var(--fs))', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</span>
          <span style={{ fontSize: 'calc(11.5px * var(--fs))', color: '#C3C8E0', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <Icon name="cast" size={13} style={{ color: '#A5B4FC' }} />{tr('Идёт на', 'Playing on')} «{s.name}»
          </span>
        </span>
      </Link>
      <button aria-label={p.paused ? tr('Продолжить', 'Play') : tr('Пауза', 'Pause')} onClick={() => sendRemote(s.id, { cmd: p.paused ? 'play' : 'pause' }).catch((e: any) => toast(e.message))}
        style={{ width: 44, height: 44, borderRadius: '50%', border: 0, background: 'transparent', color: '#FFFFFF', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none' }}>
        {p.paused ? <PlayGlyph size={18} /> : <PauseGlyph size={20} />}
      </button>
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${pct}%`, background: 'var(--mint)' }} />
    </div>
  );
}

// MobileHead: the greeting on Home, with the remote and the profile.
export function MobileHead() {
  const { profile, screens } = useApp();
  const h = new Date().getHours();
  const hello = h < 5 ? tr('Доброй ночи', 'Good night') : h < 12 ? tr('Доброе утро', 'Good morning') : h < 18 ? tr('Добрый день', 'Good afternoon') : tr('Добрый вечер', 'Good evening');
  const tv = screens.find((s) => s.id !== screenId() && s.tv);
  return (
    <header className="mhead">
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 'calc(12px * var(--fs))', color: 'var(--mut)' }}>{hello}</span>
        <span style={{ fontSize: 'calc(17px * var(--fs))', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.name || 'Rivo'}</span>
      </div>
      <Link to={tv ? `/remote/${tv.id}` : '/remote'} className="mround" aria-label={tv ? `${tr('Пульт', 'Remote')}: ${tv.name}` : tr('Пульт', 'Remote')} style={{ color: 'var(--acct)' }}>
        <Icon name="cast" size={20} />
      </Link>
      <Link to="/profiles" className="mround" aria-label={`${t('profile')}: ${profile?.name || ''}`}
        style={{ background: profile?.color || 'var(--acc)', color: '#FFFFFF', font: "800 calc(15px * var(--fs)) 'Inter',sans-serif" }}>
        {(profile?.name || '?').slice(0, 1).toUpperCase()}
      </Link>
    </header>
  );
}
