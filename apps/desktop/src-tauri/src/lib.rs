mod sidecar;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sidecar::Sidecar;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

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

#[derive(Debug, Deserialize)]
pub struct AdapterFile {
    name: String,
    url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
enum DownloadEvent {
    File {
        name: String,
        bytes: u64,
        total: Option<u64>,
    },
    Done {
        path: String,
    },
    Error {
        message: String,
    },
}

#[tauri::command]
async fn download_adapter(
    app: AppHandle,
    slug: String,
    files: Vec<AdapterFile>,
    on_event: Channel<DownloadEvent>,
) -> Result<String, String> {
    let dir = PathBuf::from(app_adapters_dir(app.clone())?).join(&slug);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;

    let client = reqwest::Client::new();
    for file in &files {
        let dest = dir.join(&file.name);
        tracing::info!(slug, file = %file.name, "downloading {}", file.url);
        let resp = client
            .get(&file.url)
            .send()
            .await
            .map_err(|e| {
                let msg = format!("GET {} failed: {}", file.url, e);
                let _ = on_event.send(DownloadEvent::Error { message: msg.clone() });
                msg
            })?;
        if !resp.status().is_success() {
            let msg = format!("GET {} returned {}", file.url, resp.status());
            let _ = on_event.send(DownloadEvent::Error { message: msg.clone() });
            return Err(msg);
        }
        let total = resp.content_length();
        let mut bytes_seen: u64 = 0;
        let mut stream = resp.bytes_stream();
        let mut writer = tokio::fs::File::create(&dest)
            .await
            .map_err(|e| e.to_string())?;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            bytes_seen += chunk.len() as u64;
            writer.write_all(&chunk).await.map_err(|e| e.to_string())?;
            let _ = on_event.send(DownloadEvent::File {
                name: file.name.clone(),
                bytes: bytes_seen,
                total,
            });
        }
        writer.flush().await.map_err(|e| e.to_string())?;
    }
    let path = dir.to_string_lossy().into_owned();
    let _ = on_event.send(DownloadEvent::Done { path: path.clone() });
    Ok(path)
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
            app_adapters_dir,
            download_adapter
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
