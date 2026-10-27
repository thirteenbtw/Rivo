// Sections of the "Main" group plus transcoding: appearance, library,
// playback, transcoding.
import { useEffect, useRef, useState } from 'react';
import { api, fmtSize, type Check, type Library, type ScanStatus, type Settings as S } from '../../api';
import { useApp, useAsync } from '../../state';
import { setLang, tr } from '../../i18n';
import { setTextScale, textScale, textSteps } from '../../zoom';
import { Icon } from '../../components/Icon';
import { FolderPicker } from '../../components/FolderPicker';
import { Badge, Btn, Group, Row, SectionHead, Seg, Select, Switch, recommended, useSaver, type Opt } from './ui';

export type Patch = Partial<Record<keyof S | 'tmdbKey' | 'password', string>>;
export type SectionProps = { st: S; save: (p: Patch) => Promise<S>; checks: Check[]; go: (id: string) => void; reloadChecks: () => void };

// ---------- Appearance ----------

const themes = [
  { id: 'light', ru: 'Светлая', en: 'Light', bg: '#EEF1F9', line: '#CBD3EC', mut: '#B7BFD8', card: '#FFFFFF' },
  { id: 'dark', ru: 'Тёмная', en: 'Dark', bg: '#141A33', line: '#353E68', mut: '#4A5383', card: '#252D51' },
  { id: 'oled', ru: 'OLED', en: 'OLED', bg: '#000000', line: '#1C1F30', mut: '#353A55', card: '#151829' },
] as const;
const accents = [['iris', '#5B6EE1', 'Ирис', 'Iris'], ['mint', '#23806B', 'Мята', 'Mint'], ['red', '#C8232D', 'Красный', 'Red'], ['amber', '#B35F00', 'Янтарный', 'Amber']] as const;

export function Look({ st, save }: SectionProps) {
  const { prefs, setPrefs, reload } = useApp();
  const track = useSaver();
  // Prefs save in the background (debounced into the profile); the badge just flashes.
  const set = (p: Parameters<typeof setPrefs>[0]) => { setPrefs(p); track(new Promise((r) => setTimeout(r, 650))); };
  const [text, setText] = useState(textScale());
  const bgHint = {
    live: tr('Точки подсвечиваются вокруг курсора и слегка двигаются', 'Dots light up around the cursor and drift a little'),
    static: tr('Сетка точек стоит на месте и не отвлекает', 'The dot grid stays still and out of the way'),
    off: tr('Чистый цвет темы, без точек', 'Plain theme color, no dots'),
  }[prefs.bg];
  const setUi = async (l: string) => { await track(save({ uiLang: l })); setLang(l); await reload(); };
  return (
    <>
      <SectionHead title={tr('Оформление', 'Appearance')} note={tr('Как выглядит Rivo на этом устройстве. Сохраняется в вашем профиле.', 'How Rivo looks on this device. Saved to your profile.')} />
      <Group title={tr('Тема', 'Theme')}>
        <div role="radiogroup" aria-label={tr('Тема', 'Theme')} className="set-themes">
          {themes.map((t) => (
            <button key={t.id} type="button" className="set-theme" role="radio" aria-checked={prefs.theme === t.id} onClick={() => set({ theme: t.id })}>
              <div aria-hidden="true" style={{ height: 84, borderRadius: 10, background: t.bg, border: `1px solid ${t.line}`, display: 'flex', overflow: 'hidden' }}>
                <div style={{ width: 16, borderRight: `1px solid ${t.line}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, paddingTop: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--acc)' }} /><span style={{ width: 5, height: 5, borderRadius: 2, background: t.mut }} /><span style={{ width: 5, height: 5, borderRadius: 2, background: t.mut }} />
                </div>
                <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ height: 34, borderRadius: 6, background: '#1A1F26' }} />
                  <div style={{ display: 'flex', gap: 4 }}>{[0, 1, 2].map((i) => <span key={i} style={{ flex: 1, height: 16, borderRadius: 4, background: t.card }} />)}</div>
                </div>
              </div>
              <span style={{ padding: '0 4px' }}>{tr(t.ru, t.en)}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group title={tr('Цвет и фон', 'Color & background')}>
        <Row title={tr('Акцентный цвет', 'Accent color')} hint={tr('Цвет кнопок, ссылок и выделения. От темы не зависит', 'Buttons, links and highlights. Independent of the theme')}>
          <div role="radiogroup" aria-label={tr('Акцентный цвет', 'Accent color')} style={{ display: 'flex', gap: 4 }}>
            {accents.map(([id, c, ru, en]) => (
              <button key={id} type="button" role="radio" className="set-swatch" aria-checked={prefs.accent === id} aria-label={tr(ru, en)} title={tr(ru, en)}
                onClick={() => set({ accent: id })} style={{ ['--sw' as string]: c }}><span style={{ background: c }} /></button>
            ))}
          </div>
        </Row>
        <Row title={tr('Задний фон', 'Background')} hint={bgHint}>
          <Seg label={tr('Задний фон', 'Background')} value={prefs.bg} onChange={(v) => set({ bg: v })}
            options={[{ v: 'live', l: tr('Живой', 'Live') }, { v: 'static', l: tr('Статичный', 'Static') }, { v: 'off', l: tr('Выключен', 'Off') }]} />
        </Row>
        <Row title={tr('Яркость фона', 'Background brightness')} hint={tr('Насколько заметны точки и пятна за карточками', 'How visible the dots and glow behind cards are')} htmlFor="set-int">
          <input id="set-int" className="rng" type="range" min={0} max={200} step={10} value={prefs.intensity} disabled={prefs.bg === 'off'}
            onChange={(e) => set({ intensity: Number(e.target.value) })} style={{ width: 180 }} />
          <span className="set-mono" style={{ minWidth: 44, textAlign: 'right', color: 'var(--mut2)' }}>{prefs.intensity}%</span>
        </Row>
        <Row title={tr('Цвет фона под постер', 'Tint background with poster')} hint={tr('Фон окрашивается в цвета фильма, который открыт сейчас', 'The background takes the colors of the film on screen')}>
          <Switch label={tr('Цвет фона под постер', 'Tint background with poster')} on={prefs.posterTint} onChange={(v) => set({ posterTint: v })} />
        </Row>
        <Row title={tr('Меньше анимации', 'Reduce motion')} hint={tr('Фон замирает, переходы становятся мгновенными', 'The background stops moving, transitions become instant')}>
          <Switch label={tr('Меньше анимации', 'Reduce motion')} on={prefs.calm} onChange={(v) => set({ calm: v })} />
        </Row>
      </Group>
      <Group title={tr('Интерфейс', 'Interface')}>
        <Row title={tr('Трейлеры при наведении', 'Trailers on hover')} hint={tr('Без звука, в шапке и на постере. Видео берётся с YouTube', 'Muted, in the header and on posters. Video comes from YouTube')}>
          <Switch label={tr('Трейлеры при наведении', 'Trailers on hover')} on={prefs.trailers} onChange={(v) => set({ trailers: v })} />
        </Row>
        <Row title={tr('Размер текста', 'Text size')} hint={tr('Только на этом устройстве. Весь интерфейс — Ctrl + «+» / «−»', 'This device only. Whole interface: Ctrl + plus / minus')} htmlFor="set-text">
          <Select id="set-text" value={String(text)} onChange={(v) => { setTextScale(Number(v)); setText(Number(v)); }}
            options={textSteps.map((x) => ({ v: String(x), l: x === 1 ? recommended('100%') : `${Math.round(x * 100)}%` }))} />
        </Row>
        <Row title={tr('Язык интерфейса', 'Interface language')} hint={tr('Меню, кнопки и подсказки', 'Menus, buttons and hints')}>
          <Seg label={tr('Язык интерфейса', 'Interface language')} value={st.uiLang} onChange={setUi} options={[{ v: 'ru', l: 'Русский' }, { v: 'en', l: 'English' }]} />
        </Row>
      </Group>
    </>
  );
}

// ---------- Library ----------

const kindLabel: Record<string, [string, string]> = { auto: ['Фильмы и сериалы', 'Movies & shows'], movies: ['Фильмы', 'Movies'], shows: ['Сериалы', 'Shows'], torrents: ['Загрузки', 'Downloads'], '': ['Фильмы и сериалы', 'Movies & shows'] };

export function LibrarySection({ st, save, checks }: SectionProps) {
  const { scan, toast } = useApp();
  const track = useSaver();
  const { data, reload } = useAsync(() => api.get<{ libraries: Library[]; scan: ScanStatus }>('/api/libraries'), []);
  const [picker, setPicker] = useState(false);
  const [kind, setKind] = useState('auto');
  const [menu, setMenu] = useState<number | null>(null);
  const s = scan || data?.scan;
  useEffect(() => { if (s && !s.scanning) reload(); }, [s?.scanning]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (path: string) => {
    setPicker(false);
    try { await track(api.post('/api/libraries', { path, kind })); reload(); } catch { /* shown by the saver */ }
  };
  const del = async (l: Library) => { setMenu(null); await track(api.del(`/api/libraries/${l.id}`)); reload(); };
  const rescan = () => track(api.post('/api/libraries/scan')).then(() => toast(tr('Сканирование запущено', 'Scan started')));
  const pct = s && s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
  return (
    <>
      <SectionHead title={tr('Библиотека', 'Library')} note={tr('Папки с фильмами и сериалами на этом компьютере и откуда брать постеры.', 'Folders with films and shows on this PC, and where posters come from.')} />
      <Group title={tr('Папки', 'Folders')}>
        {data?.libraries.length === 0 && <div className="set-sub set-row-d">{tr('Папок пока нет. Добавьте папку с фильмами или сериалами.', 'No folders yet. Add a folder with films or shows.')}</div>}
        {data?.libraries.map((l) => {
          const busy = s?.scanning && s.library === l.path;
          return (
            <div key={l.id} className="set-list-i">
              <Icon name="folder" style={{ color: 'var(--mut)' }} />
              <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span className="set-mono" style={{ wordBreak: 'break-all', color: 'var(--fg)' }}>{l.path}</span>
                <span className="set-row-d">{tr(...(kindLabel[l.kind] || kindLabel.auto))} · <span className="set-mono">{l.files ?? 0}</span> {files(l.files ?? 0)}</span>
              </div>
              {!l.online ? <Badge kind="warn">{tr('Диск отключён', 'Drive offline')}</Badge> : busy ? <Badge kind="warn">{tr('Сканирую', 'Scanning')} {pct}%</Badge> : <Badge kind="ok">{tr('Готово', 'Ready')}</Badge>}
              <div style={{ position: 'relative' }}>
                <button type="button" className="ri" aria-label={`${tr('Действия с папкой', 'Folder actions')} ${l.path}`} aria-haspopup="menu" aria-expanded={menu === l.id} onClick={() => setMenu(menu === l.id ? null : l.id)}><Icon name="more" /></button>
                {menu === l.id && <FolderMenu onClose={() => setMenu(null)} items={[
                  [tr('Пересканировать', 'Rescan'), () => { setMenu(null); track(api.post('/api/libraries/scan')); }],
                  [tr('Убрать из библиотеки', 'Remove from library'), () => del(l)],
                ]} />}
              </div>
            </div>
          );
        })}
        <Row title={tr('Новая папка', 'New folder')} hint={tr('Всё, что в ней лежит, появится в разделах «Фильмы» и «Сериалы»', 'Everything inside shows up under Movies and Shows')}>
          <Select label={tr('Что в папке', 'Folder contents')} value={kind} onChange={setKind}
            options={[{ v: 'auto', l: tr('Определять самому', 'Detect automatically') }, { v: 'movies', l: tr('Только фильмы', 'Movies only') }, { v: 'shows', l: tr('Только сериалы', 'Shows only') }]} />
          <Btn primary onClick={() => setPicker(true)}><Icon name="plus" size={16} />{tr('Добавить папку', 'Add folder')}</Btn>
        </Row>
      </Group>
      <Group title={tr('Сканирование', 'Scanning')}>
        <Row title={tr('Следить за изменениями', 'Watch for changes')} hint={tr('Новые файлы появляются в библиотеке сами, через пару секунд после копирования', 'New files appear by themselves a few seconds after copying')}>
          <Switch label={tr('Следить за изменениями', 'Watch for changes')} on={st.watchFS !== '0'} onChange={(v) => track(save({ watchFS: v ? '1' : '0' }))} />
        </Row>
        <Row title={tr('Сканировать при запуске', 'Scan on start')} hint={tr('При старте Rivo проверит папки на новые и удалённые файлы', 'On start Rivo checks folders for new and removed files')}>
          <Switch label={tr('Сканировать при запуске', 'Scan on start')} on={st.scanOnStart !== '0'} onChange={(v) => track(save({ scanOnStart: v ? '1' : '0' }))} />
        </Row>
        <Row title={tr('Пересканировать всё', 'Rescan everything')} hint={tr('Пройтись по всем папкам заново, если что-то не подхватилось', 'Go through every folder again if something was missed')}
          status={s?.scanning ? <Badge kind="warn">{tr('Сканирую', 'Scanning')} {pct}%</Badge> : s && s.matching > 0 ? <Badge kind="warn">{tr('Ищу описания', 'Matching')}: {s.matching}</Badge> : undefined}>
          <Btn onClick={rescan} disabled={s?.scanning}>{tr('Запустить', 'Run')}</Btn>
        </Row>
      </Group>
      <TmdbGroup st={st} save={save} checks={checks} />
      {picker && <FolderPicker title={tr('Папка библиотеки', 'Library folder')} onPick={add} onClose={() => setPicker(false)} />}
    </>
  );
}

function files(n: number) {
  const m10 = n % 10, m100 = n % 100;
  return tr(m10 === 1 && m100 !== 11 ? 'файл' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'файла' : 'файлов', n === 1 ? 'file' : 'files');
}

function FolderMenu({ items, onClose }: { items: [string, () => void][]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('mousedown', off));
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" className="glass" style={{ position: 'absolute', right: 0, top: 46, zIndex: 5, minWidth: 220, padding: 6, borderRadius: 12, border: '1px solid var(--line2)', boxShadow: '0 12px 30px var(--sh)' }}>
      {items.map(([l, f]) => <button key={l} type="button" role="menuitem" className="set-mi" onClick={f}>{l}</button>)}
    </div>
  );
}

function TmdbGroup({ st, save, checks }: { st: S; save: SectionProps['save']; checks: Check[] }) {
  const track = useSaver();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [via, setVia] = useState<string>(st.tmdbVia || 'cub');
  const [apiUrl, setApiUrl] = useState(st.tmdbApi || '');
  const [imgUrl, setImgUrl] = useState(st.tmdbImg || '');
  const [justChecked, setJustChecked] = useState(false);
  const chk = checks.find((c) => c.id === 'tmdb');
  const status = !st.tmdbKeySet ? <Badge kind="mut">{tr('Не задан', 'Not set')}</Badge>
    : justChecked || chk?.ok ? <Badge kind="ok">{tr('Работает', 'Working')}</Badge>
    : chk ? <Badge kind="warn">{tr('Не отвечает', 'No answer')}</Badge> : undefined;
  const verify = async () => {
    setBusy(true);
    try { await track(save({ tmdbKey: key.trim() })); setKey(''); setJustChecked(true); } catch { /* shown by the saver */ } finally { setBusy(false); }
  };
  const pickVia = (v: string) => {
    setVia(v);
    if (v !== 'custom') track(save({ tmdbVia: v })).catch(() => setVia(st.tmdbVia || 'cub'));
  };
  return (
    <Group title={tr('Описания и постеры', 'Descriptions & posters')}>
      <Row title={tr('Язык описаний', 'Description language')} hint={tr('На каком языке показывать названия и сюжет. Если перевода нет — английский', 'Language for titles and plots. Falls back to English')} htmlFor="set-meta">
        <Select id="set-meta" value={st.metaLang} onChange={(v) => track(save({ metaLang: v }))}
          options={[{ v: 'ru-RU', l: 'Русский' }, { v: 'en-US', l: 'English' }, { v: 'uk-UA', l: 'Українська' }]} />
      </Row>
      <Row title={tr('Ключ API TMDB', 'TMDB API key')} status={status} htmlFor="set-key"
        hint={<>{tr('Нужен для постеров и описаний. Бесплатно на ', 'Needed for posters and plots. Free at ')}<a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">themoviedb.org</a></>}>
        <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (key.trim()) verify(); }}>
          <input id="set-key" className="inp mono" style={{ height: 44, borderRadius: 12, width: 220, fontSize: 'calc(12px * var(--fs))' }} value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={st.tmdbKeySet ? '••••••••' + (st.tmdbKeyTail || '') : tr('вставьте ключ', 'paste the key')} autoComplete="off" />
          <button className="btn btn-l sm" style={{ height: 44 }} disabled={busy || !key.trim()}>{busy ? <span className="spin" /> : tr('Проверить', 'Verify')}</button>
        </form>
      </Row>
      <Row title={tr('Подключение к TMDB', 'Connection to TMDB')} hint={via === 'direct' ? tr('Напрямую — если TMDB открывается без VPN', 'Direct — when TMDB opens without a VPN') : via === 'custom' ? tr('Свои адреса API и картинок', 'Your own API and image addresses') : tr('Через зеркала Lampa — работает без VPN', 'Through Lampa mirrors — works without a VPN')} htmlFor="set-via">
        <Select id="set-via" value={via} onChange={pickVia}
          options={[{ v: 'cub', l: recommended(tr('Через зеркала', 'Via mirrors')) }, { v: 'direct', l: tr('Напрямую', 'Direct') }, { v: 'custom', l: tr('Своё зеркало…', 'Custom mirror…') }]} />
      </Row>
      {via === 'custom' && (
        <Row wide title={tr('Адреса зеркала', 'Mirror addresses')} hint={tr('Rivo проверит, что TMDB отвечает, и только тогда сохранит', 'Rivo checks that TMDB answers before saving')}>
          <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }} onSubmit={(e) => { e.preventDefault(); track(save({ tmdbVia: 'custom', tmdbApi: apiUrl.trim(), tmdbImg: imgUrl.trim() })).catch(() => {}); }}>
            <input className="inp mono" aria-label={tr('Адрес API', 'API address')} style={{ flex: '1 1 220px', height: 44, borderRadius: 12, fontSize: 'calc(12px * var(--fs))' }} value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://…/3" />
            <input className="inp mono" aria-label={tr('Адрес картинок', 'Images address')} style={{ flex: '1 1 220px', height: 44, borderRadius: 12, fontSize: 'calc(12px * var(--fs))' }} value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} placeholder="https://…/t/p" />
            <button className="btn btn-l sm" style={{ height: 44 }}>{tr('Проверить', 'Verify')}</button>
          </form>
        </Row>
      )}
    </Group>
  );
}

// ---------- Playback ----------

const langOpts = (none: string): Opt<string>[] => [{ v: 'rus', l: 'Русский' }, { v: 'eng', l: 'English' }, { v: 'ukr', l: 'Українська' }, { v: '', l: none }];

export function Playback({ st, save }: SectionProps) {
  const track = useSaver();
  const set = (p: Patch) => track(save(p)).catch(() => {});
  const player = st.useExternal === '1' ? (st.playerKind === 'mpv' ? 'mpv' : 'vlc') : 'builtin';
  const pick = (v: string) => set(v === 'builtin' ? { useExternal: '', playerKind: 'builtin' } : { useExternal: '1', playerKind: v });
  const playerHint = {
    builtin: tr('Играет прямо в окне Rivo, умеет дорожки, субтитры и отправку на ТВ', 'Plays inside Rivo with tracks, subtitles and casting'),
    mpv: tr('Фильм откроется в mpv отдельным окном на этом компьютере', 'Films open in mpv in a separate window on this PC'),
    vlc: tr('Фильм откроется в VLC отдельным окном на этом компьютере', 'Films open in VLC in a separate window on this PC'),
  }[player];
  return (
    <>
      <SectionHead title={tr('Воспроизведение', 'Playback')} note={tr('Чем открывать фильмы и что включать по умолчанию.', 'What plays your films and what is on by default.')} />
      <Group title={tr('Плеер', 'Player')}>
        <Row title={tr('Плеер', 'Player')} hint={playerHint}>
          <Seg label={tr('Плеер', 'Player')} value={player} onChange={pick} options={[{ v: 'builtin', l: tr('Встроенный', 'Built-in') }, { v: 'mpv', l: 'mpv' }, { v: 'vlc', l: 'VLC' }]} />
        </Row>
        {player !== 'builtin' && (
          <Row title={tr('Где лежит плеер', 'Player location')} hint={tr('Заполните, только если Rivo не нашёл плеер сам', 'Only needed if Rivo could not find it')} htmlFor="set-ext">
            <input id="set-ext" className="inp mono" style={{ height: 44, borderRadius: 12, width: 300, maxWidth: '100%', fontSize: 'calc(12px * var(--fs))' }} defaultValue={st.externalPlayer}
              placeholder={player === 'mpv' ? 'C:\\Program Files\\mpv\\mpv.exe' : 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'}
              onBlur={(e) => e.target.value !== st.externalPlayer && set({ externalPlayer: e.target.value })} />
          </Row>
        )}
        <Row title={tr('Автопереход к следующей серии', 'Autoplay next episode')} hint={tr('За 10 секунд до конца серии начнётся отсчёт до следующей', 'A countdown to the next episode starts 10 seconds before the end')}>
          <Switch label={tr('Автопереход к следующей серии', 'Autoplay next episode')} on={st.autoNext !== '0'} onChange={(v) => set({ autoNext: v ? '1' : '0' })} />
        </Row>
        <Row title={tr('Отмечать просмотренным', 'Mark as watched')} hint={tr('Когда досмотрели до этой точки, фильм уходит из «Продолжить»', 'Once you reach this point the film leaves “Continue”')}>
          <Seg label={tr('Отмечать просмотренным', 'Mark as watched')} value={st.watchedAt || '90'} onChange={(v) => set({ watchedAt: v })}
            options={[{ v: '90', l: '90%', title: tr('Рекомендуем: титры обычно не досматривают', 'Recommended: credits are usually skipped') }, { v: '95', l: '95%' }, { v: 'manual', l: tr('Вручную', 'Manually') }]} />
        </Row>
      </Group>
      <Group title={tr('Язык по умолчанию', 'Default language')}>
        <Row title={tr('Озвучка', 'Audio')} hint={tr('Если в файле несколько дорожек, сразу включится эта', 'With several tracks in a file, this one starts')} htmlFor="set-alang">
          <Select id="set-alang" value={st.audioLang || ''} onChange={(v) => set({ audioLang: v })} options={langOpts(tr('Как в файле', 'As in the file'))} />
        </Row>
        <Row title={tr('Субтитры', 'Subtitles')} hint={tr('Включаются сами, только если озвучка на другом языке', 'Turn on by themselves only when the audio is in another language')} htmlFor="set-slang">
          <Select id="set-slang" value={st.subLang} onChange={(v) => set({ subLang: v })} options={langOpts(tr('Не включать', 'Off'))} />
        </Row>
      </Group>
    </>
  );
}

// ---------- Transcoding ----------

const encName: Record<string, string> = { nvenc: 'NVIDIA (NVENC)', qsv: 'Intel (Quick Sync)', amf: 'AMD (AMF)', vaapi: 'VAAPI', videotoolbox: 'Apple (VideoToolbox)' };

export function Transcoding({ st, save }: SectionProps) {
  const track = useSaver();
  const set = (p: Patch) => track(save(p)).catch(() => {});
  const enc = st.hw?.encoders || [];
  const cache = useAsync(() => api.get<{ bytes: number }>('/api/cache'), []);
  const [clearing, setClearing] = useState(false);
  const clear = async () => {
    setClearing(true);
    try { cache.setData(await track(api.post<{ bytes: number }>('/api/cache/clear'))); } catch { /* shown by the saver */ } finally { setClearing(false); }
  };
  const hwOpts: Opt<string>[] = [
    { v: 'auto', l: recommended(tr('Выбирать самому', 'Automatic') + (st.encoder && st.encoder !== 'cpu' ? ` · ${encName[st.encoder] || st.encoder}` : '')) },
    ...enc.map((e) => ({ v: e, l: encName[e] || e })),
    { v: 'cpu', l: tr('Только процессор', 'Processor only') },
  ];
  return (
    <>
      <SectionHead title={tr('Перекодирование', 'Transcoding')} note={tr('Если телевизор или браузер не понимает файл, Rivo пересобирает видео на лету.', 'When a TV or browser can’t read a file, Rivo converts the video on the fly.')} />
      <Group title={tr('Видеокарта', 'Graphics card')}>
        {!st.hw?.ffmpegFound && (
          <Row title="FFmpeg" status={<Badge kind="err">{tr('Не найден', 'Not found')}</Badge>} hint={tr('Без него не работает перекодирование. Переустановите Rivo — FFmpeg идёт в комплекте', 'Transcoding needs it. Reinstall Rivo — FFmpeg is bundled')} />
        )}
        <Row title={tr('Перекодировать видеокартой', 'Use the graphics card')} htmlFor="set-hw"
          status={enc.length ? <Badge kind="ok">{tr('Найдена', 'Found')}</Badge> : <Badge kind="mut">{tr('Не найдена', 'Not found')}</Badge>}
          hint={tr('Видеокарта справляется быстрее и тише, чем процессор', 'A graphics card is faster and quieter than the processor')}>
          <Select id="set-hw" value={st.hwaccel} onChange={(v) => set({ hwaccel: v })} options={hwOpts} />
        </Row>
      </Group>
      <Group title={tr('Качество', 'Quality')}>
        <Row title={tr('Качество', 'Quality')} hint={tr('Если сеть или телевизор не тянут оригинал, картинка станет меньше', 'If the network or TV can’t keep up, the picture gets smaller')} htmlFor="set-q">
          <Select id="set-q" value={st.quality} onChange={(v) => set({ quality: v })}
            options={[{ v: 'original', l: recommended(tr('Как в файле', 'Original')) }, { v: '1080p', l: '1080p' }, { v: '720p', l: '720p' }, { v: '480p', l: '480p' }]} />
        </Row>
        <Row title="HDR → SDR" hint={tr('HDR-фильмы не будут блёклыми на обычных экранах', 'HDR films won’t look washed out on regular screens') + (st.hw && !st.hw.zscale ? tr(' · упрощённый режим', ' · basic mode') : '')}>
          <Switch label="HDR → SDR" on={st.tonemap !== '0'} onChange={(v) => set({ tonemap: v ? '1' : '0' })} />
        </Row>
        <Row title={tr('Сколько фильмов одновременно', 'Films at once')} hint={tr('Сколько устройств могут смотреть перекодированное видео сразу', 'How many devices can watch converted video at the same time')}>
          <Seg label={tr('Сколько фильмов одновременно', 'Films at once')} value={st.maxStreams} onChange={(v) => set({ maxStreams: v })} options={[{ v: '1', l: '1' }, { v: '2', l: '2' }, { v: '3', l: '3' }]} />
        </Row>
      </Group>
      <Group title={tr('Временные файлы', 'Temporary files')}>
        <Row title={tr('Временные файлы', 'Temporary files')} hint={tr('Кусочки перекодированного видео и субтитры. Удалять можно в любой момент', 'Pieces of converted video and subtitles. Safe to delete any time')}>
          <span className="set-mono" style={{ color: 'var(--mut2)' }}>{cache.data ? fmtSize(cache.data.bytes) : '—'}</span>
          <Btn onClick={clear} busy={clearing}>{tr('Очистить сейчас', 'Clear now')}</Btn>
        </Row>
      </Group>
    </>
  );
}
