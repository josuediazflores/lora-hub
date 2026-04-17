//! Tool commands exposed to the agent loop.
//!
//! Every filesystem tool resolves its path argument through
//! `workspace::resolve_path`. Every shell/http tool consults
//! `permissions::is_allowed_*`. The commands themselves have no other security
//! logic — safety lives in those two modules.

use std::collections::HashMap;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio::process::Command;

use crate::permissions::{
    is_allowed_command, is_allowed_http, is_allowed_write, Preset, PresetState,
};
use crate::workspace::{resolve_path, Workspace, WorkspaceState};

const MAX_GREP_MATCHES: usize = 500;
const MAX_CMD_OUTPUT_BYTES: usize = 1 << 20; // 1 MiB
const MAX_HTTP_BODY_BYTES: usize = 10 << 20; // 10 MiB
const CMD_TIMEOUT: Duration = Duration::from_secs(60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub kind: &'static str, // "file" | "dir" | "symlink" | "other"
    pub size: u64,
}

#[derive(Serialize)]
pub struct GrepMatch {
    pub file: String,
    pub line: u64,
    pub text: String,
}

#[derive(Serialize)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
    pub headers: HashMap<String, String>,
    pub truncated: bool,
}

fn current_workspace(state: &State<'_, WorkspaceState>) -> Result<Workspace, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no workspace set; call set_workspace first".to_string())
}

fn current_preset(state: &State<'_, PresetState>) -> Preset {
    *state.0.lock().unwrap()
}

#[tauri::command]
pub fn tool_read_file(
    ws_state: State<'_, WorkspaceState>,
    path: String,
) -> Result<String, String> {
    let ws = current_workspace(&ws_state)?;
    let resolved = resolve_path(&ws.root, &path)?;
    std::fs::read_to_string(&resolved).map_err(|e| format!("read_file: {e}"))
}

#[tauri::command]
pub fn tool_write_file(
    ws_state: State<'_, WorkspaceState>,
    preset_state: State<'_, PresetState>,
    path: String,
    content: String,
) -> Result<u64, String> {
    is_allowed_write(current_preset(&preset_state))?;
    let ws = current_workspace(&ws_state)?;
    let resolved = resolve_path(&ws.root, &path)?;
    std::fs::write(&resolved, content.as_bytes())
        .map_err(|e| format!("write_file: {e}"))?;
    Ok(content.as_bytes().len() as u64)
}

#[tauri::command]
pub fn tool_list_dir(
    ws_state: State<'_, WorkspaceState>,
    path: Option<String>,
) -> Result<Vec<DirEntry>, String> {
    let ws = current_workspace(&ws_state)?;
    let rel = path.unwrap_or_default();
    let resolved = resolve_path(&ws.root, if rel.is_empty() { "." } else { &rel })?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for ent in std::fs::read_dir(&resolved).map_err(|e| format!("list_dir: {e}"))? {
        let ent = ent.map_err(|e| e.to_string())?;
        let ft = ent.file_type().map_err(|e| e.to_string())?;
        let kind = if ft.is_dir() {
            "dir"
        } else if ft.is_symlink() {
            "symlink"
        } else if ft.is_file() {
            "file"
        } else {
            "other"
        };
        let size = ent.metadata().map(|m| m.len()).unwrap_or(0);
        entries.push(DirEntry {
            name: ent.file_name().to_string_lossy().into_owned(),
            kind,
            size,
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub fn tool_glob(
    ws_state: State<'_, WorkspaceState>,
    pattern: String,
) -> Result<Vec<String>, String> {
    let ws = current_workspace(&ws_state)?;
    let ws_canon =
        std::fs::canonicalize(&ws.root).map_err(|e| format!("workspace: {e}"))?;
    let joined = ws_canon.join(&pattern);
    let pattern_str = joined.to_string_lossy().into_owned();
    let it = glob::glob(&pattern_str).map_err(|e| format!("glob: {e}"))?;
    let mut out = Vec::new();
    for path in it.flatten() {
        let canon = std::fs::canonicalize(&path).unwrap_or(path);
        if canon.starts_with(&ws_canon) {
            if let Ok(rel) = canon.strip_prefix(&ws_canon) {
                out.push(rel.to_string_lossy().into_owned());
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn tool_grep(
    ws_state: State<'_, WorkspaceState>,
    pattern: String,
    path: Option<String>,
) -> Result<Vec<GrepMatch>, String> {
    let ws = current_workspace(&ws_state)?;
    let search_in = if let Some(p) = path {
        resolve_path(&ws.root, &p)?
    } else {
        std::fs::canonicalize(&ws.root).map_err(|e| format!("workspace: {e}"))?
    };

    let out = Command::new("rg")
        .arg("--json")
        .arg("--line-number")
        .arg("--no-heading")
        .arg("--color=never")
        .arg(&pattern)
        .arg(&search_in)
        .output()
        .await
        .map_err(|e| format!("grep (is ripgrep installed?): {e}"))?;

    let mut matches = Vec::new();
    for line in out.stdout.split(|&b| b == b'\n') {
        if line.is_empty() {
            continue;
        }
        let s = match std::str::from_utf8(line) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let v: serde_json::Value = match serde_json::from_str(s) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|t| t.as_str()) == Some("match") {
            let data = &v["data"];
            let file = data["path"]["text"].as_str().unwrap_or("").to_string();
            let line_num = data["line_number"].as_u64().unwrap_or(0);
            let text = data["lines"]["text"]
                .as_str()
                .unwrap_or("")
                .trim_end_matches('\n')
                .to_string();
            matches.push(GrepMatch {
                file,
                line: line_num,
                text,
            });
            if matches.len() >= MAX_GREP_MATCHES {
                break;
            }
        }
    }
    Ok(matches)
}

#[tauri::command]
pub async fn tool_run_command(
    ws_state: State<'_, WorkspaceState>,
    preset_state: State<'_, PresetState>,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<CommandResult, String> {
    is_allowed_command(&cmd, current_preset(&preset_state))?;
    let ws = current_workspace(&ws_state)?;

    let working_dir = if let Some(c) = cwd {
        resolve_path(&ws.root, &c)?
    } else {
        std::fs::canonicalize(&ws.root).map_err(|e| e.to_string())?
    };

    let fut = Command::new(&cmd)
        .args(&args)
        .current_dir(&working_dir)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .output();

    let out = tokio::time::timeout(CMD_TIMEOUT, fut)
        .await
        .map_err(|_| format!("run_command: timed out after {}s", CMD_TIMEOUT.as_secs()))?
        .map_err(|e| format!("run_command: {e}"))?;

    let mut stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let mut stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let mut truncated = false;
    if stdout.len() > MAX_CMD_OUTPUT_BYTES {
        stdout.truncate(MAX_CMD_OUTPUT_BYTES);
        truncated = true;
    }
    if stderr.len() > MAX_CMD_OUTPUT_BYTES {
        stderr.truncate(MAX_CMD_OUTPUT_BYTES);
        truncated = true;
    }

    Ok(CommandResult {
        stdout,
        stderr,
        exit_code: out.status.code().unwrap_or(-1),
        truncated,
    })
}

#[tauri::command]
pub async fn tool_http_fetch(
    preset_state: State<'_, PresetState>,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let method = method.unwrap_or_else(|| "GET".into()).to_uppercase();
    is_allowed_http(&method, current_preset(&preset_state))?;

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let method_parsed = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;
    let mut req = client.request(method_parsed, &url);
    if let Some(hs) = headers {
        for (k, v) in hs {
            req = req.header(&k, &v);
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| format!("http: {e}"))?;
    let status = resp.status().as_u16();
    let headers_out: HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let bytes = resp.bytes().await.map_err(|e| format!("http body: {e}"))?;
    let mut truncated = false;
    let cap = MAX_HTTP_BODY_BYTES.min(bytes.len());
    let body_out = String::from_utf8_lossy(&bytes[..cap]).into_owned();
    if bytes.len() > MAX_HTTP_BODY_BYTES {
        truncated = true;
    }

    Ok(HttpResponse {
        status,
        body: body_out,
        headers: headers_out,
        truncated,
    })
}
