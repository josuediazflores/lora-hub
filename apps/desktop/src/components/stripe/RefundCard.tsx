import { Undo2 } from "lucide-react";
import { StripeCard, StatusPill } from "./StripeCard";
import { formatMinorUnits, statusPillProps, truncateId } from "./formatters";

export type RefundData = {
  id: string;
  amount: number;
  status: string;
};

export function RefundCard({
  data,
  args,
}: {
  data: RefundData;
  args: Record<string, unknown>;
}) {
  // The refund response doesn't include currency, but the partial-amount arg
  // hints whether this was a partial refund. Currency defaults to USD for
  // formatting; the model's prose underneath handles the long tail.
  const isPartial = args.amount != null;
  const pill = statusPillProps(data.status);

  return (
    <StripeCard
      title="Refund issued"
      eyebrow="stripe · refund · test mode"
      footer={truncateId(data.id, 16, 6)}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-app-surface-hover text-app-text-muted">
            <Undo2 size={14} strokeWidth={2} />
          </span>
          <div className="font-serif text-[20px] leading-none text-app-text tabular-nums">
            {formatMinorUnits(data.amount, "usd")}
            {isPartial ? (
              <span className="ml-2 font-sans text-[12px] text-app-text-faint">
                (partial)
              </span>
            ) : null}
          </div>
        </div>
        <StatusPill {...pill} />
      </div>
    </StripeCard>
  );
}
