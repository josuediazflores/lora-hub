//! Read a file from disk (typically one the user drag-dropped onto the
//! window) and return a payload the model can see inside its next turn.
//!
//! Three kinds are supported:
//!   * `text`   — any UTF-8-decodable file (source code, markdown, JSON,
//!                CSV, plain text, etc.). Capped at 2 MB so one rogue
//!                5-GB log doesn't blow up the context in a single turn.
//!   * `pdf`    — extracted plain text via the `pdf-extract` crate.
//!                Capped at 5 MB PDF input.
//!   * `image`  — returned as a base64 data-URL so the frontend can
//!                render a thumbnail. The model itself doesn't see image
//!                bytes yet (no VLM wired); we emit a `[attached image]`
//!                stub in the prompt so conversations stay coherent.
//!
//! Anything else comes back as `unsupported` with a short reason so the
//! UI can show a friendly error chip.

use std::path::PathBuf;

use base64::Engine;
use serde::Serialize;

const TEXT_CAP_BYTES: usize = 2 * 1024 * 1024;
const PDF_CAP_BYTES: usize = 5 * 1024 * 1024;
const IMAGE_CAP_BYTES: usize = 10 * 1024 * 1024;

#[derive(Serialize)]
pub struct AttachmentPayload {
    pub kind: &'static str, // "text" | "pdf" | "image" | "unsupported"
    pub name: String,
    pub size: u64,
    pub mime: String,
    /// For text/pdf: the extracted text. Empty for image/unsupported.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// For image: a `data:<mime>;base64,<…>` URL suitable for an <img src>.
    /// None for other kinds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// True when the file was larger than our cap and we clipped the body.
    pub truncated: bool,
    /// When `kind == "unsupported"`, a short human-readable reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[tauri::command]
pub fn read_attachment(path: String) -> Result<AttachmentPayload, String> {
    let p = PathBuf::from(&path);
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    let bytes = std::fs::read(&p).map_err(|e| format!("read: {e}"))?;
    let size = bytes.len() as u64;
    let ext = p
        .extension()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let mime = guess_mime(&ext);

    // Images: don't try to decode, just base64 for rendering.
    if is_image_ext(&ext) {
        if bytes.len() > IMAGE_CAP_BYTES {
            return Ok(unsupported(
                name,
                size,
                mime,
                format!(
                    "image larger than {} MB — not attached",
                    IMAGE_CAP_BYTES / (1024 * 1024)
                ),
            ));
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(AttachmentPayload {
            kind: "image",
            name,
            size,
            mime: mime.clone(),
            text: None,
            data_url: Some(format!("data:{mime};base64,{encoded}")),
            truncated: false,
            reason: None,
        });
    }

    // PDFs: extract text.
    if ext == "pdf" {
        if bytes.len() > PDF_CAP_BYTES {
            return Ok(unsupported(
                name,
                size,
                mime,
                format!(
                    "pdf larger than {} MB — not attached",
                    PDF_CAP_BYTES / (1024 * 1024)
                ),
            ));
        }
        let extracted = pdf_extract::extract_text_from_mem(&bytes)
            .map_err(|e| format!("pdf extract: {e}"))?;
        let truncated = extracted.len() > TEXT_CAP_BYTES;
        let body = if truncated {
            extracted.chars().take(TEXT_CAP_BYTES / 4).collect::<String>()
                + "\n\n…[truncated]"
        } else {
            extracted
        };
        return Ok(AttachmentPayload {
            kind: "pdf",
            name,
            size,
            mime,
            text: Some(body),
            data_url: None,
            truncated,
            reason: None,
        });
    }

    // Text-ish: try UTF-8 decode, surrender gracefully if the bytes turn
    // out to be a binary format we don't recognize.
    match std::str::from_utf8(&bytes) {
        Ok(s) => {
            let truncated = s.len() > TEXT_CAP_BYTES;
            let body = if truncated {
                // Clip on a char boundary.
                let mut cut = TEXT_CAP_BYTES;
                while cut > 0 && !s.is_char_boundary(cut) {
                    cut -= 1;
                }
                format!("{}\n\n…[truncated at {} bytes]", &s[..cut], cut)
            } else {
                s.to_string()
            };
            Ok(AttachmentPayload {
                kind: "text",
                name,
                size,
                mime,
                text: Some(body),
                data_url: None,
                truncated,
                reason: None,
            })
        }
        Err(_) => Ok(unsupported(
            name,
            size,
            mime,
            "binary file — only text, PDF, and image attachments are supported".to_string(),
        )),
    }
}

fn guess_mime(ext: &str) -> String {
    match ext {
        "md" => "text/markdown",
        "txt" | "log" => "text/plain",
        "json" => "application/json",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "xml" => "application/xml",
        "yml" | "yaml" => "application/yaml",
        "ts" | "tsx" => "application/typescript",
        "js" | "jsx" | "mjs" | "cjs" => "application/javascript",
        "py" => "text/x-python",
        "rs" => "text/rust",
        "go" => "text/x-go",
        "swift" => "text/x-swift",
        "java" => "text/x-java",
        "kt" | "kts" => "text/x-kotlin",
        "c" | "h" => "text/x-c",
        "cpp" | "cc" | "hpp" => "text/x-c++",
        "sh" | "bash" | "zsh" => "application/x-shellscript",
        "toml" => "application/toml",
        "sql" => "application/sql",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn is_image_ext(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg")
}

fn unsupported(name: String, size: u64, mime: String, reason: String) -> AttachmentPayload {
    AttachmentPayload {
        kind: "unsupported",
        name,
        size,
        mime,
        text: None,
        data_url: None,
        truncated: false,
        reason: Some(reason),
    }
}
