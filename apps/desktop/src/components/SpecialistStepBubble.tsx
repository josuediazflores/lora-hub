import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SwapMarker } from "./TurnRow";

export type SpecialistStepStatus = "pending" | "success" | "error";

export type SpecialistStepMessage = {
  id: string;
  role: "specialist_step";
  /** Adapter slug the planner delegated to. `null` means base model (no adapter). */
  slug: string | null;
  /** The one-shot prompt the planner handed to the specialist. */
  instruction: string;
  /** Captured specialist output (streamed while pending, final on success). */
  output: string;
  status: SpecialistStepStatus;
  error?: string;
};

type Props = {
  message: SpecialistStepMessage;
};

/**
 * Transcript marker for a single step of a specialist-mode turn. Renders
 * a swap rule (↺ adapter · slug) followed by a collapsible bubble showing
 * the instruction + captured output. Pending steps start expanded so the
 * user can watch tokens stream in; successful ones collapse after to keep
 * the transcript readable for multi-step plans.
 */
export function SpecialistStepBubble({ message }: Props) {
  const [expanded, setExpanded] = useState(message.status !== "success");
  const glyph =
    message.status === "error"
      ? "✗"
      : message.status === "pending"
        ? "▸"
        : "✓";
  const tone =
    message.status === "error"
      ? "text-red-400"
      : message.status === "pending"
        ? "text-app-text-muted"
        : "text-app-accent";

  return (
    <div>
      <SwapMarker adapterName={message.slug ?? "base"} />
      <div className="grid grid-cols-[148px_1fr] gap-5 max-[1100px]:grid-cols-1">
        <div />
        <div className="my-1 max-w-[760px]">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-2 rounded-t-md border border-app-border bg-app-surface px-3 py-1.5 text-left font-mono text-[11px] hover:bg-app-surface-hover"
          >
            {expanded ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )}
            <span className={tone}>{glyph}</span>
            <span className="text-app-text">
              use_specialist
            </span>
            <span className="text-app-text-faint">
              · {message.slug ?? "base"}
            </span>
            {message.status === "pending" && (
              <span className="ml-auto text-app-text-faint">streaming…</span>
            )}
          </button>
          {expanded && (
            <div className="space-y-2 rounded-b-md border-x border-b border-app-border bg-app-surface/60 px-3 py-2">
              <div>
                <div className="mb-0.5 font-mono text-[9.5px] uppercase tracking-wider text-app-text-faint">
                  instruction
                </div>
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-[1.45] text-app-text-muted">
                  {message.instruction}
                </pre>
              </div>
              {(message.output || message.status === "pending") && (
                <div>
                  <div className="mb-0.5 font-mono text-[9.5px] uppercase tracking-wider text-app-text-faint">
                    output
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-[1.5] text-app-text">
                    {message.output || (message.status === "pending" ? "…" : "(empty)")}
                  </pre>
                </div>
              )}
              {message.error && (
                <div>
                  <div className="mb-0.5 font-mono text-[9.5px] uppercase tracking-wider text-red-400">
                    error
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-[1.5] text-red-400">
                    {message.error}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
