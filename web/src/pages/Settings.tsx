// Settings: a section menu on the left, one section on the right. Every
// control applies at once; the header badge confirms it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type Check, type Settings as S, type TorrentSettings } from '../api';
import { useApp, useAsync } from '../state';
import { tr } from '../i18n';
import { Icon } from '../components/Icon';
import { Badge, SaverProvider, useSaveState, useSaver } from './settings/ui';
import { Look, LibrarySection, Playback, Transcoding, type Patch, type SectionProps } from './settings/basic';
import { Backup, Diagnostics, Network, Profiles, Torrents } from './settings/system';

type Sec = { id: string; icon: string; ru: string; en: string };
const groups: { ru: string; en: string; items: Sec[] }[] = [
  { ru: 'Основное', en: 'General', items: [
    { id: 'look', icon: 'theme', ru: 'Оформление', en: 'Appearance' },
    { id: 'lib', icon: 'folder', ru: 'Библиотека', en: 'Library' },
    { id: 'play', icon: 'play', ru: 'Воспроизведение', en: 'Playback' },
  ] },
  { ru: 'Сеть и устройства', en: 'Network & devices', items: [
    { id: 'trans', icon: 'cpu', ru: 'Перекодирование', en: 'Transcoding' },
    { id: 'torrents', icon: 'download', ru: 'Торренты', en: 'Torrents' },
    { id: 'net', icon: 'wifi', ru: 'Сеть и VPN', en: 'Network & VPN' },
  ] },
  { ru: 'Система', en: 'System', items: [
    { id: 'prof', icon: 'user', ru: 'Профили', en: 'Profiles' },
    { id: 'backup', icon: 'archive', ru: 'Резервная копия', en: 'Backup' },
    { id: 'diag', icon: 'pulse', ru: 'Диагностика', en: 'Diagnostics' },
  ] },
];
const all = groups.flatMap((g) => g.items);
const aliases: Record<string, string> = { access: 'net', vpn: 'net' };

// Which section a failing check belongs to (for the yellow menu badge).
const checkSection: Record<string, string> = { ffmpeg: 'trans', tmdb: 'lib', port: 'net', vpn: 'net', server: 'net', disk: 'torrents' };

// Search index: section, row title, words people may type instead.
const index: [string, string, string, string][] = [
  ['look', 'Тема', 'Theme', 'светлая тёмная oled dark light'],
  ['look', 'Акцентный цвет', 'Accent color', 'цвет акцент'],
  ['look', 'Задний фон', 'Background', 'точки фон живой'],
  ['look', 'Яркость фона', 'Background brightness', 'интенсивность'],
  ['look', 'Цвет фона под постер', 'Tint background with poster', 'постер'],
  ['look', 'Меньше анимации', 'Reduce motion', 'анимация движение'],
  ['look', 'Трейлеры при наведении', 'Trailers on hover', 'трейлер youtube'],
  ['look', 'Размер текста', 'Text size', 'шрифт масштаб'],
  ['look', 'Язык интерфейса', 'Interface language', 'язык english'],
  ['lib', 'Новая папка', 'New folder', 'добавить папку библиотека диск'],
  ['lib', 'Следить за изменениями', 'Watch for changes', 'новые файлы'],
  ['lib', 'Сканировать при запуске', 'Scan on start', 'скан'],
  ['lib', 'Пересканировать всё', 'Rescan everything', 'скан'],
  ['lib', 'Язык описаний', 'Description language', 'метаданные'],
  ['lib', 'Ключ API TMDB', 'TMDB API key', 'tmdb постеры ключ'],
  ['lib', 'Подключение к TMDB', 'Connection to TMDB', 'зеркало lampa cub'],
  ['play', 'Плеер', 'Player', 'mpv vlc внешний'],
  ['play', 'Автопереход к следующей серии', 'Autoplay next episode', 'серия'],
  ['play', 'Отмечать просмотренным', 'Mark as watched', 'просмотрено продолжить'],
  ['play', 'Озвучка', 'Audio', 'аудио дорожка язык'],
  ['play', 'Субтитры', 'Subtitles', 'субтитры язык'],
  ['trans', 'Перекодировать видеокартой', 'Use the graphics card', 'транскодирование nvenc видеокарта'],
  ['trans', 'Качество', 'Quality', '1080p 720p'],
  ['trans', 'HDR → SDR', 'HDR → SDR', 'hdr тонмаппинг'],
  ['trans', 'Сколько фильмов одновременно', 'Films at once', 'потоки'],
  ['trans', 'Временные файлы', 'Temporary files', 'кэш очистить'],
  ['torrents', 'Торрент-клиент', 'Torrent client', 'qbittorrent transmission'],
  ['torrents', 'Папка загрузок', 'Download folder', 'загрузки'],
  ['torrents', 'Скорость загрузки ↓', 'Download speed ↓', 'лимит'],
  ['torrents', 'Скорость отдачи ↑', 'Upload speed ↑', 'лимит раздача'],
  ['torrents', 'Буфер перед стартом', 'Start buffer', 'буфер'],
  ['torrents', 'Сохранять в библиотеку после просмотра', 'Keep in the library after watching', 'удалять'],
  ['torrents', 'Раздача после загрузки', 'Seeding after download', 'сид рейтинг'],
  ['torrents', 'Добавить источник', 'Add a source', 'jacred jackett torznab поиск'],
  ['torrents', 'Качать по расписанию', 'Download schedule', 'ночь расписание'],
  ['torrents', 'Дополнительные трекеры', 'Extra trackers', 'трекер'],
  ['net', 'Кто может открыть Rivo', 'Who can open Rivo', 'пароль доступ'],
  ['net', 'Адрес для других устройств', 'Address for other devices', 'телефон тв ip'],
  ['net', 'Через какое подключение качать', 'Connection for downloads', 'vpn wg0 интерфейс'],
  ['net', 'Остановить, если VPN отключился', 'Stop if the VPN drops', 'kill switch'],
  ['net', 'Входящий порт', 'Incoming port', 'порт'],
  ['net', 'Открывать порт на роутере сам', 'Open the port on the router', 'upnp роутер'],
  ['net', 'Шифрование', 'Encryption', 'шифрование'],
  ['net', 'Прокси SOCKS5', 'SOCKS5 proxy', 'прокси'],
  ['prof', 'Добавить профиль', 'Add profile', 'профиль pin детский'],
  ['prof', 'Спрашивать, кто смотрит', 'Ask who’s watching', 'профиль запуск'],
  ['backup', 'Автокопия раз в неделю', 'Weekly automatic backup', 'резервная копия'],
  ['backup', 'Создать копию сейчас', 'Back up now', 'резервная копия'],
  ['backup', 'Восстановить из копии', 'Restore from backup', 'восстановить'],
  ['backup', 'Список просмотренного', 'Watched list', 'csv экспорт excel'],
  ['diag', 'Проверка', 'Checks', 'диагностика ошибка не работает'],
  ['diag', 'Журнал', 'Log', 'логи'],
];

export default function SettingsPage() {
  const { toast } = useApp();
  return <SaverProvider onError={toast}><SettingsScreen /></SaverProvider>;
}

function SettingsScreen() {
  const loc = useLocation();
  const nav = useNavigate();
  const track = useSaver();
  const fromHash = () => { const h = loc.hash.slice(1); return all.some((s) => s.id === (aliases[h] || h)) ? aliases[h] || h : 'look'; };
  const [cur, setCur] = useState(fromHash);
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const { data: st, setData: setSt } = useAsync(() => api.get<S>('/api/settings'), []);
  const tsQ = useAsync(() => api.get<TorrentSettings>('/api/torrent-settings'), []);
  const diag = useAsync(() => api.get<{ checks: Check[] }>('/api/diagnostics').then((r) => r.checks || []), []);
  const checks = diag.data || [];
  useEffect(() => { setCur(fromHash()); }, [loc.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((id: string, row?: string) => {
    setQ('');
    setCur(id);
    nav({ hash: id }, { replace: true });
    setFlash(row || null);
    window.scrollTo({ top: 0 });
  }, [nav]);
  // Searching jumps to the row and highlights it once the section is drawn.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => {
      const el = [...(body.current?.querySelectorAll<HTMLElement>('[data-row]') || [])].find((e) => e.dataset.row === flash);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      el.querySelector<HTMLElement>('button, input, select, textarea')?.focus({ preventScroll: true });
    }, 80);
    return () => clearTimeout(t);
  }, [flash, cur, st, tsQ.data]);

  const save = useCallback(async (patch: Patch) => { const next = await api.put<S>('/api/settings', patch); setSt(next); return next; }, [setSt]);
  const saveTs = useCallback(async (p: Partial<TorrentSettings>) => {
    try { tsQ.setData(await track(api.put<TorrentSettings>('/api/torrent-settings', p))); } catch { tsQ.reload(); }
  }, [track, tsQ]);

  const problems = useMemo(() => {
    const n: Record<string, number> = {};
    for (const c of checks) {
      if (c.ok) continue;
      n.diag = (n.diag || 0) + 1;
      const s = checkSection[c.id];
      if (s) n[s] = (n[s] || 0) + 1;
    }
    return n;
  }, [checks]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return index.filter(([, ru, en, k]) => `${ru} ${en} ${k}`.toLowerCase().includes(s));
  }, [q]);

  const props: SectionProps | null = st ? { st, save, checks, go, reloadChecks: diag.reload } : null;
  const ts = tsQ.data;
  const section = (() => {
    if (!props) return <span className="spin" />;
    switch (cur) {
      case 'lib': return <LibrarySection {...props} />;
      case 'play': return <Playback {...props} />;
      case 'trans': return <Transcoding {...props} />;
      case 'torrents': return ts ? <Torrents {...props} ts={ts} saveTs={saveTs} /> : <span className="spin" />;
      case 'net': return ts ? <Network {...props} ts={ts} saveTs={saveTs} /> : <span className="spin" />;
      case 'prof': return <Profiles {...props} />;
      case 'backup': return <Backup {...props} />;
      case 'diag': return <Diagnostics {...props} />;
      default: return <Look {...props} />;
    }
  })();

  return (
    <main className="main pad set-page">
      <Blobs />
      <header className="set-top">
        <div>
          <h1 className="h1">{tr('Настройки', 'Settings')}</h1>
          <div className="set-note">{tr('Всё хранится только на этом компьютере. Изменения применяются сразу.', 'Everything stays on this computer. Changes apply instantly.')}</div>
        </div>
        <div className="set-tools">
          <SavedBadge />
          <label className="set-search">
            <Icon name="search" size={18} />
            <span className="sr">{tr('Поиск по настройкам', 'Search settings')}</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Найти настройку, например «субтитры»', 'Find a setting, e.g. “subtitles”')}
              onKeyDown={(e) => { if (e.key === 'Enter' && results?.[0]) go(results[0][0], tr(results[0][1], results[0][2])); if (e.key === 'Escape') setQ(''); }} />
          </label>
        </div>
      </header>
      <div className="set-cols">
        <nav className="set-menu" aria-label={tr('Разделы настроек', 'Settings sections')}>
          {groups.map((g) => (
            <div key={g.ru} style={{ display: 'contents' }}>
              <h2>{tr(g.ru, g.en)}</h2>
              {g.items.map((s) => (
                <button key={s.id} type="button" className="set-mi" aria-current={!results && cur === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
                  <Icon name={s.icon} />{tr(s.ru, s.en)}
                  {problems[s.id] ? <Badge kind="warn"><span className="sr">{tr('проблем:', 'problems:')} </span>{problems[s.id]}</Badge> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="set-body" ref={body} aria-live={results ? 'polite' : undefined}>
          {results ? (
            <>
              <div className="set-head"><h2 className="h2" style={{ fontSize: 'calc(22px * var(--fs))' }}>{tr('Поиск', 'Search')}</h2>
                <div className="set-note">{results.length ? tr(`Нашлось: ${results.length}`, `Found: ${results.length}`) : tr('Ничего не нашлось. Попробуйте другое слово', 'Nothing found. Try another word')}</div></div>
              {results.length > 0 && (
                <section className="set-card set-results">
                  {results.map(([sec, ru, en]) => {
                    const s = all.find((x) => x.id === sec)!;
                    return (
                      <button key={sec + ru} type="button" className="set-res" onClick={() => go(sec, tr(ru, en))}>
                        <span className="set-row-n"><Hl text={tr(ru, en)} q={q} /></span>
                        <small>{tr(s.ru, s.en)}</small>
                      </button>
                    );
                  })}
                </section>
              )}
            </>
          ) : section}
        </div>
      </div>
    </main>
  );
}

function Hl({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
  if (i < 0 || !q.trim()) return <>{text}</>;
  const n = q.trim().length;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + n)}</mark>{text.slice(i + n)}</>;
}

function SavedBadge() {
  const s = useSaveState();
  return (
    <span role="status" aria-live="polite" className={'set-badge set-saved ' + (s === 'error' ? 'err' : s === 'saving' ? 'mut' : 'ok')}>
      {s === 'saved' && <Icon name="check" size={14} style={{ strokeWidth: 3 }} />}
      {s === 'saving' ? tr('Сохраняю…', 'Saving…') : s === 'error' ? tr('Не сохранилось', 'Not saved') : tr('Сохранено', 'Saved')}
    </span>
  );
}

// Soft colored glow behind the glass cards, drifting after the cursor.
function Blobs() {
  const { prefs } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const still = prefs.calm || prefs.bg === 'off' || prefs.bg === 'static';
  useEffect(() => {
    if (still || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = e.clientX / window.innerWidth - 0.5, y = e.clientY / window.innerHeight - 0.5;
        ref.current?.querySelectorAll<HTMLElement>('span').forEach((b, i) => {
          const k = [60, -45, 35][i];
          b.style.transform = `translate(${x * k}px, ${y * k}px)`;
        });
      });
    };
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, [still]);
  if (prefs.bg === 'off') return null;
  const k = prefs.intensity / 100;
  return (
    <div className="set-blobs" ref={ref} aria-hidden="true" style={{ opacity: Math.min(1, k) }}>
      <span style={{ width: 420, height: 420, left: '18%', top: '8%', background: 'var(--acc)' }} />
      <span style={{ width: 360, height: 360, right: '6%', top: '30%', background: 'var(--lav)' }} />
      <span style={{ width: 320, height: 320, left: '42%', bottom: '-6%', background: 'var(--mint)' }} />
    </div>
  );
}
