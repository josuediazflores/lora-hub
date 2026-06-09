//! Append-only audit log for tool calls.
//!
//! One JSON line per event, written to
//! `~/Library/Application Support/com.lorahub.desktop/audit.log`. Every
//! tool emits a `start` entry *before* it runs — failing the call if the
//! write fails — and an `end` entry after, correlated by UUID. Intended
//! as a forensic trail; there's no in-app viewer yet, the file is
//! discoverable and line-grep friendly.
//!
//! Sensitive payload fields (file content, request bodies, headers)
//! are redacted at the tool boundary before they reach `start_log`, so
//! the log itself never contains secrets — only sizes and shapes.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub struct AuditContext {
    pub id: String,
    pub started_at: SystemTime,
}

pub fn start_log(
    data_dir: &Path,
    tool: &str,
    preset: &str,
    workspace: Option<&Path>,
    args_summary: &str,
) -> Result<AuditContext, String> {
    start_log_with_approval(data_dir, tool, preset, workspace, args_summary, None)
}

/// Variant that records an `"approval"` field on the start entry. Used by
/// `tool_run_command_approved` so the audit trail captures *why* a
/// non-allowlisted command was permitted to run (`"once"`, `"session"`, or
/// `"denied"`).
pub fn start_log_with_approval(
    data_dir: &Path,
    tool: &str,
    preset: &str,
    workspace: Option<&Path>,
    args_summary: &str,
    approval: Option<&str>,
) -> Result<AuditContext, String> {
    let id = Uuid::new_v4().to_string();
    let mut entry = json!({
        "ts": now_epoch_seconds(),
        "id": id,
        "phase": "start",
        "tool": tool,
        "preset": preset,
        "workspace": workspace.map(|p| p.display().to_string()),
        "args": args_summary,
    });
    if let Some(decision) = approval {
        entry["approval"] = json!(decision);
    }
    append_line(data_dir, &entry.to_string())?;
    Ok(AuditContext {
        id,
        started_at: SystemTime::now(),
    })
}

pub fn end_log(data_dir: &Path, ctx: &AuditContext, status: &str, bytes: usize) {
    let duration_ms = SystemTime::now()
        .duration_since(ctx.started_at)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let entry = json!({
        "ts": now_epoch_seconds(),
        "id": ctx.id,
        "phase": "end",
        "status": status,
        "bytes": bytes,
        "duration_ms": duration_ms,
    });
    // Best-effort: the tool has already run by the time we reach here.
    let _ = append_line(data_dir, &entry.to_string());
}

/// Rotate the live audit log once it passes this size, so it never grows
/// unbounded. Exactly one previous generation is kept (`audit.log.1`).
const MAX_AUDIT_BYTES: u64 = 8 * 1024 * 1024;

fn append_line(data_dir: &Path, line: &str) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| format!("audit dir: {e}"))?;
    let path = data_dir.join("audit.log");
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("audit log: {e}"))?;
    writeln!(f, "{}", line).map_err(|e| format!("audit log: {e}"))?;
    // Rotate when the live log exceeds the cap. `read_log` reads both the live
    // log and the rotated generation, so recent history survives a rotation.
    if let Ok(meta) = f.metadata() {
        if meta.len() > MAX_AUDIT_BYTES {
            drop(f);
            let rotated = data_dir.join("audit.log.1");
            let _ = std::fs::rename(&path, &rotated);
        }
    }
    Ok(())
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// One row exposed to the UI viewer. Pairs the start + end entries by uuid
/// so the viewer doesn't have to do that bookkeeping itself.
#[derive(Debug, Serialize)]
pub struct AuditRow {
    pub id: String,
    pub ts: u64,
    pub tool: String,
    pub preset: String,
    pub workspace: Option<String>,
    pub args: String,
    /// "success" | "error" | "pending" (the latter only for orphan starts).
    pub status: String,
    pub bytes: u64,
    pub duration_ms: u64,
    pub approval: Option<String>,
}

/// Read up to `limit` audit rows ending at `offset` from the newest entry.
/// Pairs every `start` line with its matching `end` line by id; orphan
/// starts (e.g. the app crashed mid-tool) are returned with `status: pending`.
///
/// Returned rows are newest-first.
pub fn read_log(
    data_dir: &Path,
    limit: usize,
    offset: usize,
) -> Result<Vec<AuditRow>, String> {
    // Read the rotated generation first (older) then the live log (newer); the
    // final sort is by timestamp, so file order doesn't matter. Parsing is
    // bounded to the live log + one rotation (~2 × MAX_AUDIT_BYTES).
    let mut starts: Vec<Value> = Vec::new();
    let mut ends: HashMap<String, Value> = HashMap::new();
    for name in ["audit.log.1", "audit.log"] {
        let path = data_dir.join(name);
        let file = match File::open(&path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("audit log: {e}")),
        };
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = match line {
                Ok(l) if !l.trim().is_empty() => l,
                _ => continue,
            };
            let v: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            match v.get("phase").and_then(|p| p.as_str()) {
                Some("start") => starts.push(v),
                Some("end") => {
                    if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
                        ends.insert(id.to_string(), v);
                    }
                }
                _ => {}
            }
        }
    }

    let mut rows: Vec<AuditRow> = Vec::with_capacity(starts.len());
    for s in starts {
        let id = s.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
        let end = ends.get(&id);
        rows.push(AuditRow {
            id: id.clone(),
            ts: s.get("ts").and_then(|t| t.as_u64()).unwrap_or(0),
            tool: s
                .get("tool")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
            preset: s
                .get("preset")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string(),
            workspace: s
                .get("workspace")
                .and_then(|w| w.as_str())
                .map(String::from),
            args: s
                .get("args")
                .and_then(|a| a.as_str())
                .unwrap_or("")
                .to_string(),
            status: end
                .and_then(|e| e.get("status").and_then(|s| s.as_str()))
                .unwrap_or("pending")
                .to_string(),
            bytes: end
                .and_then(|e| e.get("bytes").and_then(|b| b.as_u64()))
                .unwrap_or(0),
            duration_ms: end
                .and_then(|e| e.get("duration_ms").and_then(|d| d.as_u64()))
                .unwrap_or(0),
            approval: s
                .get("approval")
                .and_then(|a| a.as_str())
                .map(String::from),
        });
    }
    // Newest first, then apply offset/limit.
    rows.sort_by(|a, b| b.ts.cmp(&a.ts));
    let start = offset.min(rows.len());
    let end = (offset + limit).min(rows.len());
    Ok(rows[start..end].to_vec())
}

/// Truncate the audit log to zero bytes. The file itself stays so the next
/// `append_line` succeeds without the create_dir_all dance running again.
pub fn clear_log(data_dir: &Path) -> Result<(), String> {
    // Drop any rotated generation too, so "clear" really clears.
    let _ = std::fs::remove_file(data_dir.join("audit.log.1"));
    let path = data_dir.join("audit.log");
    match File::create(&path) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("audit log: {e}")),
    }
}

/// Path to the on-disk audit log. Used by the export command so the
/// frontend can copy the file without round-tripping bytes through IPC.
pub fn log_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("audit.log")
}

// AuditRow needs Clone for the slice copy above.
impl Clone for AuditRow {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            ts: self.ts,
            tool: self.tool.clone(),
            preset: self.preset.clone(),
            workspace: self.workspace.clone(),
            args: self.args.clone(),
            status: self.status.clone(),
            bytes: self.bytes,
            duration_ms: self.duration_ms,
            approval: self.approval.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn start_end_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("ws");
        std::fs::create_dir_all(&ws).unwrap();

        let ctx = start_log(
            dir.path(),
            "read_file",
            "read_only",
            Some(&ws),
            r#"{"path":"README.md"}"#,
        )
        .expect("start_log writes");

        end_log(dir.path(), &ctx, "success", 1234);

        let log = std::fs::read_to_string(dir.path().join("audit.log")).unwrap();
        let lines: Vec<&str> = log.trim().split('\n').collect();
        assert_eq!(lines.len(), 2, "expected start + end lines; got:\n{log}");

        let start: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(start["phase"], "start");
        assert_eq!(start["tool"], "read_file");
        assert_eq!(start["preset"], "read_only");
        assert_eq!(start["id"], ctx.id);

        let end: Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(end["phase"], "end");
        assert_eq!(end["status"], "success");
        assert_eq!(end["bytes"], 1234);
        assert_eq!(end["id"], ctx.id);
        assert!(end["duration_ms"].as_u64().is_some());
    }

    #[test]
    fn start_fails_if_dir_not_writable() {
        // A path under a nonexistent parent that can't be created also
        // passes through create_dir_all — we exercise a path we know we
        // cannot create (file masquerading as a parent directory).
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, "I'm a file").unwrap();
        let wedged = blocker.join("nope");
        let result = start_log(&wedged, "read_file", "read_only", None, "{}");
        assert!(result.is_err(), "expected start_log to fail on bad data_dir");
    }

    #[test]
    fn multiple_calls_append() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..3 {
            let ctx = start_log(
                dir.path(),
                "list_dir",
                "standard",
                None,
                &format!(r#"{{"n":{i}}}"#),
            )
            .unwrap();
            end_log(dir.path(), &ctx, "success", i * 10);
        }
        let log = std::fs::read_to_string(dir.path().join("audit.log")).unwrap();
        let lines: Vec<&str> = log.trim().split('\n').collect();
        assert_eq!(lines.len(), 6, "3 start + 3 end lines expected");
    }
}
