import { ShieldAlert } from "lucide-react";

type Props = {
  title: string;
  details: string;
  onAllowOnce: () => void;
  onAllowSession: () => void;
  onDeny: () => void;
  /** When false, the "allow this session" button is hidden — used for
   * irreversible / money-moving actions that should be confirmed every time. */
  allowSession?: boolean;
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
  allowSession = true,
}: Props) {
  return (
    <div className="rounded-md border border-app-accent/40 bg-app-accent/[0.06] p-3">
      <div className="flex items-center gap-2 text-app-accent">
        <ShieldAlert size={13} strokeWidth={2} />
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-app-bg/60 px-2 py-1.5 font-mono text-[11px] leading-[1.5] text-app-text">
        {details}
      </pre>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
        <button
          type="button"
          onClick={onAllowOnce}
          className="rounded-md bg-app-accent px-3 py-1 font-medium text-app-bg hover:bg-app-accent-soft"
        >
          allow once
        </button>
        {allowSession && (
          <button
            type="button"
            onClick={onAllowSession}
            className="rounded-md border border-app-accent/50 px-3 py-1 text-app-accent hover:bg-app-accent/10"
          >
            allow this session
          </button>
        )}
        <button
          type="button"
          onClick={onDeny}
          className="rounded-md px-3 py-1 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
        >
          deny
        </button>
      </div>
    </div>
  );
}
