// Network & devices and System groups: torrents, network and VPN, profiles,
// backup, diagnostics.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Check, type Indexer, type SearchPrefs, type TorrentSettings } from '../../api';
import { useApp, useAsync } from '../../state';
import { tr } from '../../i18n';
import { Icon } from '../../components/Icon';
import { FolderPicker } from '../../components/FolderPicker';
import { Modal } from '../../components/CastDialog';
import { Avatar, MAX_PROFILES, newProfile, ProfileDialog, type ProfileDraft } from '../Profiles';
import { Badge, Btn, Group, NumField, Row, SectionHead, Seg, Select, Switch, recommended, useSaver, type Opt } from './ui';
import type { SectionProps } from './basic';

export type TorrentProps = SectionProps & { ts: TorrentSettings; saveTs: (p: Partial<TorrentSettings>) => Promise<void> };

const inp = { height: 44, borderRadius: 12, fontSize: 'calc(12px * var(--fs))' } as const;

// withCurrent keeps a value that isn't one of the presets selectable.
function withCurrent(opts: Opt<string>[], cur: string, label: string): Opt<string>[] {
  return opts.some((o) => o.v === cur) ? opts : [...opts, { v: cur, l: label }];
}

// ---------- Torrents ----------

export function Torrents({ ts, saveTs }: TorrentProps) {
  const [picker, setPicker] = useState<null | 'downloadDir' | 'moviesDir' | 'showsDir'>(null);
  const dir = (k: 'downloadDir' | 'moviesDir' | 'showsDir', title: string, hint: string) => (
    <Row title={title} hint={hint}>
      <span className="set-mono" style={{ color: 'var(--fg2)', wordBreak: 'break-all', maxWidth: 320 }}>{ts[k] || '—'}</span>
      <Btn onClick={() => setPicker(k)}>{tr('Изменить', 'Change')}</Btn>
    </Row>
  );
  const ratioOpts = withCurrent([
    { v: '0', l: tr('Не раздавать', 'Don’t seed') }, { v: '1', l: tr('Пока не отдам столько же', 'Until shared 1×') },
    { v: '1.5', l: recommended(tr('Пока не отдам в 1,5 раза больше', 'Until shared 1.5×')) }, { v: '3', l: tr('Пока не отдам в 3 раза больше', 'Until shared 3×') },
    { v: '1000', l: tr('Всегда, пока не удалю', 'Always, until removed') },
  ], String(ts.seedRatio), `${ts.seedRatio}×`);
  const bufOpts = withCurrent([32, 64, 80, 128, 256].map((n) => ({ v: String(n), l: n === 80 ? recommended(`${n} ${tr('МБ', 'MB')}`) : `${n} ${tr('МБ', 'MB')}` })), String(ts.bufferMB), `${ts.bufferMB} ${tr('МБ', 'MB')}`);
  return (
    <>
      <SectionHead title={tr('Торренты', 'Torrents')} note={tr('Куда и как быстро качать, и что делать с фильмом после просмотра.', 'Where and how fast to download, and what happens after watching.')} />
      <Group title={tr('Клиент', 'Client')}>
        <Row title={tr('Торрент-клиент', 'Torrent client')} hint={tr('Встроенный работает сразу. qBittorrent и Transmission пока не подключаются', 'The built-in one works right away. qBittorrent and Transmission aren’t supported yet')}>
          <Seg label={tr('Торрент-клиент', 'Torrent client')} value="builtin" onChange={() => {}}
            options={[{ v: 'builtin', l: tr('Встроенный', 'Built-in') }, { v: 'qbt', l: 'qBittorrent', disabled: true, title: tr('Скоро', 'Coming soon') }, { v: 'tr', l: 'Transmission', disabled: true, title: tr('Скоро', 'Coming soon') }]} />
        </Row>
        {dir('downloadDir', tr('Папка загрузок', 'Download folder'), tr('Сюда качаются торренты, пока их не перенесли в библиотеку', 'Torrents download here before moving to the library'))}
      </Group>
      <Group title={tr('Скорость', 'Speed')}>
        <Row title={tr('Скорость загрузки ↓', 'Download speed ↓')} hint={tr('0 — без ограничения. Пригодится, если интернет нужен ещё кому-то', '0 means no limit. Useful when others need the internet too')} htmlFor="set-down">
          <NumField id="set-down" value={ts.downKBs} min={0} unit={tr('КБ/с', 'KB/s')} onChange={(v) => saveTs({ downKBs: v })} />
        </Row>
        <Row title={tr('Скорость отдачи ↑', 'Upload speed ↑')} hint={tr('0 — без ограничения. Отдача помогает быстрее качать другим', '0 means no limit. Uploading helps others download faster')} htmlFor="set-up">
          <NumField id="set-up" value={ts.upKBs} min={0} unit={tr('КБ/с', 'KB/s')} onChange={(v) => saveTs({ upKBs: v })} />
        </Row>
        <Row title={tr('Буфер перед стартом', 'Start buffer')} hint={tr('Сколько скачать, прежде чем фильм начнёт играть. Больше — меньше пауз', 'How much to fetch before playback starts. More means fewer pauses')} htmlFor="set-buf">
          <Select id="set-buf" value={String(ts.bufferMB)} onChange={(v) => saveTs({ bufferMB: Number(v) })} options={bufOpts} />
        </Row>
      </Group>
      <Group title={tr('После загрузки', 'After download')}>
        <Row title={tr('Сохранять в библиотеку после просмотра', 'Keep in the library after watching')} hint={tr('Если выключить, фильм удалится с диска, когда вы его досмотрите', 'When off, the film is deleted from disk once you finish it')}>
          <Switch label={tr('Сохранять в библиотеку после просмотра', 'Keep in the library after watching')} on={ts.keepWatched} onChange={(v) => saveTs({ keepWatched: v })} />
        </Row>
        <Row title={tr('Раскладывать по папкам', 'Sort into folders')} hint={tr('Готовые фильмы переезжают в «Название (Год)», серии — в «Сезон N»', 'Finished films move to “Title (Year)”, episodes to “Season N”')}>
          <Switch label={tr('Раскладывать по папкам', 'Sort into folders')} on={ts.autoImport} onChange={(v) => saveTs({ autoImport: v })} />
        </Row>
        {ts.autoImport && dir('moviesDir', tr('Папка для фильмов', 'Movies folder'), tr('Куда переносить скачанные фильмы', 'Where finished films go'))}
        {ts.autoImport && dir('showsDir', tr('Папка для сериалов', 'Shows folder'), tr('Куда переносить скачанные серии', 'Where finished episodes go'))}
        <Row title={tr('Раздача после загрузки', 'Seeding after download')} hint={tr('Сколько отдавать другим, прежде чем остановиться', 'How much to share with others before stopping')} htmlFor="set-seed">
          <Select id="set-seed" value={String(ts.seedRatio)} onChange={(v) => saveTs({ seedRatio: Number(v) })} options={ratioOpts} />
        </Row>
      </Group>
      <Indexers />
      <Group title={tr('Дополнительно', 'Advanced')}>
        <Row title={tr('Качать одновременно', 'Downloads at once')} hint={tr('Остальные встанут в очередь', 'The rest wait in a queue')} htmlFor="set-act">
          <NumField id="set-act" value={ts.maxActive} min={1} max={20} unit={tr('шт.', '')} onChange={(v) => saveTs({ maxActive: v })} />
        </Row>
        <Row title={tr('Оставлять свободным', 'Keep free')} hint={tr('Загрузки встанут на паузу, когда места на диске останется меньше', 'Downloads pause when free disk space drops below this')} htmlFor="set-free">
          <NumField id="set-free" value={ts.minFreeGB} min={0} unit={tr('ГБ', 'GB')} onChange={(v) => saveTs({ minFreeGB: v })} />
        </Row>
        <Row title={tr('Качать по расписанию', 'Download schedule')} hint={tr('Например, только ночью, когда интернет свободен', 'For example only at night, when the internet is free')}>
          <Select label={tr('С', 'From')} value={String(ts.scheduleFrom)} onChange={(v) => saveTs({ scheduleFrom: Number(v) })}
            options={[{ v: '-1', l: tr('Всегда', 'Always') }, ...hours]} />
          {ts.scheduleFrom >= 0 && <Select label={tr('До', 'To')} value={String(ts.scheduleTo)} onChange={(v) => saveTs({ scheduleTo: Number(v) })} options={hours} />}
        </Row>
        <Row wide title={tr('Дополнительные трекеры', 'Extra trackers')} hint={tr('Добавляются ко всем раздачам и помогают найти больше источников. По одному в строке', 'Added to every torrent to find more peers. One per line')}>
          <textarea className="inp mono" aria-label={tr('Дополнительные трекеры', 'Extra trackers')} defaultValue={ts.trackers} onBlur={(e) => e.target.value !== ts.trackers && saveTs({ trackers: e.target.value })}
            style={{ width: '100%', minHeight: 88, padding: 10, borderRadius: 12, resize: 'vertical', fontSize: 'calc(12px * var(--fs))' }} />
        </Row>
      </Group>
      {picker && <FolderPicker title={tr('Выберите папку', 'Choose folder')} initial={ts[picker]} onPick={(p) => { saveTs({ [picker]: p }); setPicker(null); }} onClose={() => setPicker(null)} />}
    </>
  );
}

const hours: Opt<string>[] = Array.from({ length: 24 }, (_, h) => ({ v: String(h), l: `${String(h).padStart(2, '0')}:00` }));

// Indexers: search sources, saved as soon as a field is left.
function Indexers() {
  const track = useSaver();
  const { data } = useAsync(() => api.get<{ indexers: Indexer[] | null; prefs: SearchPrefs }>('/api/indexers'), []);
  const [list, setList] = useState<Indexer[]>([]);
  const [prefs, setPrefs] = useState<SearchPrefs | null>(null);
  useEffect(() => { if (data) { setList(data.indexers || []); setPrefs(data.prefs); } }, [data]);
  const put = (l: Indexer[], p: SearchPrefs | null) => { setList(l); setPrefs(p); track(api.put('/api/indexers', { indexers: l, prefs: p })).catch(() => {}); };
  const edit = (i: number, p: Partial<Indexer>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const commit = () => put(list, prefs);
  return (
    <Group title={tr('Источники поиска', 'Search sources')}>
      {list.map((x, i) => (
        <div key={i} className="set-list-i">
          <Switch label={`${x.name || 'Torznab'}: ${tr('включён', 'enabled')}`} on={x.on} onChange={(v) => { const l = list.map((y, j) => (j === i ? { ...y, on: v } : y)); put(l, prefs); }} />
          <div style={{ flex: '1 1 300px', display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
            <input className="inp" aria-label={tr('Название', 'Name')} style={{ ...inp, flex: '0 1 140px' }} value={x.name} onChange={(e) => edit(i, { name: e.target.value })} onBlur={commit} />
            <input className="inp mono" aria-label={tr('Адрес', 'Address')} style={{ ...inp, flex: '1 1 220px' }} value={x.url} onChange={(e) => edit(i, { url: e.target.value })} onBlur={commit} placeholder="http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/" />
            {x.kind !== 'jacred' && <input className="inp mono" aria-label={tr('Ключ API', 'API key')} style={{ ...inp, flex: '0 1 150px' }} value={x.apiKey} onChange={(e) => edit(i, { apiKey: e.target.value })} onBlur={commit} placeholder="API key" />}
          </div>
          <Badge kind="mut">{x.kind === 'jacred' ? 'JacRed' : 'Torznab'}</Badge>
          <button type="button" className="ri" aria-label={`${tr('Удалить источник', 'Remove source')} ${x.name}`} onClick={() => put(list.filter((_, j) => j !== i), prefs)}><Icon name="trash" size={18} /></button>
        </div>
      ))}
      <Row title={tr('Добавить источник', 'Add a source')} hint={tr('JacRed ищет по русским трекерам без регистрации. Jackett и Prowlarr — как Torznab', 'JacRed searches Russian trackers with no sign-up. Jackett and Prowlarr go in as Torznab')}>
        {!list.some((x) => x.kind === 'jacred') && <Btn onClick={() => put([...list, { name: 'JacRed', url: 'https://jac.red', apiKey: '', on: true, kind: 'jacred' }], prefs)}>JacRed</Btn>}
        <Btn onClick={() => setList([...list, { name: 'Jackett', url: '', apiKey: '', on: true }])}>Torznab</Btn>
      </Row>
      {prefs && <>
        <Row title={tr('Качество в поиске', 'Search quality')} hint={tr('Такие раздачи окажутся в начале списка', 'These releases go to the top of the list')} htmlFor="set-sq">
          <Select id="set-sq" value={prefs.quality} onChange={(v) => put(list, { ...prefs, quality: v })} options={[{ v: '2160p', l: '4K' }, { v: '1080p', l: recommended('1080p') }, { v: '720p', l: '720p' }, { v: '', l: tr('Любое', 'Any') }]} />
        </Row>
        <Row title={tr('Озвучка в поиске', 'Search audio')} hint={tr('Раздачи с этой озвучкой окажутся выше', 'Releases with this audio rank higher')} htmlFor="set-sl">
          <Select id="set-sl" value={prefs.language} onChange={(v) => put(list, { ...prefs, language: v })} options={[{ v: 'rus', l: 'Русский' }, { v: 'eng', l: 'English' }, { v: '', l: tr('Любая', 'Any') }]} />
        </Row>
        <Row title={tr('Не больше', 'At most')} hint={tr('Раздачи тяжелее не показывать. 0 — без ограничения', 'Hide heavier releases. 0 means no limit')} htmlFor="set-ms">
          <NumField id="set-ms" value={prefs.maxSizeGB} min={0} unit={tr('ГБ', 'GB')} onChange={(v) => put(list, { ...prefs, maxSizeGB: v })} />
        </Row>
        <Row title={tr('Не меньше раздающих', 'At least seeders')} hint={tr('Раздачи, где почти никто не раздаёт, качаются медленно', 'Releases with few seeders download slowly')} htmlFor="set-mn">
          <NumField id="set-mn" value={prefs.minSeeds} min={0} onChange={(v) => put(list, { ...prefs, minSeeds: v })} />
        </Row>
      </>}
    </Group>
  );
}

// ---------- Network & VPN ----------

type Iface = { name: string; ip: string; up: boolean; vpn: boolean };

export function Network({ st, save, ts, saveTs, checks }: TorrentProps) {
  const { state, toast } = useApp();
  const track = useSaver();
  const { data: ifs } = useAsync(() => api.get<Iface[]>('/api/interfaces'), []);
  const [mode, setMode] = useState<'home' | 'pw'>(st.passwordSet ? 'pw' : 'home');
  const [pw, setPw] = useState('');
  const [howPort, setHowPort] = useState(false);
  useEffect(() => setMode(st.passwordSet ? 'pw' : 'home'), [st.passwordSet]);
  const url = state?.lanUrls?.[0] || '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast(tr('Адрес скопирован', 'Address copied')); } catch { toast(url); }
  };
  const pickMode = (m: 'home' | 'pw') => {
    setMode(m);
    if (m === 'home' && st.passwordSet) track(save({ password: '' })).catch(() => {});
  };
  const setPassword = () => track(save({ password: pw })).then(() => setPw('')).catch(() => {});
  const bound = (ifs || []).find((i) => i.name === ts.bindIface);
  const port = checks.find((c) => c.id === 'port');
  const ifOpts: Opt<string>[] = [
    { v: '', l: tr('Любое', 'Any') },
    ...(ifs || []).map((i) => ({ v: i.name, l: `${i.name}${i.vpn ? ' · VPN' : ''}${i.ip ? ` · ${i.ip}` : ''}${i.up ? '' : ` · ${tr('отключено', 'down')}`}` })),
  ];
  if (ts.bindIface && !ifOpts.some((o) => o.v === ts.bindIface)) ifOpts.push({ v: ts.bindIface, l: `${ts.bindIface} · ${tr('отключено', 'down')}` });
  return (
    <>
      <SectionHead title={tr('Сеть и VPN', 'Network & VPN')} note={tr('Кто может открыть Rivo с других устройств и через какое подключение идут торренты.', 'Who can open Rivo from other devices and which connection torrents use.')} />
      <Group title={tr('Доступ с других устройств', 'Access from other devices')}>
        <Row title={tr('Кто может открыть Rivo', 'Who can open Rivo')} hint={mode === 'pw' ? tr('Телефоны и ТВ спросят пароль один раз. На этом компьютере — никогда', 'Phones and TVs ask for the password once. Never on this PC') : tr('Любое устройство в вашей домашней сети, без пароля', 'Any device on your home network, no password')}>
          <Seg label={tr('Кто может открыть Rivo', 'Who can open Rivo')} value={mode} onChange={pickMode} options={[{ v: 'home', l: tr('Только домашняя сеть', 'Home network only') }, { v: 'pw', l: tr('С паролем', 'With a password') }]} />
        </Row>
        {mode === 'pw' && (
          <Row title={tr('Пароль', 'Password')} htmlFor="set-pw" status={st.passwordSet ? <Badge kind="ok">{tr('Установлен', 'Set')}</Badge> : <Badge kind="warn">{tr('Не задан', 'Not set')}</Badge>}
            hint={st.passwordSet ? tr('Введите новый, чтобы сменить', 'Type a new one to change it') : tr('Пока пароль не задан, вход свободный', 'Until it is set, access stays open')}>
            <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (pw) setPassword(); }}>
              <input id="set-pw" className="inp" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ ...inp, width: 200 }} />
              <button className="btn btn-d sm" style={{ height: 44 }} disabled={!pw}>{st.passwordSet ? tr('Сменить', 'Change') : tr('Установить', 'Set')}</button>
            </form>
          </Row>
        )}
        <Row title={tr('Адрес для других устройств', 'Address for other devices')} hint={tr('Откройте его в браузере телефона или телевизора', 'Open it in a phone or TV browser')}>
          <span className="set-mono" style={{ color: 'var(--fg)' }}>{url || tr('нет сети', 'no network')}</span>
          {url && <Btn onClick={copy}><Icon name="copy" size={16} />{tr('Копировать', 'Copy')}</Btn>}
        </Row>
      </Group>
      <Group title={tr('VPN для торрентов', 'VPN for torrents')}>
        <Row title={tr('Через какое подключение качать', 'Connection for downloads')} htmlFor="set-if"
          status={ts.bindIface ? (bound?.up ? <Badge kind="ok">{tr('Подключён', 'Connected')}</Badge> : <Badge kind="warn">{tr('Отключён', 'Disconnected')}</Badge>) : undefined}
          hint={tr('Выберите VPN, например wg0, — торренты пойдут только через него', 'Pick your VPN, e.g. wg0, and torrents only use it')}>
          <Select id="set-if" value={ts.bindIface} onChange={(v) => saveTs({ bindIface: v, killSwitch: v ? ts.killSwitch : false })} options={ifOpts} />
        </Row>
        <Row title={tr('Остановить, если VPN отключился', 'Stop if the VPN drops')} hint={ts.bindIface ? tr('Kill switch: загрузки встанут, чтобы трафик не пошёл мимо VPN', 'Kill switch: downloads stop so traffic never bypasses the VPN') : tr('Сначала выберите VPN-подключение выше', 'Pick a VPN connection above first')}>
          <Switch label={tr('Остановить, если VPN отключился', 'Stop if the VPN drops')} on={ts.killSwitch} disabled={!ts.bindIface} onChange={(v) => saveTs({ killSwitch: v })} />
        </Row>
        <Row title={tr('Входящий порт', 'Incoming port')} htmlFor="set-port"
          status={port && (port.ok ? <Badge kind="ok">{tr('Работает', 'Working')}</Badge> : <><Badge kind="warn">{tr('Закрыт', 'Closed')}</Badge> <button type="button" className="set-link" onClick={() => setHowPort(!howPort)} aria-expanded={howPort}>{tr('Как открыть?', 'How to open?')}</button></>)}
          hint={howPort ? tr(`Включите ниже «Открывать порт на роутере сам» или в настройках роутера пробросьте порт ${ts.port} TCP и UDP на этот компьютер`, `Turn on “Open the port on the router” below, or forward port ${ts.port} TCP and UDP to this PC in your router`) : tr('Через него другие находят вас — так загрузка идёт быстрее', 'Others reach you through it, so downloads go faster')}>
          <NumField id="set-port" value={ts.port} min={1024} max={65535} onChange={(v) => saveTs({ port: v })} width={96} />
        </Row>
        <Row title={tr('Открывать порт на роутере сам', 'Open the port on the router')} hint={tr('UPnP: Rivo попросит роутер открыть порт. Работает не на всех роутерах', 'UPnP: Rivo asks the router to open the port. Not every router supports it')}>
          <Switch label={tr('Открывать порт на роутере сам', 'Open the port on the router')} on={ts.upnp} onChange={(v) => saveTs({ upnp: v })} />
        </Row>
      </Group>
      <Group title={tr('Как искать участников', 'Finding peers')}>
        <Row title={tr('Искать без трекера', 'Find peers without a tracker')} hint={tr('DHT: находит раздающих, даже если трекер не отвечает', 'DHT: finds seeders even when the tracker is down')}>
          <Switch label="DHT" on={ts.dht} onChange={(v) => saveTs({ dht: v })} />
        </Row>
        <Row title={tr('Обмениваться участниками', 'Exchange peers')} hint={tr('PEX: участники раздачи подсказывают друг другу новых', 'PEX: peers tell each other about new peers')}>
          <Switch label="PEX" on={ts.pex} onChange={(v) => saveTs({ pex: v })} />
        </Row>
        <Row title={tr('Шифрование', 'Encryption')} hint={tr('Прячет торрент-трафик от провайдера. «Всегда» может уменьшить число участников', 'Hides torrent traffic from your ISP. “Always” may mean fewer peers')}>
          <Seg label={tr('Шифрование', 'Encryption')} value={ts.encryption} onChange={(v) => saveTs({ encryption: v })} options={[{ v: 'prefer', l: tr('По возможности', 'When possible') }, { v: 'require', l: tr('Всегда', 'Always') }, { v: 'off', l: tr('Выключено', 'Off') }]} />
        </Row>
        <Row title={tr('Прокси SOCKS5', 'SOCKS5 proxy')} hint={tr('Если торренты должны идти через прокси. Обычно не нужно', 'If torrents must go through a proxy. Usually not needed')} htmlFor="set-proxy">
          <input id="set-proxy" className="inp mono" style={{ ...inp, width: 260, maxWidth: '100%' }} defaultValue={ts.proxy} placeholder="socks5://host:1080" onBlur={(e) => e.target.value !== ts.proxy && saveTs({ proxy: e.target.value })} />
        </Row>
      </Group>
    </>
  );
}

// ---------- Profiles ----------

export function Profiles({ st, save }: SectionProps) {
  const { state } = useApp();
  const track = useSaver();
  const [edit, setEdit] = useState<ProfileDraft | null>(null);
  const list = state?.profiles || [];
  return (
    <>
      <SectionHead title={tr('Профили', 'Profiles')} note={tr('У каждого своя история, списки «Буду смотреть» и тема оформления.', 'Each person has their own history, watchlist and theme.')} />
      <Group title={tr('Кто смотрит', 'Who watches')}>
        {list.map((p, i) => (
          <div key={p.id} className="set-list-i">
            <Avatar p={p} size={44} />
            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span className="set-row-n">{p.name}{p.id === state?.profileId && <span className="set-row-d" style={{ fontWeight: 500 }}> · {tr('это вы', 'you')}</span>}</span>
              <span className="set-row-d">{[i === 0 && p.name !== tr('Владелец', 'Owner') ? tr('Владелец', 'Owner') : '', p.isKid ? tr('Детский', 'Kids') : '', p.hasPin ? tr('вход по PIN', 'PIN protected') : tr('без PIN', 'no PIN')].filter(Boolean).join(' · ')}</span>
            </div>
            <Btn onClick={() => setEdit({ ...p })}>{tr('Изменить', 'Edit')}</Btn>
          </div>
        ))}
        <Row title={tr('Добавить профиль', 'Add profile')} hint={tr(`До ${MAX_PROFILES} профилей. Можно поставить PIN или сделать детским`, `Up to ${MAX_PROFILES} profiles. Add a PIN or make it a kids profile`)}>
          <Btn primary disabled={list.length >= MAX_PROFILES} onClick={() => setEdit(newProfile(list.length))}><Icon name="plus" size={16} />{tr('Добавить профиль', 'Add profile')}</Btn>
        </Row>
      </Group>
      <Group title={tr('При запуске', 'On start')}>
        <Row title={tr('Спрашивать, кто смотрит', 'Ask who’s watching')} hint={tr('При открытии Rivo покажет выбор профиля, если их несколько', 'When Rivo opens it shows the profile picker if there are several')}>
          <Switch label={tr('Спрашивать, кто смотрит', 'Ask who’s watching')} on={st.askProfile === '1'} onChange={(v) => track(save({ askProfile: v ? '1' : '' })).catch(() => {})} />
        </Row>
      </Group>
      {edit && <ProfileDialog initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

// ---------- Backup ----------

export function Backup({ st, save }: SectionProps) {
  const { toast } = useApp();
  const track = useSaver();
  const info = useAsync(() => api.get<{ last: number; dir: string; auto: boolean }>('/api/backup/info'), []);
  const input = useRef<HTMLInputElement>(null);
  const restore = async (f: File) => {
    const fd = new FormData(); fd.append('file', f);
    try { await track(api.post('/api/restore', fd)); toast(tr('Копия принята. Перезапустите Rivo, чтобы применить её.', 'Backup accepted. Restart Rivo to apply it.')); } catch { /* shown by the saver */ }
  };
  const last = info.data?.last ? new Date(info.data.last * 1000) : null;
  const when = last ? last.toLocaleString(tr('ru-RU', 'en-US'), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <>
      <SectionHead title={tr('Резервная копия', 'Backup')} note={tr('Сохраните историю и настройки, чтобы не потерять их при переустановке.', 'Keep your history and settings safe across reinstalls.')} />
      <Group title={tr('Копия', 'Backup')}>
        <Row title={tr('Последняя копия', 'Last backup')} status={last ? <Badge kind="ok">{when}</Badge> : <Badge kind="warn">{tr('Ещё не было', 'None yet')}</Badge>}
          hint={tr('Входят профили, история просмотров, списки, папки и настройки. Сами фильмы — нет', 'Includes profiles, watch history, lists, folders and settings. Not the films')} />
        <Row title={tr('Автокопия раз в неделю', 'Weekly automatic backup')} hint={info.data ? tr(`Копии кладутся в ${info.data.dir}, хранятся последние 4`, `Copies go to ${info.data.dir}, the last 4 are kept`) : undefined}>
          <Switch label={tr('Автокопия раз в неделю', 'Weekly automatic backup')} on={st.autoBackup === '1'} onChange={(v) => track(save({ autoBackup: v ? '1' : '' })).then(() => info.reload()).catch(() => {})} />
        </Row>
      </Group>
      <Group title={tr('Действия', 'Actions')}>
        <Row title={tr('Создать копию сейчас', 'Back up now')} hint={tr('Файл скачается на этот компьютер', 'The file downloads to this computer')}>
          <Btn primary href="/api/backup" download onClick={() => setTimeout(() => info.reload(), 1500)}>{tr('Создать сейчас', 'Create now')}</Btn>
        </Row>
        <Row title={tr('Восстановить из копии', 'Restore from backup')} hint={tr('Текущие данные заменятся после перезапуска Rivo', 'Current data is replaced after Rivo restarts')}>
          <Btn onClick={() => input.current?.click()}>{tr('Восстановить', 'Restore')}</Btn>
          <input ref={input} type="file" accept=".db,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
        </Row>
        <Row title={tr('Список просмотренного', 'Watched list')} hint={tr('Таблица для Excel: что и когда смотрел каждый профиль', 'A spreadsheet of what each profile watched and when')}>
          <Btn href="/api/export/watched.csv" download>{tr('Экспорт CSV', 'Export CSV')}</Btn>
        </Row>
      </Group>
    </>
  );
}

// ---------- Diagnostics ----------

const plain: Record<string, [string, string]> = {
  ffmpeg: ['Перекодировщик (FFmpeg)', 'Transcoder (FFmpeg)'], server: ['Доступ из домашней сети', 'Home network access'], tv: ['Телевизоры', 'TVs'],
  tmdb: ['Постеры и описания', 'Posters & descriptions'], port: ['Входящий порт торрентов', 'Torrent incoming port'], vpn: ['VPN для торрентов', 'VPN for torrents'], disk: ['Место на диске', 'Disk space'],
};
const fixes: Record<string, { ru: string; en: string; go?: string }> = {
  ffmpeg: { ru: 'Переустановите Rivo — FFmpeg идёт в комплекте. Или положите ffmpeg.exe рядом с программой.', en: 'Reinstall Rivo — FFmpeg is bundled. Or put ffmpeg.exe next to the program.' },
  server: { ru: 'Подключите компьютер к Wi-Fi или кабелю — без сети телефоны и ТВ его не увидят.', en: 'Connect this PC to Wi-Fi or a cable — without it phones and TVs can’t see it.' },
  tv: { ru: 'Включите телевизор и проверьте, что он в той же сети. Если не помогло — разрешите Rivo в брандмауэре Windows для частных сетей.', en: 'Turn the TV on and check it’s on the same network. If that doesn’t help, allow Rivo in Windows Firewall for private networks.' },
  tmdb: { ru: 'Проверьте ключ TMDB или выберите подключение «Через зеркала».', en: 'Check the TMDB key or switch the connection to “Via mirrors”.', go: 'lib' },
  port: { ru: 'Включите «Открывать порт на роутере сам» или пробросьте порт на роутере вручную.', en: 'Turn on “Open the port on the router” or forward the port manually.', go: 'net' },
  vpn: { ru: 'Включите VPN или выберите другое подключение для торрентов.', en: 'Turn the VPN on or pick another connection for torrents.', go: 'net' },
  disk: { ru: 'Освободите место или выберите папку загрузок на другом диске.', en: 'Free up space or move the download folder to another drive.', go: 'torrents' },
};

export function Diagnostics({ checks, go, reloadChecks }: SectionProps & { checks: Check[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ lines: string[]; path: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const okN = checks.filter((c) => c.ok).length;
  const again = async () => { setBusy(true); try { await reloadChecks(); } finally { setBusy(false); } };
  return (
    <>
      <SectionHead title={tr('Диагностика', 'Diagnostics')} note={tr('Проверяем, что всё работает, и подсказываем, что делать, если нет.', 'We check that everything works and tell you what to do if not.')} />
      <Group title={tr('Проверка', 'Checks')} action={checks.length ? <Badge kind={okN === checks.length ? 'ok' : 'warn'}>{tr(`${okN} из ${checks.length} в порядке`, `${okN} of ${checks.length} fine`)}</Badge> : undefined}>
        {checks.length === 0 && <div className="set-sub"><span className="spin" /></div>}
        {checks.map((c) => {
          const [bg, fg, mark] = c.ok ? ['var(--ok-bg)', 'var(--ok-fg)', '✓'] : c.warn ? ['var(--warn-bg)', 'var(--warn-fg)', '!'] : ['var(--err-bg)', 'var(--err-fg)', '!'];
          const fix = fixes[c.id];
          return (
            <div key={c.id} className="set-check" data-row={tr(...(plain[c.id] || [c.name, c.name]))}>
              <span className="set-mark" style={{ background: bg, color: fg }} aria-label={c.ok ? tr('В порядке', 'OK') : tr('Проблема', 'Problem')} role="img">{mark}</span>
              <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span className="set-row-n">{tr(...(plain[c.id] || [c.name, c.name]))}</span>
                <span className="set-row-d" style={{ wordBreak: 'break-word' }}>{c.detail}</span>
                {open === c.id && fix && (
                  <span className="set-row-d" style={{ color: 'var(--fg2)', marginTop: 4 }}>
                    {tr(fix.ru, fix.en)} {fix.go && <button type="button" className="set-link" onClick={() => go(fix.go!)}>{tr('Открыть раздел', 'Open section')}</button>}
                    {c.id === 'tv' && <Link to="/devices">{tr('Устройства', 'Devices')}</Link>}
                  </span>
                )}
              </div>
              {!c.ok && fix && <Btn onClick={() => setOpen(open === c.id ? null : c.id)}>{tr('Как исправить', 'How to fix')}</Btn>}
            </div>
          );
        })}
      </Group>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Btn primary onClick={again} busy={busy}><Icon name="refresh" size={16} />{tr('Проверить снова', 'Check again')}</Btn>
        <Btn onClick={() => api.get<{ lines: string[]; path: string }>('/api/logs').then(setLogs)}>{tr('Открыть журнал', 'Open log')}</Btn>
      </div>
      {logs && (
        <Modal title={tr('Журнал', 'Log')} onClose={() => setLogs(null)} wide>
          <div className="sub mono">{logs.path}</div>
          <pre className="mono" style={{ margin: 0, fontSize: 'calc(11px * var(--fs))', maxHeight: 420, overflow: 'auto', background: 'var(--bg2)', padding: 12, borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{logs.lines.slice(-300).join('\n') || tr('Пусто', 'Empty')}</pre>
        </Modal>
      )}
    </>
  );
}
