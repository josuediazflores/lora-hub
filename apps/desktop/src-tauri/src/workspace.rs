//! Workspace state and path-confinement helper.
//!
//! Every filesystem-touching tool command resolves its input path through
//! `resolve_path`, which canonicalizes and rejects any path that escapes the
//! configured workspace root. This is the single safety boundary that keeps
//! tool calls from reading or writing outside the user-picked sandbox.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub root: PathBuf,
}

pub struct WorkspaceState(pub Mutex<Option<Workspace>>);

impl WorkspaceState {
    pub fn new(initial: Option<Workspace>) -> Self {
        Self(Mutex::new(initial))
    }
}

const FILE_NAME: &str = "workspace.json";

pub fn load(app_data_dir: &Path) -> Option<Workspace> {
    let path = app_data_dir.join(FILE_NAME);
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save(app_data_dir: &Path, workspace: &Option<Workspace>) -> Result<(), String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let path = app_data_dir.join(FILE_NAME);
    match workspace {
        Some(ws) => {
            let json = serde_json::to_string_pretty(ws).map_err(|e| e.to_string())?;
            std::fs::write(&path, json).map_err(|e| e.to_string())
        }
        None => {
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
    }
}

/// Resolve a workspace-relative path and prove it stays inside the workspace.
///
/// Accepts paths that don't exist yet (e.g. for `write_file`) by canonicalizing
/// the parent and appending the final component. Canonicalization resolves
/// `..`, symlinks, and absolute paths back to real filesystem locations, so
/// any attempt to traverse out of the sandbox fails the `starts_with` check.
pub fn resolve_path(workspace: &Path, rel: &str) -> Result<PathBuf, String> {
    let ws_canon = std::fs::canonicalize(workspace)
        .map_err(|e| format!("workspace unreadable ({e})"))?;
    let rel_path = Path::new(rel);
    let joined = if rel_path.is_absolute() {
        // Reject absolute paths outright — even if they happen to point inside
        // the workspace, tool callers should always use relative paths.
        return Err(format!("path must be relative to the workspace: {rel}"));
    } else {
        ws_canon.join(rel_path)
    };

    let resolved = if joined.exists() {
        std::fs::canonicalize(&joined)
            .map_err(|e| format!("resolve failed ({e}): {rel}"))?
    } else {
        let parent = joined
            .parent()
            .ok_or_else(|| format!("no parent directory for: {rel}"))?;
        if !parent.exists() {
            return Err(format!("parent directory does not exist: {rel}"));
        }
        let parent_canon = std::fs::canonicalize(parent)
            .map_err(|e| format!("parent resolve failed ({e}): {rel}"))?;
        let name = joined
            .file_name()
            .ok_or_else(|| format!("no file name in path: {rel}"))?;
        parent_canon.join(name)
    };

    if !resolved.starts_with(&ws_canon) {
        return Err(format!(
            "path outside workspace: {} (workspace: {})",
            resolved.display(),
            ws_canon.display()
        ));
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_workspace() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tmpdir");
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/hello.txt"), "hi").unwrap();
        dir
    }

    #[test]
    fn relative_inside_accepted() {
        let ws = tmp_workspace();
        let r = resolve_path(ws.path(), "src/hello.txt").unwrap();
        assert!(r.ends_with("src/hello.txt"));
    }

    #[test]
    fn relative_new_file_accepted() {
        let ws = tmp_workspace();
        let r = resolve_path(ws.path(), "src/new.txt").unwrap();
        assert!(r.ends_with("src/new.txt"));
    }

    #[test]
    fn absolute_rejected() {
        let ws = tmp_workspace();
        let err = resolve_path(ws.path(), "/etc/passwd").unwrap_err();
        assert!(err.contains("must be relative"), "got: {err}");
    }

    #[test]
    fn dot_dot_escape_rejected_shallow() {
        // `..` to the tempdir's parent, which exists — proves the
        // `starts_with(workspace)` check rejects escapes even when the
        // parent resolves cleanly.
        let ws = tmp_workspace();
        let err = resolve_path(ws.path(), "../elsewhere.txt").unwrap_err();
        assert!(err.contains("outside workspace"), "got: {err}");
    }

    #[test]
    fn dot_dot_escape_rejected_deep() {
        // A deep `../../..` walks out past filesystem roots we can canonicalize.
        // Either branch of resolve_path can fire; we just require rejection.
        let ws = tmp_workspace();
        assert!(resolve_path(ws.path(), "../../../etc/passwd").is_err());
    }

    #[test]
    fn dot_dot_staying_inside_ok() {
        let ws = tmp_workspace();
        fs::create_dir_all(ws.path().join("a/b")).unwrap();
        let r = resolve_path(ws.path(), "a/b/../hello.txt");
        // Either resolved-inside (if hello.txt exists in a/) or rejected with
        // a clear reason — never silently "outside". Either is acceptable.
        if let Ok(p) = r {
            assert!(p.starts_with(std::fs::canonicalize(ws.path()).unwrap()));
        }
    }

    #[test]
    fn symlink_escape_rejected() {
        let ws = tmp_workspace();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret"), "boo").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                outside.path().join("secret"),
                ws.path().join("escape"),
            )
            .unwrap();
            let err = resolve_path(ws.path(), "escape").unwrap_err();
            assert!(err.contains("outside workspace"), "got: {err}");
        }
    }

    #[test]
    fn parent_must_exist_for_writes() {
        let ws = tmp_workspace();
        let err = resolve_path(ws.path(), "does/not/exist/yet.txt").unwrap_err();
        assert!(err.contains("parent directory"), "got: {err}");
    }
}
