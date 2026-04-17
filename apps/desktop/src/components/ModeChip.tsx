import { Sparkles } from "lucide-react";

type Props = {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

/**
 * The inline "Computer Use" mode chip shown at the start of the composer's
 * text row. When active, Computer Use drives the agent loop (tool calls,
 * permission presets, workspace-confined I/O).
 *
 * Purple is reserved for this mode only; the rest of the app stays orange.
 */
export function ModeChip({ active, onToggle, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={
        active
          ? "Computer Use is on — agent can call tools. Click to disable."
          : "Turn on Computer Use — lets the model read files, run commands, fetch URLs."
      }
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-app-purple/15 text-app-purple ring-1 ring-inset ring-app-purple/40"
          : "border border-app-border text-app-text-muted hover:border-app-purple/50 hover:text-app-purple"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <Sparkles size={11} className={active ? "fill-app-purple" : ""} />
      Computer Use
    </button>
  );
}
