import { Paperclip, X } from "lucide-react";
import type { Attachment } from "../lib/attachments";

/** Attachment preview used in the composer: thumbnail for images,
 * document-glyph + filename for everything else. Truncation and error
 * states are shown in the subtitle line so you know what got through
 * and what didn't. */
export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const isError = attachment.kind === "unsupported";
  const subtitleParts: string[] = [];
  if (attachment.size > 0) subtitleParts.push(formatBytes(attachment.size));
  if (attachment.kind === "pdf") subtitleParts.push("pdf · text extracted");
  if (attachment.kind === "text") subtitleParts.push("text");
  if (attachment.kind === "image") subtitleParts.push(attachment.mime || "image");
  if (attachment.kind === "docx") subtitleParts.push("docx · text extracted");
  if (attachment.kind === "rtf") subtitleParts.push("rtf · text extracted");
  if (attachment.kind === "xlsx") subtitleParts.push("xlsx · text extracted");
  if (attachment.kind === "pptx") subtitleParts.push("pptx · slides extracted");
  if (attachment.truncated) subtitleParts.push("truncated");
  if (isError) subtitleParts.push(attachment.reason ?? "unsupported");

  return (
    <div
      className={`group flex items-center gap-2 rounded-md border px-2 py-1 ${
        isError
          ? "border-red-500/40 bg-red-500/5"
          : "border-app-border bg-app-surface"
      }`}
    >
      {attachment.kind === "image" && attachment.data_url ? (
        <img
          src={attachment.data_url}
          alt={attachment.name}
          className="h-7 w-7 rounded object-cover"
        />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded bg-app-bg">
          <Paperclip size={12} strokeWidth={1.8} className="text-app-text-faint" />
        </div>
      )}
      <div className="min-w-0 max-w-[180px]">
        <div
          className={`truncate font-mono text-[11px] ${
            isError ? "text-red-400" : "text-app-text"
          }`}
          title={attachment.name}
        >
          {attachment.name}
        </div>
        {subtitleParts.length > 0 && (
          <div className="truncate font-mono text-[10px] text-app-text-faint">
            {subtitleParts.join(" · ")}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        className="rounded p-0.5 text-app-text-faint opacity-60 hover:bg-app-surface-hover hover:opacity-100"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
