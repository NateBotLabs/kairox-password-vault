use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Kairox", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Lock vault", true, None::<&str>)?;
    let sep  = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open, &lock, &sep, &quit])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Kairox Password Vault")
        .icon(app.default_window_icon().cloned().unwrap())
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "lock" => emit_lock(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click on tray icon → show window
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
    }
}

/// Tell the frontend to lock itself — the WebView will call kx_lock via
/// the VaultContext lock action.
fn emit_lock(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("kairox://lock", ());
    }
}
