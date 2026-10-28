// Building blocks of the settings screen: one row template (title, plain
// explanation, one control on the right), cards that group rows, and the
// controls themselves. Every change applies at once and goes through
// useSaver so the header badge can say "Saved".
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { tr } from '../../i18n';
import { Icon } from '../../components/Icon';

type SaveState = 'saved' | 'saving' | 'error';
const SaveCtx = createContext<{ state: SaveState; track: <T>(p: Promise<T>) => Promise<T> }>({ state: 'saved', track: (p) => p });
export const useSaver = () => useContext(SaveCtx).track;
export const useSaveState = () => useContext(SaveCtx).state;

export function SaverProvider({ children, onError }: { children: ReactNode; onError: (msg: string) => void }) {
  const [state, setState] = useState<SaveState>('saved');
  const pending = useRef(0);
  const track = useCallback(<T,>(p: Promise<T>) => {
    pending.current++;
    setState('saving');
    return p.then((v) => { if (--pending.current === 0) setState('saved'); return v; }, (e) => {
      pending.current--;
      setState('error');
      onError(e?.message || String(e));
      throw e;
    });
  }, [onError]);
  return <SaveCtx.Provider value={{ state, track }}>{children}</SaveCtx.Provider>;
}

export function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="set-head">
      <h2 className="h2" style={{ fontSize: 'calc(22px * var(--fs))' }}>{title}</h2>
      <div className="set-note">{note}</div>
    </div>
  );
}

export function Group({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const id = useId();
  return (
    <section className="set-card" aria-labelledby={id} data-row={title}>
      <div className="set-card-h"><h3 id={id}>{title}</h3>{action}</div>
      {children}
    </section>
  );
}

// Row: title (14px, semibold), one-line explanation (12.5px, grey), control.
// `htmlFor` ties the title to an input as its <label>.
export function Row({ title, hint, children, htmlFor, status, wide }: { title: ReactNode; hint?: ReactNode; children?: ReactNode; htmlFor?: string; status?: ReactNode; wide?: boolean }) {
  const T = htmlFor ? 'label' : 'div';
  return (
    <div className={'set-row' + (wide ? ' wide' : '')} data-row={typeof title === 'string' ? title : undefined}>
      <div className="set-row-t">
        <T className="set-row-n" {...(htmlFor ? { htmlFor } : {})}>{title}{status && <span style={{ marginLeft: 8, verticalAlign: 'middle' }}>{status}</span>}</T>
        {hint && <div className="set-row-d">{hint}</div>}
      </div>
      {children !== undefined && <div className="set-row-c">{children}</div>}
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="set-sw" onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export type Opt<V extends string> = { v: V; l: string; disabled?: boolean; title?: string };

export function Seg<V extends string>({ value, options, onChange, label }: { value: V; options: Opt<V>[]; onChange: (v: V) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = options.findIndex((o) => o.v === value);
  // Arrow keys move the choice, as in a native radio group.
  const key = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    for (let n = 1; n <= options.length; n++) {
      const j = (i + d * n + options.length) % options.length;
      if (!options[j].disabled) { onChange(options[j].v); refs.current[j]?.focus(); return; }
    }
  };
  return (
    <div role="radiogroup" aria-label={label} className="set-seg">
      {options.map((o, i) => (
        <button key={o.v} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o.v === value} disabled={o.disabled} title={o.title}
          tabIndex={i === (idx < 0 ? 0 : idx) ? 0 : -1} onKeyDown={(e) => key(e, i)} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

export function Select<V extends string>({ id, value, options, onChange, label }: { id?: string; value: V; options: Opt<V>[]; onChange: (v: V) => void; label?: string }) {
  return (
    <select id={id} className="sel set-sel" value={value} aria-label={id ? undefined : label} onChange={(e) => onChange(e.target.value as V)}>
      {options.map((o) => <option key={o.v} value={o.v} disabled={o.disabled}>{o.l}</option>)}
    </select>
  );
}

// NumField commits on blur or Enter, so typing "120" doesn't save 1 and 12.
export function NumField({ id, value, unit, min, max, step, onChange, width = 84 }: { id: string; value: number; unit?: string; min?: number; max?: number; step?: number; onChange: (v: number) => void; width?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    let n = Number(v.replace(',', '.'));
    if (!isFinite(n)) { setV(String(value)); return; }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setV(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <span className="set-num">
      <input id={id} className="inp mono" inputMode="decimal" value={v} min={min} max={max} step={step} style={{ width }}
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {unit && <span className="set-unit">{unit}</span>}
    </span>
  );
}

export function Badge({ kind, children }: { kind: 'ok' | 'warn' | 'err' | 'mut'; children: ReactNode }) {
  return <span className={'set-badge ' + kind}>{kind === 'ok' && <Icon name="check" size={12} style={{ strokeWidth: 3 }} />}{children}</span>;
}

export function Btn({ children, onClick, primary, disabled, busy, href, download }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; busy?: boolean; href?: string; download?: boolean }) {
  const cls = 'btn sm ' + (primary ? 'btn-d' : 'btn-l');
  if (href) return <a className={cls} href={href} download={download} onClick={onClick}>{children}</a>;
  return <button type="button" className={cls} onClick={onClick} disabled={disabled || busy}>{busy ? <span className="spin" /> : children}</button>;
}

export const recommended = (s: string) => `${s} ${tr('(рекомендуем)', '(recommended)')}`;
