mod sidecar;

use sidecar::Sidecar;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
fn app_adapters_dir(app: AppHandle) -> Result<String, String> {
    let dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("adapters");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,desktop_lib=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                match Sidecar::spawn(&handle).await {
                    Ok(sc) => {
                        handle.manage::<Arc<Sidecar>>(sc);
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "failed to spawn sidecar");
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar::sidecar_send,
            app_adapters_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
