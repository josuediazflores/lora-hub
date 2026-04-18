import { Terminal } from "lucide-react";

type Props = {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

/**
 * Inline mode chip at the start of the composer text row. Plum-accented
 * when on. Terminal glyph matches the engineered / instrument feel.
 */
export function ModeChip({ active, onToggle, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={
        active
          ? "Computer Use is on — the agent can call tools. Click to disable."
          : "Turn on Computer Use — lets the model read files, run commands, fetch URLs."
      }
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] font-medium transition-colors ${
        active
          ? "bg-app-purple/15 text-app-purple ring-1 ring-inset ring-app-purple/45"
          : "border border-app-border text-app-text-muted hover:border-app-purple/50 hover:text-app-purple"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <Terminal size={11} strokeWidth={2.2} />
      computer_use
      {active && <span className="text-app-purple/70">·on</span>}
    </button>
  );
}
