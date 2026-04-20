//! Read a file from disk (typically one the user drag-dropped onto the
//! window) and return a payload the model can see inside its next turn.
//!
//! Supported kinds:
//!   * `text`   — any UTF-8-decodable file (source code, markdown, JSON,
//!                CSV, plain text, etc.). Capped at 2 MB so one rogue
//!                5-GB log doesn't blow up the context in a single turn.
//!   * `pdf`    — extracted plain text via the `pdf-extract` crate.
//!                Capped at 5 MB PDF input.
//!   * `docx`   — Word document, text pulled from `word/document.xml`
//!                via the `docx-rs` crate. Capped at 5 MB.
//!   * `rtf`    — Rich Text, stripped to plain text via `rtf-parser`.
//!                Capped at 2 MB.
//!   * `xlsx`   — Excel workbook, flattened per-sheet to tab-separated
//!                rows via `calamine`. Capped at 10 MB file input.
//!   * `pptx`   — PowerPoint, slides parsed from the zip archive's
//!                `ppt/slides/slide*.xml` with quick-xml. Capped at 10 MB.
//!   * `image`  — returned as a base64 data-URL so the frontend can
//!                render a thumbnail. The model itself doesn't see image
//!                bytes yet (no VLM wired); we emit a `[attached image]`
//!                stub in the prompt so conversations stay coherent.
//!
//! For all text-extracting kinds the extracted string is truncated at
//! `TEXT_CAP_BYTES` so the prompt budget stays bounded regardless of
//! source size. Anything else comes back as `unsupported` with a short
//! reason so the UI can show a friendly error chip.

use std::io::{Cursor, Read};
use std::path::PathBuf;

use base64::Engine;
use serde::Serialize;

const TEXT_CAP_BYTES: usize = 2 * 1024 * 1024;
const PDF_CAP_BYTES: usize = 5 * 1024 * 1024;
const IMAGE_CAP_BYTES: usize = 10 * 1024 * 1024;
const DOCX_CAP_BYTES: usize = 5 * 1024 * 1024;
const RTF_CAP_BYTES: usize = 2 * 1024 * 1024;
const XLSX_CAP_BYTES: usize = 10 * 1024 * 1024;
const PPTX_CAP_BYTES: usize = 10 * 1024 * 1024;

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

    // Office documents: extract plaintext so the model sees the content.
    // Each helper returns a fully-formed payload (including the
    // `unsupported` branch on parse failure), so we return early.
    if ext == "docx" {
        return Ok(extract_docx(name, &bytes, size, mime));
    }
    if ext == "rtf" {
        return Ok(extract_rtf(name, &bytes, size, mime));
    }
    if ext == "xlsx" {
        return Ok(extract_xlsx(name, &bytes, size, mime));
    }
    if ext == "pptx" {
        return Ok(extract_pptx(name, &bytes, size, mime));
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

/// Apply the shared text-cap / truncation logic and box the result into
/// an `AttachmentPayload`. Kept as one helper so every text-extracting
/// format clips identically — the prompt budget protection is central.
fn finalize_text_payload(
    text: String,
    kind: &'static str,
    name: String,
    size: u64,
    mime: String,
) -> AttachmentPayload {
    let truncated = text.len() > TEXT_CAP_BYTES;
    let body = if truncated {
        let mut cut = TEXT_CAP_BYTES;
        while cut > 0 && !text.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}\n\n…[truncated at {} bytes]", &text[..cut], cut)
    } else {
        text
    };
    AttachmentPayload {
        kind,
        name,
        size,
        mime,
        text: Some(body),
        data_url: None,
        truncated,
        reason: None,
    }
}

fn extract_docx(name: String, bytes: &[u8], size: u64, mime: String) -> AttachmentPayload {
    if bytes.len() > DOCX_CAP_BYTES {
        return unsupported(
            name,
            size,
            mime,
            format!(
                "docx larger than {} MB — not attached",
                DOCX_CAP_BYTES / (1024 * 1024)
            ),
        );
    }
    let docx = match docx_rs::read_docx(bytes) {
        Ok(d) => d,
        Err(e) => return unsupported(name, size, mime, format!("docx: {e}")),
    };
    let mut paragraphs: Vec<String> = Vec::new();
    walk_docx_children(&docx.document.children, &mut paragraphs);
    let full = paragraphs.join("\n\n");
    finalize_text_payload(full, "docx", name, size, mime)
}

/// Walk a docx document tree and collect per-paragraph plain text.
/// We drill into Paragraphs → Runs → Text, and into Tables → Rows →
/// Cells → Paragraphs. Anything else (bookmarks, comments, sectPr) is
/// ignored — we only want the reading-order body text.
fn walk_docx_children(children: &[docx_rs::DocumentChild], out: &mut Vec<String>) {
    for child in children {
        match child {
            docx_rs::DocumentChild::Paragraph(p) => {
                let mut line = String::new();
                collect_paragraph_text(p, &mut line);
                if !line.trim().is_empty() {
                    out.push(line);
                }
            }
            docx_rs::DocumentChild::Table(t) => {
                for row in &t.rows {
                    let docx_rs::TableChild::TableRow(tr) = row;
                    let mut cells: Vec<String> = Vec::new();
                    for cell in &tr.cells {
                        let docx_rs::TableRowChild::TableCell(tc) = cell;
                        let mut cell_text = String::new();
                        for cc in &tc.children {
                            if let docx_rs::TableCellContent::Paragraph(p) = cc {
                                let mut line = String::new();
                                collect_paragraph_text(p, &mut line);
                                if !line.is_empty() {
                                    if !cell_text.is_empty() {
                                        cell_text.push('\n');
                                    }
                                    cell_text.push_str(&line);
                                }
                            }
                        }
                        cells.push(cell_text);
                    }
                    let row_line = cells.join("\t");
                    if !row_line.trim().is_empty() {
                        out.push(row_line);
                    }
                }
            }
            _ => {}
        }
    }
}

fn collect_paragraph_text(p: &docx_rs::Paragraph, out: &mut String) {
    for pc in &p.children {
        match pc {
            docx_rs::ParagraphChild::Run(r) => {
                for rc in &r.children {
                    if let docx_rs::RunChild::Text(t) = rc {
                        out.push_str(&t.text);
                    }
                }
            }
            docx_rs::ParagraphChild::Hyperlink(h) => {
                for hc in &h.children {
                    if let docx_rs::ParagraphChild::Run(r) = hc {
                        for rc in &r.children {
                            if let docx_rs::RunChild::Text(t) = rc {
                                out.push_str(&t.text);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn extract_rtf(name: String, bytes: &[u8], size: u64, mime: String) -> AttachmentPayload {
    if bytes.len() > RTF_CAP_BYTES {
        return unsupported(
            name,
            size,
            mime,
            format!(
                "rtf larger than {} MB — not attached",
                RTF_CAP_BYTES / (1024 * 1024)
            ),
        );
    }
    let s = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => {
            // RTF is ASCII-compatible; if it isn't UTF-8 decodable we
            // fall back to lossy — consumers only need the plain text.
            return match rtf_parser::RtfDocument::try_from(
                String::from_utf8_lossy(bytes).as_ref(),
            ) {
                Ok(doc) => finalize_text_payload(doc.get_text(), "rtf", name, size, mime),
                Err(e) => unsupported(name, size, mime, format!("rtf: {e:?}")),
            };
        }
    };
    match rtf_parser::RtfDocument::try_from(s) {
        Ok(doc) => finalize_text_payload(doc.get_text(), "rtf", name, size, mime),
        Err(e) => unsupported(name, size, mime, format!("rtf: {e:?}")),
    }
}

fn extract_xlsx(name: String, bytes: &[u8], size: u64, mime: String) -> AttachmentPayload {
    use calamine::Reader;
    if bytes.len() > XLSX_CAP_BYTES {
        return unsupported(
            name,
            size,
            mime,
            format!(
                "xlsx larger than {} MB — not attached",
                XLSX_CAP_BYTES / (1024 * 1024)
            ),
        );
    }
    let mut wb: calamine::Xlsx<_> = match calamine::open_workbook_from_rs(Cursor::new(bytes)) {
        Ok(w) => w,
        Err(e) => return unsupported(name, size, mime, format!("xlsx: {e}")),
    };
    let sheet_names = wb.sheet_names().to_vec();
    let mut out = String::new();
    for sheet in &sheet_names {
        let range = match wb.worksheet_range(sheet) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if range.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str("# Sheet: ");
        out.push_str(sheet);
        out.push('\n');
        for row in range.rows() {
            let cells: Vec<String> = row.iter().map(format_xlsx_cell).collect();
            out.push_str(&cells.join("\t"));
            out.push('\n');
        }
    }
    if out.is_empty() {
        return unsupported(name, size, mime, "xlsx: no extractable text".to_string());
    }
    finalize_text_payload(out, "xlsx", name, size, mime)
}

fn format_xlsx_cell(c: &calamine::Data) -> String {
    match c {
        calamine::Data::Empty => String::new(),
        calamine::Data::String(s) => s.clone(),
        calamine::Data::Float(f) => {
            // Integer-valued floats are far more common in spreadsheets
            // than users expect; print them without the trailing `.0`.
            if f.fract() == 0.0 && f.abs() < 1e16 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        calamine::Data::Int(i) => i.to_string(),
        calamine::Data::Bool(b) => b.to_string(),
        calamine::Data::DateTime(dt) => dt.to_string(),
        calamine::Data::DateTimeIso(s) | calamine::Data::DurationIso(s) => s.clone(),
        calamine::Data::Error(e) => format!("#ERR({e:?})"),
    }
}

fn extract_pptx(name: String, bytes: &[u8], size: u64, mime: String) -> AttachmentPayload {
    if bytes.len() > PPTX_CAP_BYTES {
        return unsupported(
            name,
            size,
            mime,
            format!(
                "pptx larger than {} MB — not attached",
                PPTX_CAP_BYTES / (1024 * 1024)
            ),
        );
    }
    let mut archive = match zip::ZipArchive::new(Cursor::new(bytes)) {
        Ok(a) => a,
        Err(e) => return unsupported(name, size, mime, format!("pptx: {e}")),
    };

    let mut slides: Vec<(u32, String)> = Vec::new();
    for i in 0..archive.len() {
        let f = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let entry = f.name().to_string();
        if let Some(num) = entry
            .strip_prefix("ppt/slides/slide")
            .and_then(|rest| rest.strip_suffix(".xml"))
            .and_then(|n| n.parse::<u32>().ok())
        {
            slides.push((num, entry));
        }
    }
    slides.sort_by_key(|(n, _)| *n);

    let mut out = String::new();
    for (n, entry) in &slides {
        let mut f = match archive.by_name(entry) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let mut xml = String::new();
        if f.read_to_string(&mut xml).is_err() {
            continue;
        }
        let slide_text = match extract_drawingml_text(&xml) {
            Ok(t) => t,
            Err(e) => return unsupported(name, size, mime, format!("pptx: {e}")),
        };
        if slide_text.trim().is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&format!("# Slide {}\n{}", n, slide_text.trim_end()));
    }

    if out.is_empty() {
        return unsupported(name, size, mime, "pptx: no extractable text".to_string());
    }
    finalize_text_payload(out, "pptx", name, size, mime)
}

/// Pull text out of every `<a:t>` element in a DrawingML XML blob,
/// separating paragraphs (`<a:p>`) by newlines. Used for pptx slides.
fn extract_drawingml_text(xml: &str) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut out = String::new();
    let mut in_t = false;
    let mut buf = Vec::new();
    loop {
        match reader
            .read_event_into(&mut buf)
            .map_err(|e| format!("xml: {e}"))?
        {
            Event::Start(e) => {
                if e.name().as_ref() == b"a:t" {
                    in_t = true;
                }
            }
            Event::End(e) => {
                let n = e.name();
                let local = n.as_ref();
                if local == b"a:t" {
                    in_t = false;
                } else if local == b"a:p" {
                    // End of paragraph: newline between paragraphs for
                    // readability. We trim trailing whitespace at the
                    // caller so a dangling newline doesn't leak.
                    if !out.is_empty() && !out.ends_with('\n') {
                        out.push('\n');
                    }
                }
            }
            Event::Text(t) if in_t => {
                out.push_str(&t.unescape().map_err(|e| format!("xml: {e}"))?);
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
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
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "rtf" => "application/rtf",
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

#[cfg(test)]
mod tests {
    //! Fixtures are synthesized in-memory: we build a minimal zip/XML
    //! payload that satisfies each parser, then feed it to the matching
    //! extractor. This keeps the repo free of binary fixture files while
    //! still exercising the real parse paths.
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    const DOCX_MIME: &str =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const XLSX_MIME: &str =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const PPTX_MIME: &str =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    fn zip_with(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut buf: Vec<u8> = Vec::new();
        {
            let cursor = Cursor::new(&mut buf);
            let mut zw = ZipWriter::new(cursor);
            let opts: SimpleFileOptions =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for (name, body) in entries {
                zw.start_file(*name, opts).expect("start_file");
                zw.write_all(body.as_bytes()).expect("write_all");
            }
            zw.finish().expect("finish zip");
        }
        buf
    }

    /// Build a valid docx in-memory by delegating to docx-rs itself.
    /// Using the library's own writer guarantees the fixture structure
    /// matches exactly what its reader expects — saves us chasing an
    /// Open-XML spec we only need to exercise the walker against.
    fn build_minimal_docx(paragraphs: &[&str]) -> Vec<u8> {
        let mut docx = docx_rs::Docx::new();
        for p in paragraphs {
            docx = docx.add_paragraph(
                docx_rs::Paragraph::new()
                    .add_run(docx_rs::Run::new().add_text(*p)),
            );
        }
        let mut buf: Vec<u8> = Vec::new();
        docx.build()
            .pack(Cursor::new(&mut buf))
            .expect("docx pack");
        buf
    }

    fn build_minimal_xlsx(sheets: &[(&str, &[&[&str]])]) -> Vec<u8> {
        // One <sheet r:id="rIdN"> entry per sheet; inline strings keep
        // the file simple (no sharedStrings table).
        let mut content_types = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>"#,
        );
        for i in 1..=sheets.len() {
            content_types.push_str(&format!(
                r#"<Override PartName="/xl/worksheets/sheet{}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#,
                i
            ));
        }
        content_types.push_str("</Types>");

        let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;

        let mut workbook = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>"#,
        );
        for (i, (name, _)) in sheets.iter().enumerate() {
            let idx = i + 1;
            workbook.push_str(&format!(
                r#"<sheet name="{}" sheetId="{}" r:id="rId{}"/>"#,
                escape_xml(name),
                idx,
                idx
            ));
        }
        workbook.push_str("</sheets></workbook>");

        let mut workbook_rels = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
        );
        for i in 1..=sheets.len() {
            workbook_rels.push_str(&format!(
                r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{}.xml"/>"#,
                i, i
            ));
        }
        workbook_rels.push_str("</Relationships>");

        let mut entries: Vec<(String, String)> = vec![
            ("[Content_Types].xml".into(), content_types),
            ("_rels/.rels".into(), root_rels.to_string()),
            ("xl/workbook.xml".into(), workbook),
            ("xl/_rels/workbook.xml.rels".into(), workbook_rels),
        ];
        for (i, (_, rows)) in sheets.iter().enumerate() {
            let idx = i + 1;
            let mut sheet = String::from(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>"#,
            );
            for (row_idx, row) in rows.iter().enumerate() {
                let r = row_idx + 1;
                sheet.push_str(&format!("<row r=\"{}\">", r));
                for (col_idx, cell) in row.iter().enumerate() {
                    let col = col_letter(col_idx);
                    sheet.push_str(&format!(
                        r#"<c r="{}{}" t="inlineStr"><is><t>{}</t></is></c>"#,
                        col,
                        r,
                        escape_xml(cell)
                    ));
                }
                sheet.push_str("</row>");
            }
            sheet.push_str("</sheetData></worksheet>");
            entries.push((format!("xl/worksheets/sheet{}.xml", idx), sheet));
        }
        let borrowed: Vec<(&str, &str)> = entries
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        zip_with(&borrowed)
    }

    fn build_minimal_pptx(slides: &[&str]) -> Vec<u8> {
        // Our extractor only reads ppt/slides/slide*.xml — no need for
        // the rest of the package.
        let mut entries: Vec<(String, String)> = Vec::new();
        for (i, text) in slides.iter().enumerate() {
            let idx = i + 1;
            let xml = format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:txBody>
<a:p><a:r><a:t>{}</a:t></a:r></a:p>
</p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>"#,
                escape_xml(text)
            );
            entries.push((format!("ppt/slides/slide{}.xml", idx), xml));
        }
        let borrowed: Vec<(&str, &str)> = entries
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        zip_with(&borrowed)
    }

    fn escape_xml(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    }

    fn col_letter(mut idx: usize) -> String {
        let mut s = String::new();
        loop {
            let rem = idx % 26;
            s.insert(0, (b'A' + rem as u8) as char);
            if idx < 26 {
                break;
            }
            idx = idx / 26 - 1;
        }
        s
    }

    #[test]
    fn docx_extracts_paragraphs() {
        let bytes = build_minimal_docx(&[
            "lora-hub-docx-fixture-sentinel",
            "second paragraph with spaces",
        ]);
        let payload = extract_docx(
            "fixture.docx".to_string(),
            &bytes,
            bytes.len() as u64,
            DOCX_MIME.to_string(),
        );
        assert_eq!(
            payload.kind, "docx",
            "docx parse failed: {:?}",
            payload.reason
        );
        let text = payload.text.expect("docx text");
        assert!(
            text.contains("lora-hub-docx-fixture-sentinel"),
            "missing sentinel in: {text}"
        );
        assert!(
            text.contains("second paragraph with spaces"),
            "missing second paragraph in: {text}"
        );
        assert!(!payload.truncated);
    }

    #[test]
    fn docx_too_large_returns_unsupported() {
        let bytes = vec![0u8; DOCX_CAP_BYTES + 1];
        let payload = extract_docx(
            "big.docx".to_string(),
            &bytes,
            bytes.len() as u64,
            DOCX_MIME.to_string(),
        );
        assert_eq!(payload.kind, "unsupported");
        assert!(payload
            .reason
            .expect("reason")
            .contains("docx larger than"));
    }

    #[test]
    fn docx_parse_failure_returns_unsupported() {
        // Not a valid zip at all — docx-rs should surface an error.
        let bytes = b"definitely not a docx".to_vec();
        let payload = extract_docx(
            "junk.docx".to_string(),
            &bytes,
            bytes.len() as u64,
            DOCX_MIME.to_string(),
        );
        assert_eq!(payload.kind, "unsupported");
    }

    #[test]
    fn rtf_strips_control_words() {
        let rtf = r"{\rtf1\ansi\deff0 {\fonttbl {\f0 Courier;}}lora-hub-rtf-fixture-sentinel\par second line}";
        let bytes = rtf.as_bytes().to_vec();
        let payload = extract_rtf(
            "fixture.rtf".to_string(),
            &bytes,
            bytes.len() as u64,
            "application/rtf".to_string(),
        );
        assert_eq!(payload.kind, "rtf");
        let text = payload.text.expect("rtf text");
        assert!(
            text.contains("lora-hub-rtf-fixture-sentinel"),
            "missing sentinel in: {text}"
        );
        assert!(!text.contains(r"\rtf1"), "control words leaked: {text}");
        assert!(!text.contains(r"\par"), "control words leaked: {text}");
    }

    #[test]
    fn xlsx_flattens_sheets() {
        let rows_a: &[&[&str]] = &[
            &["name", "value"],
            &["lora-hub-xlsx-sentinel", "42"],
        ];
        let rows_b: &[&[&str]] = &[&["other", "cell"]];
        let bytes = build_minimal_xlsx(&[("Alpha", rows_a), ("Beta", rows_b)]);
        let payload = extract_xlsx(
            "fixture.xlsx".to_string(),
            &bytes,
            bytes.len() as u64,
            XLSX_MIME.to_string(),
        );
        assert_eq!(payload.kind, "xlsx");
        let text = payload.text.expect("xlsx text");
        assert!(text.contains("# Sheet: Alpha"), "missing sheet header: {text}");
        assert!(text.contains("# Sheet: Beta"), "missing sheet header: {text}");
        assert!(
            text.contains("lora-hub-xlsx-sentinel"),
            "missing sentinel: {text}"
        );
        // Tab-separated rows.
        assert!(
            text.contains("name\tvalue"),
            "expected tab-separated header row: {text}"
        );
    }

    #[test]
    fn pptx_extracts_slide_text() {
        let bytes = build_minimal_pptx(&[
            "lora-hub-pptx-slide-one",
            "lora-hub-pptx-slide-two",
        ]);
        let payload = extract_pptx(
            "fixture.pptx".to_string(),
            &bytes,
            bytes.len() as u64,
            PPTX_MIME.to_string(),
        );
        assert_eq!(payload.kind, "pptx");
        let text = payload.text.expect("pptx text");
        assert!(text.contains("# Slide 1"), "missing slide 1 marker: {text}");
        assert!(text.contains("# Slide 2"), "missing slide 2 marker: {text}");
        assert!(
            text.contains("lora-hub-pptx-slide-one"),
            "missing slide 1 sentinel: {text}"
        );
        assert!(
            text.contains("lora-hub-pptx-slide-two"),
            "missing slide 2 sentinel: {text}"
        );
    }

    #[test]
    fn extracted_text_is_truncated_at_cap() {
        // Build a docx whose extracted text exceeds TEXT_CAP_BYTES, then
        // confirm the payload is marked truncated with the trailer.
        let big = "x".repeat(TEXT_CAP_BYTES + 1024);
        let bytes = build_minimal_docx(&[big.as_str()]);
        let payload = extract_docx(
            "huge.docx".to_string(),
            &bytes,
            bytes.len() as u64,
            DOCX_MIME.to_string(),
        );
        assert_eq!(payload.kind, "docx");
        assert!(payload.truncated, "expected truncated flag");
        let text = payload.text.expect("docx text");
        assert!(text.contains("…[truncated"), "missing truncation trailer");
        assert!(text.len() < TEXT_CAP_BYTES + 128);
    }

    #[test]
    fn unknown_binary_still_rejected_via_read_attachment() {
        // End-to-end sanity: a random binary .zip hits read_attachment
        // and should still bounce off the utf-8 fallback with our
        // long-standing "unsupported" reason. Guards against accidentally
        // treating every zip as an office document.
        let bytes = zip_with(&[("irrelevant.bin", "\x00\x01\x02not-office")]);
        let tmp = tempfile::NamedTempFile::new().expect("tmp");
        std::fs::write(tmp.path(), &bytes).expect("write tmp");
        let mut pathbuf = tmp.path().to_path_buf();
        pathbuf.set_extension("zip");
        std::fs::rename(tmp.path(), &pathbuf).expect("rename to .zip");
        let payload = read_attachment(pathbuf.to_string_lossy().into_owned())
            .expect("read_attachment");
        let _ = std::fs::remove_file(&pathbuf);
        assert_eq!(payload.kind, "unsupported");
        assert!(payload
            .reason
            .expect("reason")
            .contains("binary file"));
    }
}
