mod sidecar;

use sidecar::Sidecar;
use std::sync::Arc;
use tauri::Manager;

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
        .invoke_handler(tauri::generate_handler![sidecar::sidecar_send])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
