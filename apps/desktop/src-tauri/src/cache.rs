//! Detect which HuggingFace models are already materialized in the
//! user's local cache (~/.cache/huggingface/hub). Used by the Models
//! view to distinguish "one click → hot-load" from "one click →
//! multi-GB download."
//!
//! Fails soft: on any I/O error we return an empty list, so the UI
//! just doesn't show cached badges rather than crashing.

#[tauri::command]
pub fn list_cached_hf_models() -> Vec<String> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let hub = home.join(".cache").join("huggingface").join("hub");
    let entries = match std::fs::read_dir(&hub) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("models--") {
            continue;
        }
        let snapshots = entry.path().join("snapshots");
        let has_any = std::fs::read_dir(&snapshots)
            .ok()
            .and_then(|mut s| s.next())
            .is_some();
        if !has_any {
            continue;
        }
        let tail = &name["models--".len()..];
        // The first "--" splits {org}--{repo}; repo names may contain
        // single dashes but not "--", so finding the first occurrence
        // is unambiguous.
        if let Some(idx) = tail.find("--") {
            let org = &tail[..idx];
            let repo = &tail[idx + 2..];
            out.push(format!("{org}/{repo}").to_lowercase());
        }
    }
    out
}
