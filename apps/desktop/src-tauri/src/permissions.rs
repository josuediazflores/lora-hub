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

/// Reject URLs that would let an agent reach the user's loopback,
/// link-local, or RFC-1918 networks. Cloud-metadata IP (169.254.169.254)
/// is the highest-stakes target — a prompt-injected page asking the
/// model to fetch it would otherwise harvest cloud creds on a hosted
/// dev box. Resolves the host once (DNS rebind is partially mitigated
/// by the second-resolve in reqwest, but the worst-known endpoints are
/// caught here).
pub async fn is_allowed_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("bad url: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("only http(s) URLs are allowed (got {scheme})"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "url has no host".to_string())?;
    let port = parsed.port_or_known_default().unwrap_or(80);
    let addrs = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("resolve {host}: {e}"))?;
    for addr in addrs {
        let ip = addr.ip();
        if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
            return Err(format!("blocked IP {ip} (loopback/unspecified/multicast)"));
        }
        match ip {
            std::net::IpAddr::V4(v4) => {
                if v4.octets() == [169, 254, 169, 254] {
                    return Err("blocked: cloud metadata IP".into());
                }
                if v4.is_link_local() || v4.is_private() {
                    return Err(format!("blocked private IP {v4}"));
                }
            }
            std::net::IpAddr::V6(v6) => {
                if v6.is_loopback() || v6.is_unspecified() {
                    return Err(format!("blocked IP {v6}"));
                }
                let segments = v6.segments();
                // fc00::/7 (unique local) and fe80::/10 (link-local).
                if (segments[0] & 0xfe00) == 0xfc00 || (segments[0] & 0xffc0) == 0xfe80 {
                    return Err(format!("blocked private IPv6 {v6}"));
                }
            }
        }
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
