//! Permission presets and command lists.
//!
//! The preset is the baseline: each tool checks whether its operation is
//! allowed under the current preset. Risky calls that require a per-call
//! live prompt are marked here; the prompt UI itself lives in a later slice.

use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Copy, Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    #[default]
    ReadOnly,
    Standard,
    Trusted,
}

pub struct PresetState(pub Mutex<Preset>);

impl PresetState {
    pub fn new(initial: Preset) -> Self {
        Self(Mutex::new(initial))
    }
}

const FILE_NAME: &str = "permissions.json";

pub fn load(app_data_dir: &Path) -> Preset {
    let path = app_data_dir.join(FILE_NAME);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app_data_dir: &Path, preset: Preset) -> Result<(), String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let path = app_data_dir.join(FILE_NAME);
    let json = serde_json::to_string(&preset).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Commands allowed under Standard preset without a live prompt.
/// Anything not on this list is denied under Standard; Trusted allows it
/// (aside from ALWAYS_DENY below).
pub const STANDARD_ALLOWLIST: &[&str] = &[
    "ls", "cat", "head", "tail", "wc", "file", "echo", "pwd", "whoami",
    "date", "uname", "which", "find", "grep", "rg", "tree", "stat",
    "git", "node", "deno", "bun", "python", "python3",
    "npm", "pnpm", "yarn", "cargo", "rustc", "go",
    "jq", "awk", "sed", "cut", "sort", "uniq", "diff",
];

/// Commands that are denied even under Trusted until the live-prompt UI ships.
/// Once prompts exist, these move to a "requires_prompt" list instead.
pub const ALWAYS_DENY: &[&str] = &[
    "rm", "rmdir",
    "sudo", "su", "doas",
    "launchctl", "systemctl", "service",
    "dd", "mkfs", "fdisk", "parted",
    "shutdown", "reboot", "halt", "poweroff",
    "kill", "killall", "pkill",
    "chmod", "chown", "chgrp",
    "mv",   // a moved file can escape the workspace via symlinks; deferred
    "ln",   // no user-created symlinks until we audit resolve_path behavior
];

pub fn is_allowed_command(cmd: &str, preset: Preset) -> Result<(), String> {
    if preset == Preset::ReadOnly {
        return Err("run_command is not allowed under the Read-only preset".into());
    }
    let bare = cmd.split('/').last().unwrap_or(cmd);
    if ALWAYS_DENY.contains(&bare) {
        return Err(format!(
            "'{cmd}' is in the deny list and cannot run without a live confirmation (coming soon)"
        ));
    }
    if preset == Preset::Standard && !STANDARD_ALLOWLIST.contains(&bare) {
        return Err(format!(
            "'{cmd}' is not in the Standard preset allowlist; switch to Trusted"
        ));
    }
    Ok(())
}

pub fn is_allowed_http(method: &str, preset: Preset) -> Result<(), String> {
    let m = method.to_ascii_uppercase();
    if preset == Preset::ReadOnly && m != "GET" {
        return Err(format!(
            "http {m} is not allowed under the Read-only preset; switch to Standard or Trusted"
        ));
    }
    Ok(())
}

pub fn is_allowed_write(preset: Preset) -> Result<(), String> {
    if preset == Preset::ReadOnly {
        return Err("write_file is not allowed under the Read-only preset".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_denies_all_commands() {
        assert!(is_allowed_command("ls", Preset::ReadOnly).is_err());
    }

    #[test]
    fn standard_allows_allowlist() {
        assert!(is_allowed_command("ls", Preset::Standard).is_ok());
        assert!(is_allowed_command("git", Preset::Standard).is_ok());
    }

    #[test]
    fn standard_denies_offlist() {
        assert!(is_allowed_command("curl", Preset::Standard).is_err());
        assert!(is_allowed_command("wget", Preset::Standard).is_err());
    }

    #[test]
    fn trusted_allows_offlist() {
        assert!(is_allowed_command("curl", Preset::Trusted).is_ok());
    }

    #[test]
    fn always_deny_blocks_even_trusted() {
        for cmd in ["rm", "sudo", "shutdown"] {
            assert!(is_allowed_command(cmd, Preset::Trusted).is_err(), "{cmd}");
        }
    }

    #[test]
    fn always_deny_matches_basename() {
        assert!(is_allowed_command("/bin/rm", Preset::Trusted).is_err());
        assert!(is_allowed_command("/usr/bin/sudo", Preset::Trusted).is_err());
    }

    #[test]
    fn http_rules() {
        assert!(is_allowed_http("GET", Preset::ReadOnly).is_ok());
        assert!(is_allowed_http("POST", Preset::ReadOnly).is_err());
        assert!(is_allowed_http("POST", Preset::Standard).is_ok());
    }
}
