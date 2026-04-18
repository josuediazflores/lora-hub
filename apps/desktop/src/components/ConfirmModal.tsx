import { AlertTriangle } from "lucide-react";

type Props = {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  title,
  body,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-app-border bg-app-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-app-border px-4 py-2.5">
          <AlertTriangle
            size={13}
            className="text-app-accent"
            strokeWidth={2}
          />
          <h2 className="text-[14px] font-semibold text-app-text">{title}</h2>
        </header>
        <div className="px-4 py-4 text-[13px] leading-[1.55] text-app-text-muted">
          {body}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-app-border px-4 py-2.5">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1 font-mono text-[11px] text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-app-accent px-3 py-1 font-mono text-[11px] font-medium text-app-bg hover:bg-app-accent-soft"
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
