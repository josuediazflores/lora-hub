//! Tool commands exposed to the agent loop.
//!
//! Every filesystem tool resolves its path argument through
//! `workspace::resolve_path`. Every shell/http tool consults
//! `permissions::is_allowed_*`. The commands themselves have no other security
//! logic — safety lives in those two modules.
//!
//! Every tool call is bracketed by an `audit::start_log` / `audit::end_log`
//! pair; the start is fail-closed (if the log write fails, the tool does
//! not run).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;

use crate::audit;
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

fn preset_name(p: Preset) -> &'static str {
    match p {
        Preset::ReadOnly => "read_only",
        Preset::Standard => "standard",
        Preset::Trusted => "trusted",
    }
}

/// Char-level truncation with an ellipsis suffix. Used in audit summaries
/// so a stray multi-megabyte path can't balloon the log.
fn trunc(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max_chars).collect();
        out.push('…');
        out
    }
}

/// Start an audit record and return the (data_dir, context) tuple needed
/// to close the record later. Fails if the log write fails, which fails
/// the tool call — matches the plan's "fail-closed if logging fails"
/// requirement.
fn audit_start(
    app: &AppHandle,
    tool: &'static str,
    workspace: Option<&Path>,
    args_summary: &str,
) -> Result<(PathBuf, audit::AuditContext), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let preset_state: State<'_, PresetState> = app.state();
    let preset = *preset_state.0.lock().unwrap();
    let ctx = audit::start_log(
        &data_dir,
        tool,
        preset_name(preset),
        workspace,
        args_summary,
    )?;
    Ok((data_dir, ctx))
}

#[tauri::command]
pub fn tool_read_file(
    app: AppHandle,
    ws_state: State<'_, WorkspaceState>,
    path: String,
) -> Result<String, String> {
    let ws = current_workspace(&ws_state)?;
    let args = json!({ "path": trunc(&path, 200) }).to_string();
    let (data_dir, ctx) = audit_start(&app, "read_file", Some(&ws.root), &args)?;

    let result = (|| -> Result<String, String> {
        let resolved = resolve_path(&ws.root, &path)?;
        std::fs::read_to_string(&resolved).map_err(|e| format!("read_file: {e}"))
    })();

    let (status, bytes) = match &result {
        Ok(s) => ("success", s.len()),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

#[tauri::command]
pub fn tool_write_file(
    app: AppHandle,
    ws_state: State<'_, WorkspaceState>,
    preset_state: State<'_, PresetState>,
    path: String,
    content: String,
) -> Result<u64, String> {
    let ws = current_workspace(&ws_state)?;
    let args = json!({
        "path": trunc(&path, 200),
        "content_bytes": content.as_bytes().len(),
    })
    .to_string();
    let (data_dir, ctx) = audit_start(&app, "write_file", Some(&ws.root), &args)?;

    let bytes_len = content.as_bytes().len();
    let result = (|| -> Result<u64, String> {
        is_allowed_write(current_preset(&preset_state))?;
        let resolved = resolve_path(&ws.root, &path)?;
        std::fs::write(&resolved, content.as_bytes())
            .map_err(|e| format!("write_file: {e}"))?;
        Ok(bytes_len as u64)
    })();

    let (status, bytes) = match &result {
        Ok(n) => ("success", *n as usize),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

#[derive(Serialize)]
pub struct EditFileResult {
    pub bytes_written: u64,
    pub occurrences: usize,
}

/// Replace exactly one occurrence of `old_string` with `new_string` inside
/// a workspace file. Zero or multiple matches fails — the model must supply
/// enough surrounding context in `old_string` to be uniquely identifying.
/// This is intentionally stricter than `write_file`: it shifts the burden
/// from "emit the whole file" to "describe the edit precisely".
#[tauri::command]
pub fn tool_edit_file(
    app: AppHandle,
    ws_state: State<'_, WorkspaceState>,
    preset_state: State<'_, PresetState>,
    path: String,
    old_string: String,
    new_string: String,
) -> Result<EditFileResult, String> {
    let ws = current_workspace(&ws_state)?;
    let args = json!({
        "path": trunc(&path, 200),
        "old_len": old_string.as_bytes().len(),
        "new_len": new_string.as_bytes().len(),
    })
    .to_string();
    let (data_dir, ctx) = audit_start(&app, "edit_file", Some(&ws.root), &args)?;

    let result = (|| -> Result<EditFileResult, String> {
        is_allowed_write(current_preset(&preset_state))?;
        if old_string.is_empty() {
            return Err("edit_file: old_string must not be empty".to_string());
        }
        if old_string == new_string {
            return Err("edit_file: old_string and new_string are identical".to_string());
        }
        let resolved = resolve_path(&ws.root, &path)?;
        let contents = std::fs::read_to_string(&resolved)
            .map_err(|e| format!("edit_file: {e}"))?;
        let occurrences = contents.matches(&old_string).count();
        if occurrences == 0 {
            return Err(
                "edit_file: old_string not found — re-read the file and match exact bytes"
                    .to_string(),
            );
        }
        if occurrences > 1 {
            return Err(format!(
                "edit_file: old_string matches {occurrences} places — widen the context so it is unique"
            ));
        }
        let replaced = contents.replacen(&old_string, &new_string, 1);
        let bytes = replaced.as_bytes().len() as u64;
        std::fs::write(&resolved, replaced.as_bytes())
            .map_err(|e| format!("edit_file: {e}"))?;
        Ok(EditFileResult {
            bytes_written: bytes,
            occurrences,
        })
    })();

    let (status, bytes) = match &result {
        Ok(r) => ("success", r.bytes_written as usize),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

#[tauri::command]
pub fn tool_list_dir(
    app: AppHandle,
    ws_state: State<'_, WorkspaceState>,
    path: Option<String>,
) -> Result<Vec<DirEntry>, String> {
    let ws = current_workspace(&ws_state)?;
    let rel = path.clone().unwrap_or_default();
    let args = json!({ "path": trunc(&rel, 200) }).to_string();
    let (data_dir, ctx) = audit_start(&app, "list_dir", Some(&ws.root), &args)?;

    let result = (|| -> Result<Vec<DirEntry>, String> {
        let target = if rel.is_empty() { "." } else { &rel };
        let resolved = resolve_path(&ws.root, target)?;
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
    })();

    let (status, bytes) = match &result {
        Ok(v) => ("success", v.len()),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

#[tauri::command]
pub fn tool_glob(
    app: AppHandle,
    ws_state: State<'_, WorkspaceState>,
    pattern: String,
) -> Result<Vec<String>, String> {
    let ws = current_workspace(&ws_state)?;
    let args = json!({ "pattern": trunc(&pattern, 200) }).to_string();
    let (data_dir, ctx) = audit_start(&app, "glob", Some(&ws.root), &args)?;

    let result = (|| -> Result<Vec<String>, String> {
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
    })();

    let (status, bytes) = match &result {
        Ok(v) => ("success", v.len()),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

#[tauri::command]
pub async fn tool_grep(
    app: AppHandle,
    ws_state: State<'_, WorkspaceState>,
    pattern: String,
    path: Option<String>,
) -> Result<Vec<GrepMatch>, String> {
    let ws = current_workspace(&ws_state)?;
    let args = json!({
        "pattern": trunc(&pattern, 200),
        "path": path.as_deref().map(|p| trunc(p, 200)),
    })
    .to_string();
    let (data_dir, ctx) = audit_start(&app, "grep", Some(&ws.root), &args)?;

    let result = grep_inner(&ws, &pattern, path.as_deref()).await;
    let (status, bytes) = match &result {
        Ok(v) => ("success", v.len()),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

async fn grep_inner(
    ws: &Workspace,
    pattern: &str,
    path: Option<&str>,
) -> Result<Vec<GrepMatch>, String> {
    let search_in = if let Some(p) = path {
        resolve_path(&ws.root, p)?
    } else {
        std::fs::canonicalize(&ws.root).map_err(|e| format!("workspace: {e}"))?
    };

    let out = Command::new("rg")
        .arg("--json")
        .arg("--line-number")
        .arg("--no-heading")
        .arg("--color=never")
        .arg(pattern)
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
    app: AppHandle,
    ws_state: State<'_, WorkspaceState>,
    preset_state: State<'_, PresetState>,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<CommandResult, String> {
    let ws = current_workspace(&ws_state)?;
    let args_summary = json!({
        "cmd": trunc(&cmd, 100),
        "args_count": args.len(),
        "cwd": cwd.as_deref().map(|c| trunc(c, 100)),
    })
    .to_string();
    let (data_dir, ctx) = audit_start(&app, "run_command", Some(&ws.root), &args_summary)?;

    let preset = current_preset(&preset_state);
    let result = run_command_inner(&ws, preset, &cmd, &args, cwd.as_deref()).await;
    let (status, bytes) = match &result {
        Ok(r) => (
            "success",
            r.stdout.len() + r.stderr.len(),
        ),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

async fn run_command_inner(
    ws: &Workspace,
    preset: Preset,
    cmd: &str,
    args: &[String],
    cwd: Option<&str>,
) -> Result<CommandResult, String> {
    is_allowed_command(cmd, preset)?;

    let working_dir = if let Some(c) = cwd {
        resolve_path(&ws.root, c)?
    } else {
        std::fs::canonicalize(&ws.root).map_err(|e| e.to_string())?
    };

    let fut = Command::new(cmd)
        .args(args)
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
    app: AppHandle,
    preset_state: State<'_, PresetState>,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let method = method.unwrap_or_else(|| "GET".into()).to_uppercase();
    // Audit summary *never* includes url query strings in full (may carry
    // API keys), headers (may carry auth), or body bytes. Just shapes.
    let args_summary = json!({
        "url": trunc(&url, 200),
        "method": &method,
        "has_headers": headers.is_some(),
        "body_bytes": body.as_ref().map(|b| b.len()).unwrap_or(0),
    })
    .to_string();
    let (data_dir, ctx) = audit_start(&app, "http_fetch", None, &args_summary)?;

    let preset = current_preset(&preset_state);
    let result = http_fetch_inner(preset, &url, &method, headers, body).await;
    let (status, bytes) = match &result {
        Ok(r) => ("success", r.body.len()),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

async fn http_fetch_inner(
    preset: Preset,
    url: &str,
    method: &str,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    is_allowed_http(method, preset)?;

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let method_parsed = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;
    let mut req = client.request(method_parsed, url);
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

// ---------- web_search ----------

#[derive(Serialize)]
pub struct WebSearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Search the web. Provider is chosen by the caller:
///   * `"duckduckgo"` — no API key, scrapes the HTML endpoint.
///   * `"brave"` — Brave Search API, requires `api_key`.
#[tauri::command]
pub async fn tool_web_search(
    app: AppHandle,
    preset_state: State<'_, PresetState>,
    query: String,
    count: Option<u32>,
    provider: Option<String>,
    api_key: Option<String>,
) -> Result<Vec<WebSearchHit>, String> {
    let provider = provider.unwrap_or_else(|| "duckduckgo".into());
    let args = json!({
        "query": trunc(&query, 200),
        "count": count.unwrap_or(5),
        "provider": &provider,
    })
    .to_string();
    let (data_dir, ctx) = audit_start(&app, "web_search", None, &args)?;

    let preset = current_preset(&preset_state);
    let result = web_search_inner(
        preset,
        &query,
        count.unwrap_or(5),
        &provider,
        api_key.as_deref().unwrap_or(""),
    )
    .await;
    let (status, bytes) = match &result {
        Ok(hits) => ("success", hits.len()),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

async fn web_search_inner(
    preset: Preset,
    query: &str,
    count: u32,
    provider: &str,
    api_key: &str,
) -> Result<Vec<WebSearchHit>, String> {
    is_allowed_http("GET", preset)?;
    let count = count.clamp(1, 10);
    match provider {
        "brave" => web_search_brave(query, count, api_key).await,
        "duckduckgo" | "" => web_search_ddg(query, count).await,
        other => Err(format!("web_search: unknown provider '{other}'")),
    }
}

async fn web_search_brave(
    query: &str,
    count: u32,
    api_key: &str,
) -> Result<Vec<WebSearchHit>, String> {
    if api_key.trim().is_empty() {
        return Err(
            "web_search (brave): API key missing — set it in Settings → Integrations".to_string(),
        );
    }
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .header("Accept", "application/json")
        .header("X-Subscription-Token", api_key)
        .query(&[
            ("q", query.to_string()),
            ("count", count.to_string()),
            ("safesearch", "moderate".into()),
        ])
        .send()
        .await
        .map_err(|e| format!("web_search: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("web_search: brave api http {}", status.as_u16()));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("web_search: parse json: {e}"))?;
    let results = body
        .get("web")
        .and_then(|w| w.get("results"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(results
        .into_iter()
        .take(count as usize)
        .map(|r| WebSearchHit {
            title: r.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            url: r.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            snippet: r
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect())
}

/// DuckDuckGo's no-API HTML endpoint. Fragile but free — selectors below
/// assume DDG's stable `result__a` / `result__snippet` class names. If DDG
/// revamps, this regex set is the single point of maintenance.
async fn web_search_ddg(query: &str, count: u32) -> Result<Vec<WebSearchHit>, String> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        // DDG blocks blank / obviously-bot UAs.
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
             (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        )
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .post("https://html.duckduckgo.com/html/")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!("q={}&kl=wt-wt", url_encode(query)))
        .send()
        .await
        .map_err(|e| format!("web_search (ddg): {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("web_search: ddg http {}", status.as_u16()));
    }
    let html = resp
        .text()
        .await
        .map_err(|e| format!("web_search (ddg) body: {e}"))?;
    parse_ddg_html(&html, count)
}

fn url_encode(s: &str) -> String {
    // Minimal form-url-encoder so we don't pull in another crate for one call.
    // Spaces → +, anything non-alphanumeric / non-{-._~} → %HH.
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn parse_ddg_html(html: &str, count: u32) -> Result<Vec<WebSearchHit>, String> {
    let mut hits: Vec<WebSearchHit> = Vec::new();
    // Each result block starts with an <h2 class="result__title"> and
    // contains an <a class="result__a" href="…">Title</a> plus, further
    // down, an <a class="result__snippet">Snippet</a>. We scan linearly
    // through the document capturing pairs in order.
    let mut rest = html;
    while let Some(a_start) = rest.find("class=\"result__a\"") {
        rest = &rest[a_start..];
        // href=".."
        let href_start = match rest.find("href=\"") {
            Some(i) => i + "href=\"".len(),
            None => break,
        };
        let href_end = match rest[href_start..].find('"') {
            Some(i) => href_start + i,
            None => break,
        };
        let raw_href = &rest[href_start..href_end];
        let url = decode_ddg_redirect(raw_href);
        // >Title</a>
        let title_open = match rest[href_end..].find('>') {
            Some(i) => href_end + i + 1,
            None => break,
        };
        let title_close = match rest[title_open..].find("</a>") {
            Some(i) => title_open + i,
            None => break,
        };
        let title = strip_tags(&rest[title_open..title_close]);

        // Snippet (optional).
        let snippet = if let Some(s_start) = rest[title_close..].find("class=\"result__snippet\"") {
            let abs = title_close + s_start;
            let open = rest[abs..].find('>').map(|i| abs + i + 1);
            let close = open.and_then(|o| rest[o..].find("</a>").map(|i| o + i));
            match (open, close) {
                (Some(o), Some(c)) => strip_tags(&rest[o..c]),
                _ => String::new(),
            }
        } else {
            String::new()
        };

        if !url.is_empty() && !title.is_empty() {
            hits.push(WebSearchHit {
                title: title.trim().to_string(),
                url,
                snippet: snippet.trim().to_string(),
            });
            if hits.len() >= count as usize {
                break;
            }
        }
        // Advance past this match; if we fall through without finding the
        // close tag earlier we still make progress by stepping 1 byte.
        rest = &rest[title_close.max(1)..];
    }

    if hits.is_empty() {
        return Err(
            "web_search (ddg): no results parsed — duckduckgo may have blocked the request or \
             changed its HTML layout"
                .to_string(),
        );
    }
    Ok(hits)
}

/// DDG wraps outbound links in `//duckduckgo.com/l/?uddg=<encoded>&rut=…`.
/// Pull the real target out of the `uddg` query parameter.
fn decode_ddg_redirect(raw: &str) -> String {
    let candidate = if let Some(stripped) = raw.strip_prefix("//") {
        format!("https://{}", stripped)
    } else {
        raw.to_string()
    };
    if let Ok(parsed) = url::Url::parse(&candidate) {
        if parsed.host_str().map(|h| h.contains("duckduckgo.com")).unwrap_or(false) {
            for (k, v) in parsed.query_pairs() {
                if k == "uddg" {
                    return v.into_owned();
                }
            }
        }
    }
    // Decode HTML entities that DDG sometimes leaves in raw hrefs.
    candidate.replace("&amp;", "&")
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

// ---------- fetch_page ----------

const MAX_MARKDOWN_BYTES: usize = 30_000;

#[derive(Serialize)]
pub struct FetchPageResult {
    pub url: String,
    pub title: String,
    pub markdown: String,
    pub truncated: bool,
}

/// Fetch a URL, extract main-article content via readability, convert to
/// Markdown. The model's job is reading prose, not parsing DOM — this tool
/// gives it clean text. Respects the same HTTP permission preset as
/// `http_fetch` (GET is allowed on read_only+).
#[tauri::command]
pub async fn tool_fetch_page(
    app: AppHandle,
    preset_state: State<'_, PresetState>,
    url: String,
) -> Result<FetchPageResult, String> {
    let args = json!({ "url": trunc(&url, 200) }).to_string();
    let (data_dir, ctx) = audit_start(&app, "fetch_page", None, &args)?;

    let preset = current_preset(&preset_state);
    let result = fetch_page_inner(preset, &url).await;
    let (status, bytes) = match &result {
        Ok(r) => ("success", r.markdown.len()),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

async fn fetch_page_inner(preset: Preset, url: &str) -> Result<FetchPageResult, String> {
    is_allowed_http("GET", preset)?;

    let parsed = url::Url::parse(url).map_err(|e| format!("fetch_page: bad url ({e})"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("fetch_page: only http(s) URLs are allowed".to_string());
    }

    // Sites behind Cloudflare / aggressive WAFs (AccuWeather, StackOverflow
    // edges, any newspaper paywall) reject a blank / bot-shaped UA outright
    // with 403. Matching a real desktop Safari UA gets us past most of them
    // without misrepresenting the client category (we really are a browser
    // shell fetching a page for the user).
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
             (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        )
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("fetch_page: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("fetch_page: http {}", resp.status().as_u16()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("fetch_page body: {e}"))?;
    let cap = MAX_HTTP_BODY_BYTES.min(bytes.len());
    let html = String::from_utf8_lossy(&bytes[..cap]).into_owned();

    // readability::extractor::extract reads from a &mut impl Read. Wrap the
    // HTML string in a Cursor so we can hand it in without a round-trip
    // through a temp file.
    let url_parsed = url::Url::parse(url).map_err(|e| format!("url: {e}"))?;
    let mut cursor = std::io::Cursor::new(html.as_bytes());
    let product = readability::extractor::extract(&mut cursor, &url_parsed)
        .map_err(|e| format!("fetch_page: extract: {e}"))?;

    let md = html2md::parse_html(&product.content);
    let md_bytes = md.as_bytes();
    let (md_out, truncated) = if md_bytes.len() > MAX_MARKDOWN_BYTES {
        // Clip on a char boundary so we don't slice mid-UTF-8 sequence.
        let mut cut = MAX_MARKDOWN_BYTES;
        while cut > 0 && !md.is_char_boundary(cut) {
            cut -= 1;
        }
        (md[..cut].to_string() + "\n\n…[truncated]", true)
    } else {
        (md, false)
    };

    Ok(FetchPageResult {
        url: url.to_string(),
        title: product.title,
        markdown: md_out,
        truncated,
    })
}
