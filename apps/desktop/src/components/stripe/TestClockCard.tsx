import { Clock } from "lucide-react";
import { StripeCard, StatusPill } from "./StripeCard";
import { formatStripeTimestamp, statusPillProps, truncateId } from "./formatters";

export type TestClockData = {
  clock_id: string;
  frozen_time: number;
  status: string;
};

export function TestClockCard({ data }: { data: TestClockData }) {
  const pill = statusPillProps(data.status);
  const ts = formatStripeTimestamp(data.frozen_time);

  return (
    <StripeCard
      title="Test clock"
      eyebrow="stripe · test clock · test mode"
      footer={truncateId(data.clock_id, 14, 6)}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-app-surface-hover text-app-text-muted">
            <Clock size={14} strokeWidth={2} />
          </span>
          <div>
            <div className="text-[13px] text-app-text">
              Frozen at {ts.absolute}
            </div>
            <div className="mt-0.5 text-[11px] text-app-text-faint">
              {ts.relative}
            </div>
          </div>
        </div>
        <StatusPill {...pill} />
      </div>
    </StripeCard>
  );
}
