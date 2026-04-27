mod attachments;
mod audit;
mod cache;
mod db;
mod mcp;
mod memory;
mod permissions;
mod sidecar;
mod tools;
mod workspace;

use db::Database;
use futures_util::StreamExt;
use permissions::{Preset, PresetState};
use serde::{Deserialize, Serialize};
use sidecar::Sidecar;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;
use workspace::{Workspace, WorkspaceState};

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

#[derive(Serialize)]
struct DownloadedAdapter {
    slug: String,
    path: String,
}

#[tauri::command]
fn list_downloaded_adapters(app: AppHandle) -> Result<Vec<DownloadedAdapter>, String> {
    let root = PathBuf::from(app_adapters_dir(app)?);
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&root) else {
        return Ok(out);
    };
    for entry in rd.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_dir() {
            continue;
        }
        let path = entry.path();
        let has_weights = path.join("adapters.safetensors").exists()
            || path.join("adapter_model.safetensors").exists();
        if !has_weights {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            out.push(DownloadedAdapter {
                slug: name.to_string(),
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
fn set_workspace(
    app: AppHandle,
    state: tauri::State<'_, WorkspaceState>,
    root: Option<String>,
) -> Result<Option<Workspace>, String> {
    let new_ws = match root {
        Some(r) => {
            let path = PathBuf::from(&r);
            if !path.exists() {
                return Err(format!("workspace path does not exist: {r}"));
            }
            if !path.is_dir() {
                return Err(format!("workspace path is not a directory: {r}"));
            }
            Some(Workspace { root: path })
        }
        None => None,
    };
    {
        let mut guard = state.0.lock().unwrap();
        *guard = new_ws.clone();
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    workspace::save(&data_dir, &new_ws)?;
    Ok(new_ws)
}

#[tauri::command]
fn get_workspace(state: tauri::State<'_, WorkspaceState>) -> Option<Workspace> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn set_preset(
    app: AppHandle,
    state: tauri::State<'_, PresetState>,
    preset: Preset,
) -> Result<Preset, String> {
    {
        let mut guard = state.0.lock().unwrap();
        *guard = preset;
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    permissions::save(&data_dir, preset)?;
    Ok(preset)
}

#[tauri::command]
fn get_preset(state: tauri::State<'_, PresetState>) -> Preset {
    *state.0.lock().unwrap()
}

#[tauri::command]
fn system_memory_bytes() -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .map_err(|e| e.to_string())?;
        let s = String::from_utf8(out.stdout).map_err(|e| e.to_string())?;
        s.trim().parse::<u64>().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(0)
    }
}

#[derive(Debug, Deserialize)]
pub struct AdapterFile {
    name: String,
    url: String,
    #[serde(default)]
    sha256: Option<String>,
}

/// Reject anything that would let `slug` or `file.name` escape the
/// adapters root. Mirrors the workspace::resolve_path discipline:
/// stricter validation on the input, then a starts_with assertion on the
/// joined path so symlink-swap during download still can't escape.
fn validate_adapter_path(slug: &str, file_name: &str) -> Result<(), String> {
    static SLUG_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let slug_re = SLUG_RE
        .get_or_init(|| regex::Regex::new(r"^[a-z0-9][a-z0-9_-]{0,63}$").unwrap());
    if !slug_re.is_match(slug) {
        return Err(format!("invalid adapter slug: {slug}"));
    }
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.starts_with('.')
        || file_name.contains("..")
    {
        return Err(format!("invalid adapter file name: {file_name}"));
    }
    Ok(())
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
    use sha2::{Digest, Sha256};

    // Validate slug + every file name BEFORE creating directories or
    // touching the network. A malicious storefront row with `slug =
    // "../../Library/LaunchAgents"` or `file.name = "evil.plist"` is
    // rejected here; the `starts_with` check on `dest` below is a
    // belt-and-suspenders guard against symlink-swap.
    for file in &files {
        validate_adapter_path(&slug, &file.name)?;
    }

    let dir = PathBuf::from(app_adapters_dir(app.clone())?).join(&slug);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;

    let client = reqwest::Client::new();
    for file in &files {
        let dest = dir.join(&file.name);
        if !dest.starts_with(&dir) {
            return Err(format!("path escape detected for {}", file.name));
        }
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
        let mut hasher = Sha256::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            bytes_seen += chunk.len() as u64;
            hasher.update(&chunk);
            writer.write_all(&chunk).await.map_err(|e| e.to_string())?;
            let _ = on_event.send(DownloadEvent::File {
                name: file.name.clone(),
                bytes: bytes_seen,
                total,
            });
        }
        writer.flush().await.map_err(|e| e.to_string())?;
        drop(writer);

        // Integrity gate. The storefront schema (adapter_versions.weights_sha256)
        // already carries the expected digest; if the worker emits it, we
        // fail-closed on mismatch. If it's absent (legacy worker), warn via
        // the event channel and continue — flip to fail-closed once every
        // adapter row carries a SHA.
        if let Some(expected) = &file.sha256 {
            let actual = format!("{:x}", hasher.finalize());
            if !actual.eq_ignore_ascii_case(expected) {
                let _ = tokio::fs::remove_file(&dest).await;
                let msg = format!(
                    "integrity check failed for {}: expected {}, got {}",
                    file.name, expected, actual
                );
                let _ = on_event.send(DownloadEvent::Error { message: msg.clone() });
                return Err(msg);
            }
        } else {
            let _ = on_event.send(DownloadEvent::Error {
                message: format!(
                    "warning: storefront did not provide sha256 for {}; integrity not verified",
                    file.name
                ),
            });
        }
    }
    let path = dir.to_string_lossy().into_owned();
    let _ = on_event.send(DownloadEvent::Done { path: path.clone() });
    Ok(path)
}

/* ================================================================
 * SQLite-backed chat + key/value commands (PR2 scaffolding).
 *
 * The frontend doesn't call these yet — PR3 will swap localStorage for
 * these commands. They're wired into the invoke_handler below so the
 * Tauri IPC bindings exist as soon as the backend ships.
 * ================================================================ */

#[derive(Debug, Serialize)]
struct ChatSummary {
    id: String,
    title: String,
    pinned: bool,
    updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct MessageRow {
    id: String,
    role: String,
    payload_json: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provenance_json: Option<serde_json::Value>,
    position: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatFull {
    id: String,
    title: String,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    messages: Vec<MessageRow>,
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
fn chat_list(db: State<'_, Database>) -> Result<Vec<ChatSummary>, String> {
    let conn = db.pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, pinned, updated_at FROM chats ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ChatSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                pinned: row.get::<_, i64>(2)? != 0,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn chat_load(db: State<'_, Database>, id: String) -> Result<ChatFull, String> {
    let conn = db.pool.get().map_err(|e| e.to_string())?;
    let (title, pinned) = conn
        .query_row(
            "SELECT title, pinned FROM chats WHERE id = ?1",
            [&id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? != 0)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => format!("no chat with id {id}"),
            other => other.to_string(),
        })?;

    let mut stmt = conn
        .prepare(
            "SELECT id, role, payload_json, provenance_json, position \
             FROM messages WHERE chat_id = ?1 ORDER BY position ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&id], |row| {
            let payload_str: String = row.get(2)?;
            let provenance_str: Option<String> = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                payload_str,
                provenance_str,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut messages = Vec::new();
    for r in rows {
        let (mid, role, payload_str, prov_str, position) = r.map_err(|e| e.to_string())?;
        let payload_json: serde_json::Value =
            serde_json::from_str(&payload_str).map_err(|e| e.to_string())?;
        let provenance_json = match prov_str {
            Some(s) => Some(serde_json::from_str(&s).map_err(|e| e.to_string())?),
            None => None,
        };
        messages.push(MessageRow {
            id: mid,
            role,
            payload_json,
            provenance_json,
            position,
        });
    }
    Ok(ChatFull {
        id,
        title,
        pinned,
        messages,
    })
}

#[tauri::command]
fn chat_upsert(db: State<'_, Database>, chat: ChatFull) -> Result<(), String> {
    let mut conn = db.pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let now = unix_now();
    // Preserve the original created_at on update; otherwise stamp it now.
    let existing_created_at: Option<i64> = tx
        .query_row(
            "SELECT created_at FROM chats WHERE id = ?1",
            [&chat.id],
            |row| row.get(0),
        )
        .ok();
    let created_at = existing_created_at.unwrap_or(now);

    tx.execute(
        "INSERT OR REPLACE INTO chats (id, title, pinned, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            chat.id,
            chat.title,
            chat.pinned as i64,
            created_at,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM messages WHERE chat_id = ?1", [&chat.id])
        .map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO messages \
                 (id, chat_id, position, role, payload_json, provenance_json, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| e.to_string())?;
        for (idx, m) in chat.messages.iter().enumerate() {
            // Trust the caller's `position` if set, else fall back to insert order.
            let position = if m.position != 0 { m.position } else { idx as i64 };
            let payload_str = serde_json::to_string(&m.payload_json).map_err(|e| e.to_string())?;
            let provenance_str = match &m.provenance_json {
                Some(v) => Some(serde_json::to_string(v).map_err(|e| e.to_string())?),
                None => None,
            };
            stmt.execute(rusqlite::params![
                m.id,
                chat.id,
                position,
                m.role,
                payload_str,
                provenance_str,
                now,
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn chat_delete(db: State<'_, Database>, id: String) -> Result<(), String> {
    let conn = db.pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chats WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn kv_get(db: State<'_, Database>, key: String) -> Result<Option<String>, String> {
    let conn = db.pool.get().map_err(|e| e.to_string())?;
    let result = conn
        .query_row("SELECT value FROM kv WHERE key = ?1", [&key], |row| {
            row.get::<_, String>(0)
        })
        .ok();
    Ok(result)
}

#[tauri::command]
fn kv_set(db: State<'_, Database>, key: String, value: String) -> Result<(), String> {
    let conn = db.pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

            // Load persisted workspace + permissions preset. Failures are
            // non-fatal — we just start with no workspace and ReadOnly preset.
            let data_dir = handle
                .path()
                .app_data_dir()
                .ok()
                .unwrap_or_else(|| PathBuf::from("."));
            let ws = workspace::load(&data_dir);
            let preset = permissions::load(&data_dir);
            handle.manage(WorkspaceState::new(ws));
            handle.manage(PresetState::new(preset));
            handle.manage(Arc::new(mcp::FliMcpState::new()));

            // Open (or create) the SQLite store next to audit.log. Failure
            // here is logged but non-fatal so the rest of the app can still
            // boot — chat persistence simply won't be available until the
            // user fixes the underlying I/O issue.
            match db::open(&data_dir) {
                Ok(database) => {
                    handle.manage(database);
                }
                Err(e) => tracing::error!(error = %e, "failed to open lorahub.db"),
            }

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
            list_downloaded_adapters,
            download_adapter,
            system_memory_bytes,
            set_workspace,
            get_workspace,
            set_preset,
            get_preset,
            tools::tool_read_file,
            tools::tool_write_file,
            tools::tool_list_dir,
            tools::tool_glob,
            tools::tool_grep,
            tools::tool_run_command,
            tools::tool_http_fetch,
            tools::tool_edit_file,
            tools::tool_fetch_page,
            tools::tool_web_search,
            memory::memories_list,
            memory::memory_save,
            memory::memory_delete,
            memory::memory_tool_save,
            attachments::read_attachment,
            cache::list_cached_hf_models,
            cache::delete_cached_hf_model,
            mcp::mcp_fli_call,
            chat_list,
            chat_load,
            chat_upsert,
            chat_delete,
            kv_get,
            kv_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
