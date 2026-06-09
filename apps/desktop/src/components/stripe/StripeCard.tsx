import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/** Shared shell for all Stripe tool result cards.
 * Mirrors the visual vocabulary of FlightResultsCard / DateHeatmapCard. */
export function StripeCard({
  title,
  eyebrow,
  children,
  footer,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="max-w-[620px] overflow-hidden rounded-lg border border-app-border bg-app-surface">
      <div className="border-b border-app-border/70 px-4 py-2.5">
        <div className="font-serif text-[15px] leading-tight text-app-text">
          {title}
        </div>
        <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-app-text-faint">
          {eyebrow}
        </div>
      </div>
      {children}
      {footer ? (
        <div className="border-t border-app-border/70 px-4 py-2 font-mono text-[11px] text-app-text-faint">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function StripeErrorCard({
  toolEyebrow,
  err,
}: {
  toolEyebrow: string;
  err: { type?: string; message?: string };
}) {
  return (
    <div className="max-w-[620px] overflow-hidden rounded-lg border border-amber-500/40 bg-app-surface">
      <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
        <div className="flex items-center gap-2 font-serif text-[15px] leading-tight text-amber-700">
          <AlertTriangle size={14} strokeWidth={2} />
          {err.type || "Stripe error"}
        </div>
        <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-app-text-faint">
          {toolEyebrow}
        </div>
      </div>
      <div className="px-4 py-3 text-[13px] text-app-text">
        {err.message || "Unknown Stripe error."}
      </div>
    </div>
  );
}

/** Status pill used inline by the per-tool cards. */
export function StatusPill({
  label,
  classes,
}: {
  label: string;
  classes: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${classes}`}
    >
      {label}
    </span>
  );
}
