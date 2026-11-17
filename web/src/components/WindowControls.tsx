import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { closeWindow, inShell, isMaximized, minimize, toggleMaximize } from '../win';

// Minimize, maximize / restore and close, drawn by the app so they belong to
// the Rivo title bar. Each button runs the full height of the bar and reaches
// the window edge, so a maximized window closes from the very corner; the
// visible chip inside is rounded like the rest of the bar, and close turns red.
export function WindowControls({ dark = false }: { dark?: boolean }) {
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!inShell()) return;
    const sync = () => { isMaximized().then(setMax); };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  if (!inShell()) return null;
  return (
    <div className={'wc' + (dark ? ' wc-dark' : '')} role="group" aria-label={tr('Окно', 'Window')} data-tauri-drag-region="false">
      <button className="wc-b" tabIndex={-1} onClick={minimize} aria-label={tr('Свернуть', 'Minimize')} title={tr('Свернуть', 'Minimize')}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5h8" /></svg>
      </button>
      <button className="wc-b" tabIndex={-1} onClick={toggleMaximize} aria-label={max ? tr('Восстановить', 'Restore') : tr('Развернуть', 'Maximize')} title={max ? tr('Восстановить', 'Restore') : tr('Развернуть', 'Maximize')}>
        {max
          ? <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="4" width="6" height="6" rx="1.4" /><path d="M4.5 2.2h3.8a1.5 1.5 0 0 1 1.5 1.5v3.8" /></svg>
          : <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.8" /></svg>}
      </button>
      <button className="wc-b wc-x" tabIndex={-1} onClick={closeWindow} aria-label={tr('Закрыть', 'Close')} title={tr('Закрыть (Rivo останется в трее)', 'Close (Rivo stays in the tray)')}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
      </button>
    </div>
  );
}

// Over the player the title bar is gone, so the controls float in the top
// right corner and come and go with the mouse like the player's own bars. The
// player's top bar doubles as the caption: drag it to move the window.
export function PlayerWindowControls() {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (!inShell()) return;
    document.querySelector('.player > header')?.setAttribute('data-tauri-drag-region', '');
    let id = 0;
    const wake = (e?: MouseEvent) => {
      setShown(true);
      window.clearTimeout(id);
      // Keep them up while the pointer is near the top edge.
      if (!e || e.clientY > 90) id = window.setTimeout(() => setShown(false), 2600);
    };
    wake();
    document.addEventListener('mousemove', wake);
    return () => { window.clearTimeout(id); document.removeEventListener('mousemove', wake); };
  }, []);
  if (!inShell()) return null;
  return <div className={'wc-float' + (shown ? '' : ' off')}><WindowControls dark /></div>;
}

// A bare, invisible caption for screens that have no title bar (first-run
// setup, sign-in, loading): drag anywhere along the top, buttons on the right.
export function WindowCaption() {
  if (!inShell()) return null;
  return <div className="wc-cap" data-tauri-drag-region=""><WindowControls /></div>;
}
