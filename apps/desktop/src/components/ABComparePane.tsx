import { Check, Sparkles, X } from "lucide-react";
import { Markdown } from "./Markdown";
import type { ABDelta } from "../lib/ab-deltas";

export type ABPick = "baseline" | "variation" | "dismissed";

export type ABComparisonMessage = {
  id: string;
  role: "ab_comparison";
  prompt: string;
  delta: ABDelta;
  baselineText: string;
  variationText: string;
  /** Which lane is currently streaming, or null once both are done. */
  pending: "baseline" | "variation" | null;
  /** User's choice. null until they click one of the pick buttons. */
  pick: ABPick | null;
};

type Props = {
  message: ABComparisonMessage;
  onPick: (id: string, choice: ABPick) => void;
};

/**
 * Side-by-side view used by the opportunistic A/B tuning flow. Two panes
 * share the turn body, separated by a single thin vertical rule — no
 * per-pane borders or rounded corners (per product spec). Below the panes,
 * a pick bar lets the user choose which lane they preferred; picking the
 * variation pushes the delta's rule into `settings.learnedRules`. Once a
 * pick is committed the bar swaps for an outcome chip so the transcript
 * stays auditable on re-read.
 */
export function ABComparePane({ message, onPick }: Props) {
  const { delta, baselineText, variationText, pending, pick } = message;
  const streaming = pending !== null;

  return (
    <div className="max-w-[900px]">
      <div className="grid grid-cols-1 divide-x divide-black/40 md:grid-cols-2 dark:divide-white/20">
        <Lane
          label="current style"
          text={baselineText}
          pending={pending === "baseline"}
          selected={pick === "baseline"}
        />
        <Lane
          label={`+ ${delta.name}`}
          text={variationText}
          pending={pending === "variation"}
          selected={pick === "variation"}
        />
      </div>

      {!streaming && !pick && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
          <span className="font-mono text-[11px] text-app-text-muted">
            which felt better?
          </span>
          <PickButton
            icon={<Check size={11} strokeWidth={2.4} />}
            onClick={() => onPick(message.id, "baseline")}
          >
            keep current
          </PickButton>
          <PickButton
            icon={<Sparkles size={11} strokeWidth={2.2} />}
            highlight
            onClick={() => onPick(message.id, "variation")}
          >
            use this (+ {delta.name})
          </PickButton>
          <button
            type="button"
            onClick={() => onPick(message.id, "dismissed")}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] text-app-text-faint hover:text-app-text"
          >
            <X size={11} strokeWidth={2} />
            dismiss
          </button>
        </div>
      )}

      {pick && (
        <div className="mt-3 flex items-center gap-2 border-t border-app-border pt-3 font-mono text-[11px]">
          {pick === "variation" ? (
            <span className="text-app-purple">
              ✓ added “{delta.name}” to your system prompt.
            </span>
          ) : pick === "baseline" ? (
            <span className="text-app-text-muted">
              kept current style — no change to system prompt.
            </span>
          ) : (
            <span className="text-app-text-faint">dismissed.</span>
          )}
        </div>
      )}
    </div>
  );
}

function Lane({
  label,
  text,
  pending,
  selected,
}: {
  label: string;
  text: string;
  pending: boolean;
  selected: boolean;
}) {
  return (
    <div
      className={`flex min-h-[160px] flex-col gap-2 px-4 py-3 ${
        selected ? "bg-app-purple/5" : ""
      }`}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-app-text-faint">
        <span>{label}</span>
        {pending && <span className="text-app-accent">· streaming</span>}
        {selected && <span className="text-app-purple">· picked</span>}
      </div>
      <div className="text-[13.5px] leading-[1.55] text-app-text">
        {text ? (
          <Markdown>{text}</Markdown>
        ) : pending ? (
          <span className="text-app-text-faint">…</span>
        ) : (
          <span className="text-app-text-faint">(waiting)</span>
        )}
      </div>
    </div>
  );
}

function PickButton({
  children,
  icon,
  onClick,
  highlight,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
        highlight
          ? "bg-app-purple/15 text-app-purple ring-1 ring-inset ring-app-purple/45 hover:bg-app-purple/25"
          : "border border-app-border text-app-text-muted hover:border-app-border-strong hover:bg-app-surface-hover hover:text-app-text"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
