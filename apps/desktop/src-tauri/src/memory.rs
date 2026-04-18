//! Persistent per-user memory store.
//!
//! Small, user-curated notes about the person using the app — preferences,
//! environment facts, ongoing projects. Prepended to every model turn as
//! a system-role message so the assistant has continuity across sessions.
//!
//! Writes go through three entry points:
//!   * `memory_save` — UI-driven create/update (user is trusted).
//!   * `memory_delete` — UI-driven removal.
//!   * `memory_tool_save` — the agent's tool call (user is NOT trusted here,
//!     so we run a secret scrubber and respect the same audit bracket as
//!     every other tool in `tools.rs`).
//!
//! Storage shape mirrors `workspace.rs`/`permissions.rs`: a single JSON
//! file at `{app_data_dir}/memories.json`, written atomically via
//! `serde_json::to_string_pretty` + `std::fs::write`.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::audit;

const FILE_NAME: &str = "memories.json";

pub const MAX_MEMORIES: usize = 50;
pub const MAX_CONTENT_BYTES: usize = 2_000;
pub const MAX_NAME_CHARS: usize = 80;
pub const MAX_TOTAL_BYTES: usize = 32_768;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub name: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Shape used by the Settings-UI save path. `id` is optional (new memory
/// when absent); timestamps are authoritative on the Rust side.
#[derive(Debug, Deserialize)]
pub struct MemoryInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    format!("mem_{}", Uuid::new_v4().simple())
}

pub fn load(data_dir: &Path) -> Vec<Memory> {
    let path = data_dir.join(FILE_NAME);
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_all(data_dir: &Path, memories: &[Memory]) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let path = data_dir.join(FILE_NAME);
    let json = serde_json::to_string_pretty(memories).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn total_bytes(memories: &[Memory]) -> usize {
    memories.iter().map(|m| m.name.len() + m.content.len()).sum()
}

/// Lightweight prefix scan for common API-key shapes. Good enough to catch
/// the obvious cases the model might accidentally quote back. Not a substitute
/// for user judgment; a user-driven manual save bypasses this intentionally.
fn contains_secret(s: &str) -> bool {
    const MARKERS: &[&str] = &[
        "sk-",
        "AKIA",
        "ghp_",
        "gho_",
        "ghs_",
        "ghu_",
        "xoxb-",
        "xoxp-",
        "-----BEGIN ",
    ];
    MARKERS.iter().any(|m| s.contains(m))
}

fn validate_input(input: &MemoryInput, scrub_secrets: bool) -> Result<(), String> {
    let name = input.name.trim();
    let content = input.content.trim();
    if name.is_empty() {
        return Err("name is required".to_string());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("name longer than {MAX_NAME_CHARS} chars"));
    }
    if content.is_empty() {
        return Err("content is required".to_string());
    }
    if content.len() > MAX_CONTENT_BYTES {
        return Err(format!(
            "content longer than {MAX_CONTENT_BYTES} bytes (got {})",
            content.len()
        ));
    }
    if scrub_secrets && contains_secret(content) {
        return Err(
            "refusing to save — content looks like it contains a secret (API key, token, or \
             private key). Paste just the durable fact instead."
                .to_string(),
        );
    }
    Ok(())
}

fn upsert_in(memories: &mut Vec<Memory>, input: MemoryInput) -> Result<Memory, String> {
    let name = input.name.trim().to_string();
    let content = input.content.trim().to_string();
    let kind = input
        .kind
        .as_ref()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty());
    let now_ts = now();

    if let Some(ref id) = input.id {
        if let Some(existing) = memories.iter_mut().find(|m| &m.id == id) {
            existing.name = name;
            existing.content = content;
            existing.kind = kind;
            existing.updated_at = now_ts;
            if input.source.is_some() {
                existing.source = input.source.clone();
            }
            return Ok(existing.clone());
        }
    }

    if memories.len() >= MAX_MEMORIES {
        return Err(format!(
            "memory limit reached ({MAX_MEMORIES}) — delete one before adding another"
        ));
    }
    let projected = total_bytes(memories) + name.len() + content.len();
    if projected > MAX_TOTAL_BYTES {
        return Err(format!(
            "memory store is full ({projected} bytes would exceed {MAX_TOTAL_BYTES})"
        ));
    }

    let memory = Memory {
        id: new_id(),
        name,
        content,
        kind,
        created_at: now_ts,
        updated_at: now_ts,
        source: input.source,
    };
    memories.push(memory.clone());
    Ok(memory)
}

/* ================================================================
 * Tauri commands
 * ================================================================ */

#[tauri::command]
pub fn memories_list(app: AppHandle) -> Result<Vec<Memory>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(load(&data_dir))
}

#[tauri::command]
pub fn memory_save(app: AppHandle, memory: MemoryInput) -> Result<Memory, String> {
    validate_input(&memory, false)?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut memories = load(&data_dir);
    let saved = upsert_in(&mut memories, memory)?;
    save_all(&data_dir, &memories)?;
    Ok(saved)
}

#[tauri::command]
pub fn memory_delete(app: AppHandle, id: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut memories = load(&data_dir);
    let before = memories.len();
    memories.retain(|m| m.id != id);
    if memories.len() == before {
        return Err(format!("no memory with id {id}"));
    }
    save_all(&data_dir, &memories)
}

/// Agent-invoked save. Goes through the same audit bracket as the other
/// tool commands in `tools.rs`, and runs the secret scrubber.
#[tauri::command]
pub fn memory_tool_save(
    app: AppHandle,
    name: String,
    content: String,
    kind: Option<String>,
    source: Option<String>,
) -> Result<Memory, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let args_summary = json!({
        "name": truncate_for_audit(&name, 80),
        "kind": kind,
        "source": source,
        "content_bytes": content.len(),
    })
    .to_string();
    let preset = current_preset_name(&app);
    let ctx = audit::start_log(&data_dir, "save_memory", preset, None, &args_summary)?;

    let input = MemoryInput {
        id: None,
        name,
        content,
        kind,
        source,
    };
    let result = (|| -> Result<Memory, String> {
        validate_input(&input, true)?;
        let mut memories = load(&data_dir);
        let saved = upsert_in(&mut memories, input)?;
        save_all(&data_dir, &memories)?;
        Ok(saved)
    })();

    let (status, bytes) = match &result {
        Ok(m) => ("success", m.content.len()),
        Err(_) => ("error", 0),
    };
    audit::end_log(&data_dir, &ctx, status, bytes);
    result
}

fn truncate_for_audit(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max_chars).collect();
        out.push('…');
        out
    }
}

fn current_preset_name(app: &AppHandle) -> &'static str {
    use crate::permissions::{Preset, PresetState};
    use tauri::State;
    let preset_state: State<'_, PresetState> = app.state();
    let preset = *preset_state.0.lock().unwrap();
    match preset {
        Preset::ReadOnly => "read_only",
        Preset::Standard => "standard",
        Preset::Trusted => "trusted",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_input(name: &str, content: &str) -> MemoryInput {
        MemoryInput {
            id: None,
            name: name.to_string(),
            content: content.to_string(),
            kind: None,
            source: None,
        }
    }

    #[test]
    fn load_missing_returns_empty() {
        let dir = tempdir().unwrap();
        assert!(load(dir.path()).is_empty());
    }

    #[test]
    fn save_and_reload_round_trip() {
        let dir = tempdir().unwrap();
        let mut memories: Vec<Memory> = Vec::new();
        let saved = upsert_in(&mut memories, sample_input("pg", "uses postgres")).unwrap();
        save_all(dir.path(), &memories).unwrap();
        let reloaded = load(dir.path());
        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded[0].id, saved.id);
        assert_eq!(reloaded[0].content, "uses postgres");
    }

    #[test]
    fn upsert_replaces_existing() {
        let mut memories: Vec<Memory> = Vec::new();
        let first = upsert_in(&mut memories, sample_input("lang", "rust")).unwrap();
        let mut update = sample_input("lang", "rust and typescript");
        update.id = Some(first.id.clone());
        let second = upsert_in(&mut memories, update).unwrap();
        assert_eq!(memories.len(), 1);
        assert_eq!(second.id, first.id);
        assert_eq!(memories[0].content, "rust and typescript");
    }

    #[test]
    fn validate_rejects_empty_name() {
        assert!(validate_input(&sample_input("", "x"), false).is_err());
        assert!(validate_input(&sample_input("   ", "x"), false).is_err());
    }

    #[test]
    fn validate_rejects_oversize_content() {
        let big = "x".repeat(MAX_CONTENT_BYTES + 1);
        assert!(validate_input(&sample_input("x", &big), false).is_err());
    }

    #[test]
    fn secret_scrubber_blocks_obvious() {
        let input = sample_input("key", "my key is sk-abc1234567890XYZ");
        assert!(validate_input(&input, true).is_err());
    }

    #[test]
    fn secret_scrubber_allows_manual_save() {
        let input = sample_input("key", "my key is sk-abc1234567890XYZ");
        // manual saves pass scrub_secrets=false intentionally
        assert!(validate_input(&input, false).is_ok());
    }

    #[test]
    fn cap_rejects_over_count() {
        let mut memories = Vec::new();
        for i in 0..MAX_MEMORIES {
            let input = sample_input(&format!("m{i}"), "x");
            upsert_in(&mut memories, input).unwrap();
        }
        let err = upsert_in(&mut memories, sample_input("overflow", "x")).unwrap_err();
        assert!(err.contains("limit"), "got: {err}");
    }
}
