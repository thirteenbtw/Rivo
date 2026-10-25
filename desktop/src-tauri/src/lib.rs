//! Desktop shell for Rivo: starts the Go media server as a sidecar,
//! shows its web UI in a native window, lives in the tray (so TVs keep
//! streaming when the window is closed) and hands magnet links to the server.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
struct Server {
    child: Mutex<Option<CommandChild>>,
    base: Mutex<Option<String>>,
    pending_magnet: Mutex<Option<String>>,
}

#[derive(Default)]
struct Updates {
    busy: AtomicBool,
    // "Later" silences the automatic prompt for that version until restart
    skipped: Mutex<Option<String>>,
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn navigate(app: &AppHandle, path: &str) {
    let base = app.state::<Server>().base.lock().unwrap().clone();
    if let (Some(base), Some(w)) = (base, app.get_webview_window("main")) {
        if let Ok(u) = url::Url::parse(&format!("{base}{path}")) {
            let _ = w.navigate(u);
        }
    }
}

/// Opens the torrents page with the magnet prefilled; the person confirms
/// there (and accepts the legal notice on first use).
fn open_magnet(app: &AppHandle, magnet: &str) {
    let ready = app.state::<Server>().base.lock().unwrap().is_some();
    if !ready {
        *app.state::<Server>().pending_magnet.lock().unwrap() = Some(magnet.to_string());
        return;
    }
    let enc: String = url::form_urlencoded::byte_serialize(magnet.as_bytes()).collect();
    navigate(app, &format!("/torrents?magnet={enc}"));
    show_main(app);
}

fn magnet_in<'a, I: IntoIterator<Item = &'a str>>(args: I) -> Option<String> {
    args.into_iter().find(|a| a.starts_with("magnet:")).map(|s| s.to_string())
}

fn splash_error(app: &AppHandle, msg: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let js = format!(
            "window.dispatchEvent(new CustomEvent('hc-error',{{detail:{}}}))",
            serde_json::to_string(msg).unwrap_or_default()
        );
        let _ = w.eval(&js);
    }
}

fn start_server(app: &AppHandle) -> Result<(), String> {
    let cmd = app
        .shell()
        .sidecar("rivo-server")
        .map_err(|e| e.to_string())?
        .args(["-exit-on-stdin-close"]);
    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;
    *app.state::<Server>().child.lock().unwrap() = Some(child);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    if let Some(url) = line.trim().strip_prefix("HOMECINEMA_READY ") {
                        *app.state::<Server>().base.lock().unwrap() = Some(url.to_string());
                        navigate(&app, "/");
                        let pending = app.state::<Server>().pending_magnet.lock().unwrap().take();
                        if let Some(m) = pending {
                            open_magnet(&app, &m);
                        }
                    }
                }
                CommandEvent::Terminated(p) => {
                    *app.state::<Server>().base.lock().unwrap() = None;
                    splash_error(
                        &app,
                        &format!("Медиасервер остановился (код {:?}). Журнал: %APPDATA%\\HomeCinema\\logs", p.code),
                    );
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

// Updates come from GitHub Releases (latest.json, signed in CI). The check
// runs shortly after start and then every few hours; installing always asks
// first, because it closes Rivo and would cut off a movie playing on a TV.
const UPDATE_FIRST: Duration = Duration::from_secs(30);
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

fn info(app: &AppHandle, msg: &str) {
    app.dialog().message(msg).title("Обновление Rivo").show(|_| {});
}

fn tray_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(text));
    }
}

fn spawn_update_checks(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(UPDATE_FIRST);
        loop {
            tauri::async_runtime::block_on(check_for_update(app.clone(), false));
            std::thread::sleep(UPDATE_EVERY);
        }
    });
}

async fn check_for_update(app: AppHandle, manual: bool) {
    if app.state::<Updates>().busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let found = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    match found {
        Ok(Some(update)) => {
            let skipped = app.state::<Updates>().skipped.lock().unwrap().clone();
            if manual || skipped.as_deref() != Some(update.version.as_str()) {
                ask_to_update(&app, update);
                return; // busy until the person answers
            }
        }
        Ok(None) if manual => info(&app, &format!("У вас последняя версия Rivo ({}).", app.package_info().version)),
        Err(e) if manual => info(&app, &format!("Не удалось проверить обновления: {e}")),
        _ => {}
    }
    app.state::<Updates>().busy.store(false, Ordering::SeqCst);
}

fn ask_to_update(app: &AppHandle, update: Update) {
    let text = format!(
        "Вышла новая версия Rivo {} (у вас {}).\n\nУстановить сейчас? Rivo закроется примерно на минуту и откроется снова. Настройки и библиотека сохранятся.",
        update.version, update.current_version
    );
    let h = app.clone();
    app.dialog()
        .message(text)
        .title("Обновление Rivo")
        .buttons(MessageDialogButtons::OkCancelCustom("Обновить".into(), "Позже".into()))
        .show(move |ok| {
            if ok {
                tauri::async_runtime::spawn(install_update(h, update));
            } else {
                *h.state::<Updates>().skipped.lock().unwrap() = Some(update.version.clone());
                h.state::<Updates>().busy.store(false, Ordering::SeqCst);
            }
        });
}

async fn install_update(app: AppHandle, update: Update) {
    let mut got = 0usize;
    let progress = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                got += chunk;
                if let Some(total) = total.filter(|t| *t > 0) {
                    tray_tooltip(&progress, &format!("Rivo — загрузка обновления {}%", got as u64 * 100 / total));
                }
            },
            || {},
        )
        .await;
    tray_tooltip(&app, "Rivo");
    let bytes = match bytes {
        Ok(b) => b,
        Err(e) => {
            info(&app, &format!("Не удалось скачать обновление: {e}"));
            app.state::<Updates>().busy.store(false, Ordering::SeqCst);
            return;
        }
    };
    // The installer replaces rivo-server.exe, so the server has to let go of it.
    if let Some(child) = app.state::<Server>().child.lock().unwrap().take() {
        let _ = child.kill();
    }
    // On Windows this starts the installer and exits; it reopens Rivo when done.
    if let Err(e) = update.install(bytes) {
        info(&app, &format!("Не удалось установить обновление: {e}"));
        app.state::<Updates>().busy.store(false, Ordering::SeqCst);
        if let Err(e) = start_server(&app) {
            splash_error(&app, &format!("Не удалось запустить медиасервер: {e}"));
        }
        return;
    }
    app.restart();
}

// External links (TMDB, IMDb…) open in the system browser. A link with
// target="_blank" or window.open() asks the webview for a new window, which
// the shell does not create, so the init script turns those into a plain
// navigation and the navigation hook hands any off-site URL to the browser.
const EXTERNAL_LINKS_JS: &str = r#"
(() => {
  const external = (href) => { try { const u = new URL(href, location.href); return /^https?:$/.test(u.protocol) && u.origin !== location.origin ? u.href : null; } catch { return null; } };
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element && e.target.closest('a[href]');
    const url = a && external(a.getAttribute('href'));
    if (!url || e.defaultPrevented || e.button !== 0) return;
    e.preventDefault();
    location.href = url;
  }, true);
  const open = window.open;
  window.open = (href, ...rest) => { const url = href && external(String(href)); if (url) { location.href = url; return null; } return open.call(window, href, ...rest); };
})();
"#;

fn external_links<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("external-links")
        .js_init_script(EXTERNAL_LINKS_JS)
        .on_navigation(|_webview, url| {
            let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost")) || !matches!(url.scheme(), "http" | "https");
            if !local {
                #[allow(deprecated)]
                let _ = tauri_plugin_shell::open::open(None, url.as_str(), None);
            }
            local
        })
        .build()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(external_links())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(m) = magnet_in(argv.iter().map(|s| s.as_str())) {
                open_magnet(app, &m);
            } else {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Server::default())
        .manage(Updates::default())
        .setup(|app| {
            let handle = app.handle().clone();

            // Magnet links: first launch, and links opened while running.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let Some(m) = magnet_in(urls.iter().map(|u| u.as_str())) {
                    *app.state::<Server>().pending_magnet.lock().unwrap() = Some(m);
                }
            }
            let h = handle.clone();
            app.deep_link().on_open_url(move |ev| {
                if let Some(m) = magnet_in(ev.urls().iter().map(|u| u.as_str())) {
                    open_magnet(&h, &m);
                }
            });

            // Tray: the server keeps running for TVs when the window is closed.
            let open = MenuItem::with_id(app, "open", "Открыть Rivo", true, None::<&str>)?;
            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart = CheckMenuItem::with_id(app, "autostart", "Запускать вместе с Windows", true, autostart_on, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "Проверить обновления", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &autostart, &update, &PredefinedMenuItem::separator(app)?, &quit])?;
            let autostart_item = autostart.clone();
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("Rivo")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, ev| match ev.id().as_ref() {
                    "open" => show_main(app),
                    "autostart" => {
                        let al = app.autolaunch();
                        let on = al.is_enabled().unwrap_or(false);
                        let _ = if on { al.disable() } else { al.enable() };
                        let _ = autostart_item.set_checked(al.is_enabled().unwrap_or(false));
                    }
                    "update" => {
                        tauri::async_runtime::spawn(check_for_update(app.clone(), true));
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            if let Err(e) = start_server(&handle) {
                splash_error(&handle, &format!("Не удалось запустить медиасервер: {e}"));
            }
            spawn_update_checks(&handle);
            Ok(())
        })
        .on_window_event(|window, ev| {
            if let WindowEvent::CloseRequested { api, .. } = ev {
                // Hide to tray: casting to a TV continues in the background.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Rivo")
        .run(|app, ev| {
            if let RunEvent::Exit = ev {
                if let Some(child) = app.state::<Server>().child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
