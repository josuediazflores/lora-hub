//! MCP (Model Context Protocol) subprocess client.
//!
//! Spawns an MCP server (e.g. `fli-mcp`), keeps a long-lived stdio JSON-RPC
//! connection, multiplexes requests by id, and exposes `call(tool, args)`.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

use crate::audit;

/// fli-mcp can return JSON payloads larger than 64KiB (one line of the
/// `search_flights` response often exceeds 100KiB). Give the stdio reader
/// enough room. 8 MiB is overkill but cheap and safe.
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Error)]
pub enum McpError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("mcp error: {0}")]
    Protocol(String),
    #[error("mcp call timed out")]
    Timeout,
}

type ResponseSender = oneshot::Sender<Value>;

pub struct McpClient {
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, ResponseSender>>>,
    next_id: Mutex<u64>,
    _child: Arc<Mutex<Child>>,
}

impl McpClient {
    /// Spawn the given command, perform the MCP handshake (initialize +
    /// initialized notification), and return a ready-to-use client.
    pub async fn spawn(cmd: PathBuf) -> Result<Arc<Self>, McpError> {
        tracing::info!(?cmd, "spawning mcp server");
        let mut command = Command::new(&cmd);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = command.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| McpError::Protocol("no stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| McpError::Protocol("no stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| McpError::Protocol("no stderr".into()))?;

        let pending: Arc<Mutex<HashMap<u64, ResponseSender>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let pending_for_reader = pending.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::with_capacity(MAX_LINE_BYTES, stdout);
            let mut buf = Vec::with_capacity(8 * 1024);
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf).await {
                    Ok(0) => break,
                    Ok(_) => {}
                    Err(e) => {
                        tracing::warn!(error = %e, "mcp stdout read error");
                        break;
                    }
                }
                let value: Value = match serde_json::from_slice(&buf) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(error = %e, "non-json from mcp server");
                        continue;
                    }
                };
                let Some(id) = value.get("id").and_then(|v| v.as_u64()) else {
                    // notifications don't have an id — ignore for now
                    continue;
                };
                let sender_opt = {
                    let mut map = pending_for_reader.lock().await;
                    map.remove(&id)
                };
                if let Some(sender) = sender_opt {
                    let _ = sender.send(value);
                } else {
                    tracing::warn!(id, "no listener for mcp response");
                }
            }
            tracing::warn!("mcp stdout closed");
        });

        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                tracing::info!(target: "mcp", "{line}");
            }
        });

        let client = Arc::new(Self {
            stdin: Mutex::new(stdin),
            pending,
            next_id: Mutex::new(1),
            _child: Arc::new(Mutex::new(child)),
        });

        client.initialize().await?;
        Ok(client)
    }

    async fn initialize(&self) -> Result<(), McpError> {
        let init_params = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "lora-hub", "version": "0.1" }
        });
        let _ = self.request("initialize", init_params).await?;
        // initialized notification — no id, no response
        self.send_raw(json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }))
        .await?;
        Ok(())
    }

    /// Invoke `tools/call` for the given tool and parsed-as-JSON args.
    /// Returns the full `result` object from the MCP response.
    pub async fn call_tool(
        &self,
        tool_name: &str,
        args: Value,
    ) -> Result<Value, McpError> {
        let params = json!({ "name": tool_name, "arguments": args });
        let resp = self.request("tools/call", params).await?;
        if let Some(err) = resp.get("error") {
            return Err(McpError::Protocol(err.to_string()));
        }
        resp.get("result")
            .cloned()
            .ok_or_else(|| McpError::Protocol("response missing 'result'".into()))
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, McpError> {
        let id = {
            let mut n = self.next_id.lock().await;
            let id = *n;
            *n += 1;
            id
        };
        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }
        self.send_raw(req).await?;
        match timeout(CALL_TIMEOUT, rx).await {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(_)) => Err(McpError::Protocol("response channel dropped".into())),
            Err(_) => {
                // clean up pending entry on timeout
                let mut map = self.pending.lock().await;
                map.remove(&id);
                Err(McpError::Timeout)
            }
        }
    }

    async fn send_raw(&self, req: Value) -> Result<(), McpError> {
        let line = format!("{}\n", req);
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }
}

/// Resolve the path to `fli-mcp` installed by pipx. Falls back to PATH lookup.
pub fn resolve_fli_mcp() -> Option<PathBuf> {
    // pipx installs user-scoped binaries to ~/.local/bin
    if let Some(home) = std::env::var_os("HOME") {
        let local = PathBuf::from(home).join(".local").join("bin").join("fli-mcp");
        if local.exists() {
            return Some(local);
        }
    }
    // fallback: assume PATH
    which("fli-mcp")
}

fn which(cmd: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join(cmd);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Tauri state wrapper that lazily spawns the fli-mcp client on first use.
pub struct FliMcpState {
    inner: Mutex<Option<Arc<McpClient>>>,
}

impl FliMcpState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub async fn get_or_init(&self) -> Result<Arc<McpClient>, McpError> {
        let mut guard = self.inner.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }
        let path = resolve_fli_mcp().ok_or_else(|| {
            McpError::Protocol(
                "fli-mcp not found — install with 'pipx install \"flights[mcp]\"'".into(),
            )
        })?;
        let client = McpClient::spawn(path).await?;
        *guard = Some(client.clone());
        Ok(client)
    }
}

#[tauri::command]
pub async fn mcp_fli_call(
    state: tauri::State<'_, Arc<FliMcpState>>,
    tool_name: String,
    args: Value,
) -> Result<Value, String> {
    let client = state.get_or_init().await.map_err(|e| e.to_string())?;
    client
        .call_tool(&tool_name, args)
        .await
        .map_err(|e| e.to_string())
}

/// Resolve the path to `stripe-mcp` installed by pipx. Falls back to PATH lookup.
pub fn resolve_stripe_mcp() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("HOME") {
        let local = PathBuf::from(home)
            .join(".local")
            .join("bin")
            .join("stripe-mcp");
        if local.exists() {
            return Some(local);
        }
    }
    which("stripe-mcp")
}

/// Tauri state wrapper that lazily spawns the stripe-mcp client on first use.
pub struct StripeMcpState {
    inner: Mutex<Option<Arc<McpClient>>>,
}

impl StripeMcpState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub async fn get_or_init(&self) -> Result<Arc<McpClient>, McpError> {
        let mut guard = self.inner.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }
        let path = resolve_stripe_mcp().ok_or_else(|| {
            McpError::Protocol(
                "stripe-mcp not found — install with 'pipx install stripe-mcp' \
                 (or 'pipx install ./mcp/stripe-mcp' from the repo)"
                    .into(),
            )
        })?;
        let client = McpClient::spawn(path).await?;
        *guard = Some(client.clone());
        Ok(client)
    }
}

#[tauri::command]
pub async fn mcp_stripe_call(
    app: AppHandle,
    state: tauri::State<'_, Arc<StripeMcpState>>,
    tool_name: String,
    args: Value,
) -> Result<Value, String> {
    // Stripe tools can move real money, so every call is recorded in the audit
    // log (mirroring the bracket used by the filesystem/shell tools). The arg
    // summary is shape-only — the tool name plus which argument keys were
    // present — so amounts/PII aren't persisted verbatim.
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let arg_keys: Vec<String> = args
        .as_object()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    let args_summary = json!({ "tool": tool_name, "arg_keys": arg_keys }).to_string();
    let ctx = audit::start_log(&data_dir, "stripe_call", "mcp", None, &args_summary)?;

    let result = async {
        let client = state.get_or_init().await.map_err(|e| e.to_string())?;
        client
            .call_tool(&tool_name, args)
            .await
            .map_err(|e| e.to_string())
    }
    .await;

    let (status, bytes) = match &result {
        Ok(v) => ("success", v.to_string().len()),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}
