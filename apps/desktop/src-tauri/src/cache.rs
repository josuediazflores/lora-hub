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

#[tauri::command]
pub fn delete_cached_hf_model(hf_repo: String) -> Result<(), String> {
    let Some(home) = dirs::home_dir() else {
        return Err("no home dir".into());
    };
    let (org, repo) = hf_repo
        .split_once('/')
        .ok_or_else(|| format!("invalid hf_repo (expected org/repo): {hf_repo}"))?;
    // HF's slug grammar permits letters, digits, `.`, `-`, `_` only. Reject
    // anything that could form a path-traversal sequence (`..`, `/`, `\`)
    // or any other shell metacharacter — `.join()` in Rust will follow
    // slashes inside a single segment, so the regex is the real guard.
    static SEG_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let seg_re = SEG_RE.get_or_init(|| regex::Regex::new(r"^[A-Za-z0-9._-]+$").unwrap());
    if !seg_re.is_match(org) || !seg_re.is_match(repo) || org == ".." || repo == ".." {
        return Err(format!("invalid hf_repo segment: {hf_repo}"));
    }
    let dir_name = format!("models--{org}--{repo}");
    let cache_root = home
        .join(".cache")
        .join("huggingface")
        .join("hub");
    let path = cache_root.join(&dir_name);
    if !path.exists() {
        return Ok(());
    }
    // Belt-and-suspenders: refuse to delete anything outside the HF cache
    // root. Canonicalize to defeat symlinks pointing elsewhere.
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("canonicalize {dir_name}: {e}"))?;
    let cache_canonical = cache_root
        .canonicalize()
        .map_err(|e| format!("canonicalize cache root: {e}"))?;
    if !canonical.starts_with(&cache_canonical) {
        return Err(format!(
            "refusing to delete {dir_name}: resolves outside HF cache"
        ));
    }
    std::fs::remove_dir_all(&path).map_err(|e| format!("remove {dir_name}: {e}"))
}
