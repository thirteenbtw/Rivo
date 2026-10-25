//! Over-the-air updates. The shell asks GitHub Releases for a newer signed
//! installer, downloads it in the background and offers to restart into it:
//! a card in the window and an item in the tray. Installing stops the media
//! server, runs the NSIS installer in passive mode and starts the new Rivo.
//!
//! The web UI has no IPC, so the card's buttons navigate to a reserved host
//! (`.invalid` never resolves) that the navigation hook hands to `on_link`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::MenuItem;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::time::sleep;

pub const LINK_HOST: &str = "rivo.invalid";

const FIRST_CHECK: Duration = Duration::from_secs(20);
const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const ITEM_IDLE: &str = "Проверить обновления";
// Turning automatic checks off leaves this file in the app config folder.
const OFF_MARKER: &str = "updates-off";

#[derive(Default)]
pub struct Updates {
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    busy: AtomicBool,
    dismissed: AtomicBool,
    item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

pub fn auto_enabled(app: &AppHandle) -> bool {
    match app.path().app_config_dir() {
        Ok(dir) => !dir.join(OFF_MARKER).exists(),
        Err(_) => true,
    }
}

pub fn set_auto(app: &AppHandle, on: bool) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let marker = dir.join(OFF_MARKER);
    if on {
        let _ = std::fs::remove_file(marker);
    } else {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(marker, b"");
    }
}

/// Tray item that reads "check" until an update is downloaded, then "install".
pub fn tray_item(app: &AppHandle) -> tauri::Result<MenuItem<tauri::Wry>> {
    let item = MenuItem::with_id(app, "update", ITEM_IDLE, true, None::<&str>)?;
    *app.state::<Updates>().item.lock().unwrap() = Some(item.clone());
    Ok(item)
}

/// Background loop: first check shortly after start, then every few hours.
/// When Rivo was started minimized at sign-in nobody is watching yet, so a
/// found update is installed right away instead of waiting to be confirmed.
pub fn spawn(app: AppHandle, minimized: bool) {
    tauri::async_runtime::spawn(async move {
        sleep(FIRST_CHECK).await;
        let mut install = minimized;
        loop {
            if auto_enabled(&app) {
                check(&app, install, false).await;
            }
            install = false;
            sleep(INTERVAL).await;
        }
    });
}

/// Tray click: install what is downloaded, or check now and say what came of it.
pub fn on_tray(app: &AppHandle) {
    if app.state::<Updates>().ready.lock().unwrap().is_some() {
        install(app);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { check(&app, false, true).await });
}

/// The window card's buttons.
pub fn on_link(app: &AppHandle, path: &str) {
    match path {
        "/install" => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || install(&app));
        }
        "/later" => app.state::<Updates>().dismissed.store(true, Ordering::Relaxed),
        _ => {}
    }
}

/// A full page load drops the card, so put it back unless it was dismissed.
pub fn on_page_load(app: &AppHandle) {
    let st = app.state::<Updates>();
    if st.dismissed.load(Ordering::Relaxed) {
        return;
    }
    let version = st.ready.lock().unwrap().as_ref().map(|(u, _)| u.version.clone());
    if let Some(v) = version {
        offer(app, &v);
    }
}

async fn check(app: &AppHandle, install_now: bool, manual: bool) {
    let st = app.state::<Updates>();
    if st.busy.swap(true, Ordering::AcqRel) {
        return;
    }
    let result = fetch(app).await;
    st.busy.store(false, Ordering::Release);
    match result {
        Ok(Some(version)) => {
            set_item(app, &format!("Установить обновление {version}"));
            st.dismissed.store(false, Ordering::Relaxed);
            if install_now {
                install(app);
            } else {
                offer(app, &version);
            }
        }
        Ok(None) if manual => toast(app, "У вас последняя версия Rivo.", false),
        Ok(None) => {}
        Err(e) if manual => toast(app, &format!("Не удалось проверить обновления: {e}"), false),
        Err(e) => eprintln!("update check: {e}"),
    }
}

/// Downloads a newer release if there is one and returns its version.
async fn fetch(app: &AppHandle) -> Result<Option<String>, String> {
    let st = app.state::<Updates>();
    let cached = st.ready.lock().unwrap().as_ref().map(|(u, _)| u.version.clone());
    if cached.is_some() {
        return Ok(cached);
    }
    let h = app.clone();
    let updater = app
        .updater_builder()
        // The installer replaces rivo-server.exe, so stop it before Rivo exits.
        .on_before_exit(move || crate::stop_server(&h))
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    set_item(app, "Загружается обновление…");
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(b) => b,
        Err(e) => {
            set_item(app, ITEM_IDLE);
            return Err(e.to_string());
        }
    };
    let version = update.version.clone();
    *st.ready.lock().unwrap() = Some((update, bytes));
    Ok(Some(version))
}

/// Runs the downloaded installer. On Windows this exits Rivo; the installer
/// starts the new version when it is done.
fn install(app: &AppHandle) {
    let Some((update, bytes)) = app.state::<Updates>().ready.lock().unwrap().take() else { return };
    toast(app, "Устанавливаем обновление, Rivo перезапустится…", false);
    if let Err(e) = update.install(bytes) {
        set_item(app, ITEM_IDLE);
        toast(app, &format!("Не удалось установить обновление: {e}"), false);
    }
}

fn set_item(app: &AppHandle, text: &str) {
    if let Some(item) = app.state::<Updates>().item.lock().unwrap().as_ref() {
        let _ = item.set_text(text);
    }
}

fn offer(app: &AppHandle, version: &str) {
    toast(app, &format!("Доступна новая версия Rivo {version}. Она уже загружена."), true);
}

const TOAST_JS: &str = r#"
(() => {
  const id = 'rivo-update-card';
  document.getElementById(id)?.remove();
  const card = document.createElement('div');
  card.id = id;
  card.setAttribute('role', 'status');
  card.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:360px;padding:14px 16px;border-radius:12px;background:#1E2547;color:#E6E9FF;font:500 13px/1.45 system-ui,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:10px';
  const text = document.createElement('div');
  text.textContent = __MSG__;
  card.append(text);
  const go = (path) => { card.remove(); location.href = 'https://__HOST__' + path; };
  const button = (label, primary, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'border:0;border-radius:8px;padding:7px 12px;font:600 13px system-ui,"Segoe UI",sans-serif;cursor:pointer;' + (primary ? 'background:#A5B4FC;color:#141A33' : 'background:transparent;color:#A5B4FC');
    b.onclick = onClick;
    return b;
  };
  if (__ACTION__) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    row.append(button('Позже', false, () => go('/later')), button('Перезапустить и обновить', true, () => go('/install')));
    card.append(row);
  } else {
    setTimeout(() => card.remove(), 7000);
  }
  (document.body || document.documentElement).append(card);
})();
"#;

fn toast(app: &AppHandle, msg: &str, action: bool) {
    let Some(w) = app.get_webview_window("main") else { return };
    let js = TOAST_JS
        .replace("__MSG__", &serde_json::to_string(msg).unwrap_or_default())
        .replace("__HOST__", LINK_HOST)
        .replace("__ACTION__", if action { "true" } else { "false" });
    let _ = w.eval(&js);
}
