import type { Attachment, AttachmentKind } from "../lib/attachments";

/** Index-card render used in the chat transcript. Compact, fixed-width
 * tile showing filename + a type badge so an attached file reads as a
 * discrete object rather than the giant inlined body it used to be.
 *
 * Image attachments replace the filename area with the thumbnail so the
 * preview itself is the card's content. */
export function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const isError = attachment.kind === "unsupported";
  const isImage = attachment.kind === "image" && !!attachment.data_url;
  const badge = badgeFor(attachment.kind);

  return (
    <div
      className={`flex w-[180px] flex-col gap-2 rounded-lg border p-2.5 ${
        isError
          ? "border-red-500/40 bg-red-500/5"
          : "border-app-border bg-app-surface"
      }`}
      title={attachment.name}
    >
      {isImage ? (
        <img
          src={attachment.data_url!}
          alt={attachment.name}
          className="aspect-[4/3] w-full rounded object-cover"
        />
      ) : null}
      <div
        className={`flex-1 break-all text-[12px] leading-[1.35] ${
          isError ? "text-red-400" : "text-app-text"
        }`}
      >
        {attachment.name}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded border border-app-border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-app-text-muted">
          {badge}
        </span>
        {attachment.truncated ? (
          <span className="font-mono text-[9.5px] text-app-text-faint">
            truncated
          </span>
        ) : null}
      </div>
    </div>
  );
}

function badgeFor(kind: AttachmentKind): string {
  switch (kind) {
    case "docx":
      return "DOCX";
    case "pdf":
      return "PDF";
    case "rtf":
      return "RTF";
    case "xlsx":
      return "XLSX";
    case "pptx":
      return "PPTX";
    case "text":
      return "TEXT";
    case "image":
      return "IMG";
    case "unsupported":
      return "?";
  }
}
