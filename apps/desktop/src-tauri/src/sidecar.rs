//! MLX sidecar process manager.
//!
//! Spawns the Python sidecar (sidecar/mlx_server.py), maintains a single long-lived
//! stdio connection, multiplexes requests by id, and forwards streamed responses
//! through tauri::ipc::Channel<Value>.

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("ipc error: {0}")]
    Ipc(String),
}

type ResponseSender = mpsc::UnboundedSender<Value>;

pub struct Sidecar {
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<String, ResponseSender>>>,
    _child: Arc<Mutex<Child>>,
}

impl Sidecar {
    pub async fn spawn(app: &AppHandle) -> Result<Arc<Self>, SidecarError> {
        let (python_bin, script_path) = resolve_sidecar_paths(app);
        tracing::info!(?python_bin, ?script_path, "spawning sidecar");

        let mut cmd = Command::new(&python_bin);
        cmd.arg(&script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| SidecarError::Ipc("no stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SidecarError::Ipc("no stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| SidecarError::Ipc("no stderr".into()))?;

        let pending: Arc<Mutex<HashMap<String, ResponseSender>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let pending_for_reader = pending.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let value: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(error = %e, line, "non-json from sidecar");
                        continue;
                    }
                };
                let Some(id) = value.get("id").and_then(|v| v.as_str()).map(String::from) else {
                    tracing::warn!(?value, "sidecar response missing id");
                    continue;
                };
                let msg_type = value
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let sender_opt = {
                    let map = pending_for_reader.lock().await;
                    map.get(&id).cloned()
                };
                if let Some(sender) = sender_opt {
                    let _ = sender.send(value);
                    if msg_type == "done" || msg_type == "error" {
                        let mut map = pending_for_reader.lock().await;
                        map.remove(&id);
                    }
                } else {
                    tracing::warn!(id, msg_type, "no listener for sidecar response");
                }
            }
            tracing::warn!("sidecar stdout closed");
        });

        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                tracing::info!(target: "sidecar", "{line}");
            }
        });

        Ok(Arc::new(Self {
            stdin: Mutex::new(stdin),
            pending,
            _child: Arc::new(Mutex::new(child)),
        }))
    }

    /// Send a request and stream every response to `channel`.
    /// Returns when the sidecar emits `type: "done"` or `type: "error"` for this id.
    pub async fn send_streaming(
        &self,
        mut req: Value,
        channel: Channel<Value>,
    ) -> Result<(), SidecarError> {
        let obj = req
            .as_object_mut()
            .ok_or_else(|| SidecarError::Ipc("request must be a JSON object".into()))?;
        // Honor a caller-provided id (so abort_generation can target it);
        // otherwise generate one server-side.
        let id = match obj.get("id").and_then(|v| v.as_str()) {
            Some(existing) if !existing.is_empty() => existing.to_string(),
            _ => Uuid::new_v4().to_string(),
        };
        obj.insert("id".into(), Value::String(id.clone()));

        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        {
            let mut map = self.pending.lock().await;
            map.insert(id.clone(), tx);
        }

        let line = format!("{}\n", req);
        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await?;
        }

        while let Some(resp) = rx.recv().await {
            let is_terminal = matches!(
                resp.get("type").and_then(|v| v.as_str()),
                Some("done") | Some("error")
            );
            channel
                .send(resp)
                .map_err(|e| SidecarError::Ipc(e.to_string()))?;
            if is_terminal {
                break;
            }
        }
        Ok(())
    }
}

/// Resolve where the python interpreter and sidecar script live.
///
/// Production: bundled python-build-standalone under the app's resource_dir,
/// produced by `scripts/bundle-sidecar.sh`. We prefer this whenever it exists
/// so a packaged app never falls through to a developer's repo venv by accident.
///
/// Dev fallback: repo's `sidecar/.venv/bin/python` + `sidecar/mlx_server.py`.
/// Only used in debug builds when the bundle hasn't been generated yet.
fn resolve_sidecar_paths(app: &AppHandle) -> (PathBuf, PathBuf) {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_py = resource_dir.join("python").join("bin").join("python3");
        let bundled_script = resource_dir.join("sidecar").join("mlx_server.py");
        if bundled_py.exists() && bundled_script.exists() {
            return (bundled_py, bundled_script);
        }
    }

    #[cfg(debug_assertions)]
    {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        if let Some(repo_root) = PathBuf::from(manifest_dir)
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            let py = repo_root
                .join("sidecar")
                .join(".venv")
                .join("bin")
                .join("python");
            let script = repo_root.join("sidecar").join("mlx_server.py");
            if py.exists() && script.exists() {
                return (py, script);
            }
        }
    }

    // Last resort — return the expected bundled paths. spawn() will surface a
    // clear ENOENT and the user will see "sidecar missing — reinstall the app".
    let resource_dir = app
        .path()
        .resource_dir()
        .expect("resource dir unavailable");
    (
        resource_dir.join("python").join("bin").join("python3"),
        resource_dir.join("sidecar").join("mlx_server.py"),
    )
}

#[tauri::command]
pub async fn sidecar_send(
    state: tauri::State<'_, Arc<Sidecar>>,
    request: Value,
    channel: Channel<Value>,
) -> Result<(), String> {
    state
        .send_streaming(request, channel)
        .await
        .map_err(|e| e.to_string())
}
