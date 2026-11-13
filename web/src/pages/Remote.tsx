import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fmtTime } from '../api';
import { useApp } from '../state';
import { tr } from '../i18n';
import { Icon, PauseGlyph, PlayGlyph } from '../components/Icon';
import { screenId, sendRemote, type RemoteCmd, type Screen } from '../remote';

// What the screen shows, in words.
function pageLabel(path: string): string {
  const p = path.split('?')[0];
  if (p === '/') return tr('Главная', 'Home');
  if (p.startsWith('/play')) return tr('Плеер', 'Player');
  if (p.startsWith('/search')) return tr('Поиск', 'Search');
  if (p.startsWith('/library/movies')) return tr('Фильмы', 'Movies');
  if (p.startsWith('/library/shows')) return tr('Сериалы', 'Shows');
  if (p.startsWith('/movie') || p.startsWith('/show') || p.startsWith('/catalog/')) return tr('Страница фильма', 'Title page');
  if (p.startsWith('/torrents')) return tr('Торренты', 'Torrents');
  if (p.startsWith('/settings')) return tr('Настройки', 'Settings');
  if (p.startsWith('/person') || p.startsWith('/people')) return tr('Актёры', 'People');
  return '';
}

// Remote: the phone drives Rivo open on the TV (or on a PC).
export default function RemotePage() {
  const { screens } = useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const others = screens.filter((s) => s.id !== screenId());
  const tvFirst = [...others].sort((a, b) => Number(b.tv) - Number(a.tv));
  const sel = others.find((s) => s.id === id) || (id ? undefined : tvFirst[0]);
  const lost = !!id && !sel;

  return (
    <main className="main pad" style={{ maxWidth: 560 }}>
      <div>
        <h1 className="h1">{tr('Пульт', 'Remote')}</h1>
        <div className="sub">{tr('Управление Rivo на телевизоре или другом устройстве', 'Control Rivo on the TV or another device')}</div>
      </div>
      {others.length > 1 && (
        <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tvFirst.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === sel?.id} className={'pill' + (s.id === sel?.id ? ' on' : '')} onClick={() => nav(`/remote/${s.id}`, { replace: true })}>
              <Icon name={s.tv ? 'tv' : 'film'} size={16} />{s.name}
            </button>
          ))}
        </div>
      )}
      {sel ? <Pad s={sel} /> : (
        <div className="empty">
          <Icon name="tv" size={28} />
          {lost ? tr('Это устройство отключилось. Откройте Rivo на нём снова.', 'This device went away. Open Rivo on it again.')
            : tr('Откройте Rivo на телевизоре: в приложении Rivo TV или в браузере ТВ по адресу сервера. Он появится здесь сам.', 'Open Rivo on the TV, in the Rivo TV app or the TV browser. It shows up here by itself.')}
        </div>
      )}
    </main>
  );
}

function Pad({ s }: { s: Screen }) {
  const { toast } = useApp();
  const st = s.state;
  const p = st?.player || null;
  const [text, setText] = useState('');
  const [seekPos, setSeekPos] = useState<number | null>(null);
  const send = (c: RemoteCmd) => {
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
    sendRemote(s.id, c).catch((e: any) => toast(e.message));
  };
  const key = (k: string) => send({ cmd: 'key', key: k });
  const seekEnd = () => {
    if (seekPos === null) return;
    send({ cmd: 'seek', to: seekPos });
    window.setTimeout(() => setSeekPos(null), 1500);
  };
  const pos = seekPos ?? p?.position ?? 0;
  const pct = p?.duration ? Math.min(1, pos / p.duration) : 0;
  const where = st ? (p ? '' : pageLabel(st.path)) : '';

  return (
    <section aria-label={`${tr('Пульт', 'Remote')}: ${s.name}`} style={{ borderRadius: 24, background: 'var(--bg2)', border: '1px solid var(--line)', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'calc(13px * var(--fs))', color: 'var(--mut2)' }}>
        <Icon name={s.tv ? 'tv' : 'film'} size={16} />
        <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{s.name}</span>
        {where && <span>· {where}</span>}
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 'calc(11px * var(--fs))', color: 'var(--mut)' }}>{s.addr}</span>
      </div>

      {p && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="disp" style={{ fontSize: `calc(${p.title.length > 30 ? 20 : 24}px * var(--fs))`, fontWeight: 600, lineHeight: 1.1, overflowWrap: 'anywhere' }}>{p.title || tr('Загрузка…', 'Loading…')}</span>
            {p.info && <span style={{ fontSize: 'calc(12px * var(--fs))', color: 'var(--mut)' }}>{p.info}</span>}
            {p.error && <span style={{ fontSize: 'calc(12px * var(--fs))', color: 'var(--err-fg)' }}>{p.error}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="range" className="rng" min={0} max={Math.max(1, p.duration)} value={Math.round(pos)} aria-label={tr('Позиция', 'Position')} aria-valuetext={fmtTime(pos)}
              onChange={(e) => setSeekPos(Number(e.target.value))} onPointerUp={seekEnd} onKeyUp={seekEnd} onTouchEnd={seekEnd}
              style={{ width: '100%', background: `linear-gradient(90deg,var(--acc) ${pct * 100}%,var(--line2) ${pct * 100}%)` }} />
            <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'calc(11px * var(--fs))', color: 'var(--mut)' }}>
              <span>{fmtTime(pos)}</span>
              {p.waiting && !p.paused && <span className="spin" style={{ ['--s' as string]: '12px' }} />}
              <span>{fmtTime(p.duration)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
            <button className="rb" aria-label={tr('Назад 10 секунд', 'Back 10 seconds')} onClick={() => send({ cmd: 'seekBy', by: -10 })}><Icon name="back10" /></button>
            <button className="rb" aria-label={p.paused ? tr('Продолжить', 'Play') : tr('Пауза', 'Pause')} onClick={() => send({ cmd: p.paused ? 'play' : 'pause' })} style={{ width: 72, height: 72, background: 'var(--fg)', color: 'var(--bg)' }}>{p.paused ? <PlayGlyph size={24} /> : <PauseGlyph size={26} />}</button>
            <button className="rb" aria-label={tr('Вперёд 10 секунд', 'Forward 10 seconds')} onClick={() => send({ cmd: 'seekBy', by: 10 })}><Icon name="fwd10" /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="rb" aria-label={p.muted ? tr('Включить звук', 'Unmute') : tr('Выключить звук', 'Mute')} style={{ width: 44, height: 44 }} onClick={() => send({ cmd: 'mute', on: !p.muted })}><Icon name={p.muted ? 'mute' : 'volume'} size={18} /></button>
            <button className="rb" aria-label={tr('Тише', 'Volume down')} style={{ width: 44, height: 44 }} onClick={() => send({ cmd: 'volume', level: Math.max(0, p.volume - 0.1) })}>−</button>
            <div aria-hidden="true" style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--chip)' }}><div style={{ width: `${p.muted ? 0 : Math.round(p.volume * 100)}%`, height: 4, borderRadius: 2, background: 'var(--fg)' }} /></div>
            <button className="rb" aria-label={tr('Громче', 'Volume up')} style={{ width: 44, height: 44 }} onClick={() => send({ cmd: 'volume', level: Math.min(1, p.volume + 0.1) })}>+</button>
          </div>
          {(p.audio.length > 1 || p.subs.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'calc(11px * var(--fs))', color: 'var(--mut)' }}>{tr('Озвучка', 'Audio')}
                <select className="sel" value={p.audioSel} disabled={p.audio.length < 2} onChange={(e) => send({ cmd: 'audio', index: Number(e.target.value) })}>
                  {p.audio.map((a) => <option key={a.index} value={a.index}>{a.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'calc(11px * var(--fs))', color: 'var(--mut)' }}>{tr('Субтитры', 'Subtitles')}
                <select className="sel" value={p.subSel} onChange={(e) => send({ cmd: 'sub', index: Number(e.target.value) })}>
                  <option value={-1}>{tr('Выкл.', 'Off')}</option>
                  {p.subs.map((t) => <option key={t.index} value={t.index}>{t.label}</option>)}
                </select>
              </label>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {p.hasNext && <button className="btn btn-l sm" onClick={() => send({ cmd: 'next' })}><Icon name="next" size={16} />{tr('Следующая серия', 'Next episode')}</button>}
            <button className="btn btn-l sm" onClick={() => send({ cmd: 'close' })}><Icon name="close" size={16} />{tr('Закрыть плеер', 'Close player')}</button>
          </div>
        </div>
      )}

      <DPad onKey={key} />

      <form onSubmit={(e) => { e.preventDefault(); send({ cmd: 'text', value: text, submit: true }); setText(''); }} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label className="fld" style={{ flex: 1 }}>{st?.typing ? tr('Текст в поле на экране', 'Text for the field on screen') : tr('Найти на экране', 'Search on screen')}
          <input className="inp" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="send" autoComplete="off"
            placeholder={st?.typing ? tr('Введите текст', 'Type here') : tr('Название фильма', 'Title')} />
        </label>
        <button className="btn btn-d" style={{ height: 40 }} disabled={!text.trim()} aria-label={tr('Отправить на экран', 'Send to screen')}><Icon name="keyboard" size={18} /></button>
      </form>
    </section>
  );
}

// Arrows repeat while held, like on a real remote.
function Hold({ label, onPress, children, style }: { label: string; onPress: () => void; children: ReactNode; style?: CSSProperties }) {
  const t = useRef<number>();
  const stop = () => { window.clearTimeout(t.current); window.clearInterval(t.current); t.current = undefined; };
  useEffect(() => stop, []);
  return (
    <button type="button" className="rb" aria-label={label} style={{ width: 64, height: 64, touchAction: 'manipulation', ...style }}
      onPointerDown={(e) => { if (e.button !== 0) return; onPress(); stop(); t.current = window.setTimeout(() => { t.current = window.setInterval(onPress, 140); }, 450); }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onClick={(e) => { if (e.detail === 0) onPress(); }} // keyboard
      onContextMenu={(e) => e.preventDefault()}>
      {children}
    </button>
  );
}

function DPad({ onKey }: { onKey: (k: string) => void }) {
  const arrow = (rot: number) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${rot}deg)` }}><path d="M6 15l6-6 6 6" /></svg>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,64px)', gridTemplateRows: 'repeat(3,64px)', gap: 6, padding: 10, borderRadius: '50%', background: 'var(--chip)' }}>
        <span />
        <Hold label={tr('Вверх', 'Up')} onPress={() => onKey('ArrowUp')} style={{ background: 'transparent' }}>{arrow(0)}</Hold>
        <span />
        <Hold label={tr('Влево', 'Left')} onPress={() => onKey('ArrowLeft')} style={{ background: 'transparent' }}>{arrow(-90)}</Hold>
        <button type="button" className="rb" aria-label="OK" onClick={() => onKey('Enter')} style={{ width: 64, height: 64, background: 'var(--fg)', color: 'var(--bg)', fontWeight: 700 }}>OK</button>
        <Hold label={tr('Вправо', 'Right')} onPress={() => onKey('ArrowRight')} style={{ background: 'transparent' }}>{arrow(90)}</Hold>
        <span />
        <Hold label={tr('Вниз', 'Down')} onPress={() => onKey('ArrowDown')} style={{ background: 'transparent' }}>{arrow(180)}</Hold>
        <span />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="btn btn-l sm" onClick={() => onKey('GoBack')}><Icon name="left" size={16} />{tr('Назад', 'Back')}</button>
        <button type="button" className="btn btn-l sm" onClick={() => onKey('Home')}><Icon name="home" size={16} />{tr('Домой', 'Home')}</button>
        <button type="button" className="btn btn-l sm" aria-label={tr('Пауза / продолжить', 'Play / pause')} onClick={() => onKey('MediaPlayPause')}><PlayGlyph size={12} /><PauseGlyph size={12} /></button>
      </div>
    </div>
  );
}
