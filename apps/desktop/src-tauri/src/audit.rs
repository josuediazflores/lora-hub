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

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;
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
    let id = Uuid::new_v4().to_string();
    let entry = json!({
        "ts": now_epoch_seconds(),
        "id": id,
        "phase": "start",
        "tool": tool,
        "preset": preset,
        "workspace": workspace.map(|p| p.display().to_string()),
        "args": args_summary,
    });
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

fn append_line(data_dir: &Path, line: &str) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| format!("audit dir: {e}"))?;
    let path = data_dir.join("audit.log");
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("audit log: {e}"))?;
    writeln!(f, "{}", line).map_err(|e| format!("audit log: {e}"))?;
    Ok(())
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
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
