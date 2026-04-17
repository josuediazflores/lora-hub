import { ShieldAlert } from "lucide-react";

type Props = {
  title: string;
  details: string;
  onAllowOnce: () => void;
  onAllowSession: () => void;
  onDeny: () => void;
};

/**
 * Inline confirmation block rendered in the chat stream when a tool call
 * would exceed the current permission preset. Shows the *exact* resolved
 * action (argv / path) so the user approves the real thing, not a summary.
 */
export function PermissionPrompt({
  title,
  details,
  onAllowOnce,
  onAllowSession,
  onDeny,
}: Props) {
  return (
    <div className="rounded-xl border border-app-accent/30 bg-app-accent/5 p-3 text-xs">
      <div className="flex items-center gap-2 text-app-accent">
        <ShieldAlert size={13} />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-app-bg/60 px-2 py-1 font-mono text-[11px] text-app-text">
        {details}
      </pre>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAllowOnce}
          className="rounded-md bg-app-accent px-3 py-1 font-medium text-app-bg hover:bg-app-accent/90"
        >
          Allow once
        </button>
        <button
          type="button"
          onClick={onAllowSession}
          className="rounded-md border border-app-accent/50 px-3 py-1 text-app-accent hover:bg-app-accent/10"
        >
          Allow this session
        </button>
        <button
          type="button"
          onClick={onDeny}
          className="rounded-md px-3 py-1 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
