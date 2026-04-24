import { type ReactNode } from "react";
import { adapterAccent } from "../lib/adapter-accent";

export type TurnKind = "user" | "assistant" | "tool" | "system" | "comparison";

type Props = {
  kind: TurnKind;
  /** Adapter name for assistant turns — drives gutter color + title. */
  adapter?: string | null;
  /** Optional override for the gutter title (e.g. "you", "tool", "sql-gen"). */
  title?: string;
  timeLabel?: string;
  /** Additional mono lines shown below the title ("412 ms · 186 tok", base). */
  metaLines?: (string | undefined | null)[];
  /** Optional right-aligned action buttons inside the gutter, hover-revealed. */
  actions?: ReactNode;
  /** If true, `actions` are always visible instead of hover-gated. Use for
   * urgent affordances during streaming (e.g. Stop), where requiring a
   * precise mouse hover to discover the button is a real UX problem. */
  pending?: boolean;
  /** Turn body — bubble, tool-call card, etc. */
  children: ReactNode;
};

/**
 * Per-turn layout row. 148px gutter column + 1fr content column.
 * The gutter carries the adapter name + 2px colored rail; the content column
 * carries the bubble. Hover reveals the action row.
 *
 * Below ~1100px the gutter collapses to a horizontal strip above the content.
 */
export function TurnRow({
  kind,
  adapter,
  title,
  timeLabel,
  metaLines,
  actions,
  pending,
  children,
}: Props) {
  const accent = adapter ? adapterAccent(adapter).text : null;

  // Rail color per kind.
  let railColor: string;
  if (kind === "user" || kind === "system") railColor = "var(--color-app-border-strong)";
  else if (kind === "tool") railColor = "var(--color-app-blue, #7aa6d1)";
  else if (kind === "comparison") railColor = "var(--color-app-accent)";
  else railColor = accent ?? "var(--color-app-border-strong)";

  const displayTitle =
    title ?? (kind === "user" ? "you" : kind === "tool" ? "tool" : (adapter ?? "assistant"));

  const titleColor =
    kind === "user" || kind === "system"
      ? "var(--color-app-text-muted)"
      : kind === "tool"
        ? "var(--color-app-blue, #7aa6d1)"
        : accent ?? "var(--color-app-text-muted)";

  return (
    <div className="group relative grid grid-cols-[148px_1fr] items-start gap-5 pb-5 max-[1100px]:grid-cols-1 max-[1100px]:gap-1">
      <div
        className="relative min-h-[36px] border-l-2 px-2.5 py-1 max-[1100px]:flex max-[1100px]:flex-wrap max-[1100px]:items-center max-[1100px]:gap-2.5 max-[1100px]:border-l-[3px] max-[1100px]:px-2.5 max-[1100px]:py-0.5"
        style={{ borderLeftColor: railColor }}
      >
        <div
          className="flex items-center gap-1.5 font-mono text-[11px] leading-[1.35]"
          style={{ color: titleColor }}
        >
          {kind !== "user" && kind !== "system" && (
            <span
              aria-hidden="true"
              className="inline-block h-[8px] w-[8px] shrink-0 rounded-[2px]"
              style={{ backgroundColor: railColor }}
            />
          )}
          <span>{displayTitle}</span>
        </div>
        {timeLabel && (
          <div className="mt-0.5 font-mono text-[10.5px] leading-[1.5] text-app-text-faint max-[1100px]:mt-0">
            {timeLabel}
          </div>
        )}
        {metaLines?.filter(Boolean).map((line, i) => (
          <div
            key={i}
            className="mt-0 font-mono text-[10.5px] leading-[1.5] text-app-text-faint opacity-70 max-[1100px]:opacity-100"
          >
            {line}
          </div>
        ))}
        {actions && (
          <div
            className={`mt-1.5 flex gap-1 transition-opacity max-[1100px]:mt-0 max-[1100px]:opacity-100 ${
              pending ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {actions}
          </div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Small circular action button used inside a TurnRow gutter. */
export function GutterBtn({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-app-border bg-app-surface text-app-text-muted hover:border-app-border-strong hover:bg-app-surface-hover hover:text-app-text"
    >
      {children}
    </button>
  );
}

/**
 * Dashed purple rule between adapter changes in the transcript. Matches the
 * per-turn grid so the dashed label sits in the gutter column.
 */
export function SwapMarker({ adapterName }: { adapterName: string }) {
  return (
    <div className="grid grid-cols-[148px_1fr] items-center gap-5 py-1.5 max-[1100px]:grid-cols-1 max-[1100px]:gap-1">
      <div
        className="border-l-2 border-dashed pl-2.5 font-mono text-[10.5px] text-app-purple"
        style={{ borderLeftColor: "var(--color-app-purple)" }}
      >
        ↺ adapter · {adapterName}
      </div>
      <div
        aria-hidden="true"
        className="h-px opacity-50"
        style={{
          background:
            "linear-gradient(90deg, var(--color-app-purple), transparent)",
        }}
      />
    </div>
  );
}
