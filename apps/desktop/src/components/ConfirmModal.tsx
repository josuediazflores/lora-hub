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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-app-border bg-app-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-app-border px-5 py-3">
          <AlertTriangle size={14} className="text-app-accent" />
          <h2 className="text-sm font-semibold">{title}</h2>
        </header>
        <div className="px-5 py-5 text-sm text-app-text-muted">{body}</div>
        <footer className="flex items-center justify-end gap-2 border-t border-app-border px-5 py-3 text-xs">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-app-accent px-3 py-1.5 font-medium text-app-bg hover:bg-app-accent/90"
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
