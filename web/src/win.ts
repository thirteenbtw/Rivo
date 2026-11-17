// The Windows shell draws no system title bar: the window's own controls
// (minimize, maximize, close) live in the app's title bar instead. These
// helpers talk to the shell's window API; in a plain browser, on a phone or
// on a TV there is no shell, and the controls are not shown.

type Internals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = (): Internals | undefined => (window as any).__TAURI_INTERNALS__;

export const inShell = (): boolean => typeof internals()?.invoke === 'function';

function call<T = void>(cmd: string): Promise<T> {
  const i = internals();
  if (!i) return Promise.reject(new Error('no shell'));
  return i.invoke('plugin:window|' + cmd) as Promise<T>;
}

export const minimize = () => call('minimize').catch(() => {});
export const toggleMaximize = () => call('toggle_maximize').catch(() => {});
// Closing hides the window to the tray: the server keeps streaming to TVs.
export const closeWindow = () => call('close').catch(() => {});
export const isMaximized = () => call<boolean>('is_maximized').catch(() => false);
