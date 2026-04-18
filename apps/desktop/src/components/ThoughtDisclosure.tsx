import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import type { ThinkingPhase } from "../lib/thinking";

type Props = {
  thought: string;
  phase: ThinkingPhase;
  /** Milliseconds the thought took. If provided, shown in the eyebrow
   * once the answer has started. */
  durationMs?: number | null;
};

/**
 * Collapsible strip rendered above an assistant bubble when the model
 * emitted chain-of-thought on a dedicated channel. Always starts collapsed;
 * user clicks to expand. The eyebrow still reflects streaming state so the
 * user can see progress without opening the disclosure.
 */
export function ThoughtDisclosure({ thought, phase, durationMs }: Props) {
  const [open, setOpen] = useState(false);

  const streaming = phase === "thought";
  const label = streaming
    ? "thinking…"
    : durationMs != null
      ? `thought process · ${(durationMs / 1000).toFixed(1)}s`
      : "thought process";

  return (
    <div className="mb-2 max-w-[760px] rounded-md border border-app-border bg-app-surface/60 font-mono">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-app-text-muted hover:text-app-text"
      >
        <Brain
          size={11}
          strokeWidth={2}
          className={streaming ? "text-app-purple" : "text-app-text-faint"}
        />
        <span className="font-medium">{label}</span>
        {streaming && (
          <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-app-purple" />
        )}
        <span className="ml-auto text-app-text-faint">
          {open ? (
            <ChevronDown size={11} strokeWidth={2} />
          ) : (
            <ChevronRight size={11} strokeWidth={2} />
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-app-border/60 px-3 py-2 text-[11.5px] leading-[1.55] whitespace-pre-wrap text-app-text-muted">
          {thought}
          {streaming && <span className="ml-1 animate-pulse">▍</span>}
        </div>
      )}
    </div>
  );
}
