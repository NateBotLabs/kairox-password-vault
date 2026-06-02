mod commands;
mod state;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::new())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // System tray — ignore errors (e.g. on Linux without system tray support)
            if let Err(e) = tray::setup(app.handle()) {
                eprintln!("tray setup failed (non-fatal): {e}");
            }

            // Close-to-tray: hide the window instead of quitting when the user
            // clicks the window's close button.
            #[cfg(not(target_os = "macos"))]
            if let Some(win) = app.get_webview_window("main") {
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::kx_derive,
            commands::kx_lock,
            commands::kx_generate_salt,
            commands::kx_generate_collection_key,
            commands::kx_load_collection_key,
            commands::kx_encrypt_entry,
            commands::kx_decrypt_entry,
            commands::kx_wrap_collection_key_for,
            commands::kx_encrypt,
            commands::kx_decrypt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kairox");
}
