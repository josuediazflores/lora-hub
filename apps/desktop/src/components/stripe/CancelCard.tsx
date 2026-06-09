import { XCircle } from "lucide-react";
import { StripeCard, StatusPill } from "./StripeCard";
import { statusPillProps, truncateId } from "./formatters";

export type CancelData = {
  id: string;
  status: string;
  canceled_at: number | null;
  cancel_at_period_end?: boolean;
};

export function CancelCard({ data }: { data: CancelData }) {
  const pill = statusPillProps(data.status);
  const label = data.cancel_at_period_end
    ? "Subscription will cancel at period end"
    : "Subscription canceled";

  return (
    <StripeCard
      title={label}
      eyebrow="stripe · cancel · test mode"
      footer={truncateId(data.id, 14, 6)}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-app-surface-hover text-app-text-muted">
          <XCircle size={14} strokeWidth={2} />
        </span>
        <div className="flex-1 text-[13px] text-app-text">{data.id}</div>
        <StatusPill {...pill} />
      </div>
    </StripeCard>
  );
}
