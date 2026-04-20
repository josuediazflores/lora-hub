import { invoke } from "@tauri-apps/api/core";

export type AttachmentKind =
  | "text"
  | "pdf"
  | "image"
  | "docx"
  | "rtf"
  | "xlsx"
  | "pptx"
  | "unsupported";

export type Attachment = {
  /** Client-side id so React can key the list. */
  id: string;
  kind: AttachmentKind;
  name: string;
  size: number;
  mime: string;
  /** Extracted text for text/pdf kinds. */
  text?: string;
  /** Data URL for image kinds — lets the composer chip render a thumbnail. */
  data_url?: string;
  truncated?: boolean;
  /** When kind === "unsupported", a one-line reason. */
  reason?: string;
};

type ReadAttachmentResponse = Omit<Attachment, "id">;

export async function readAttachment(path: string): Promise<Attachment> {
  const payload = await invoke<ReadAttachmentResponse>("read_attachment", {
    path,
  });
  return { id: crypto.randomUUID(), ...payload };
}

/** Append attachment content to a user message so the model sees it inline.
 * Keep the fencing consistent so multiple attachments don't blur together. */
export function formatAttachmentsForPrompt(
  attachments: Attachment[],
): string {
  if (attachments.length === 0) return "";
  const blocks = attachments.map((a) => {
    const header = `[attachment: ${a.name}]`;
    if (
      a.kind === "text" ||
      a.kind === "pdf" ||
      a.kind === "docx" ||
      a.kind === "rtf" ||
      a.kind === "xlsx" ||
      a.kind === "pptx"
    ) {
      const lang = languageHintFor(a.name, a.mime);
      const fence = "```";
      return `${header}\n${fence}${lang}\n${a.text ?? ""}\n${fence}`;
    }
    if (a.kind === "image") {
      return `${header}\n(image ${a.mime}; VLM not yet wired — describe what you need and the user will transcribe if helpful)`;
    }
    return `${header}\n(unsupported: ${a.reason ?? "unknown"})`;
  });
  return "\n\n" + blocks.join("\n\n");
}

function languageHintFor(name: string, mime: string): string {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "swift":
      return "swift";
    case "kt":
    case "kts":
      return "kotlin";
    case "java":
      return "java";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "hpp":
      return "cpp";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "sql":
      return "sql";
    case "json":
      return "json";
    case "toml":
      return "toml";
    case "yaml":
    case "yml":
      return "yaml";
    case "md":
      return "markdown";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "csv":
      return "csv";
    case "pdf":
      return "";
    case "xlsx":
      // We flatten xlsx to tab-separated rows per sheet; `csv` gives a
      // reasonable syntax highlight in the rendered transcript.
      return "csv";
    case "docx":
    case "rtf":
    case "pptx":
      return "";
    default:
      break;
  }
  if (mime.startsWith("text/")) return "";
  return "";
}
