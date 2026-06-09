import { StripeCard, StatusPill } from "./StripeCard";
import {
  formatMinorUnits,
  formatStripeTimestamp,
  statusPillProps,
} from "./formatters";
import type { SubscriptionData } from "./SubscriptionCard";

export type SubscriptionsListData = { subscriptions: SubscriptionData[] };

export function SubscriptionsListCard({ data }: { data: SubscriptionsListData }) {
  const subs = data.subscriptions ?? [];

  if (subs.length === 0) {
    return (
      <StripeCard
        title="No subscriptions"
        eyebrow="stripe · subscriptions · test mode"
      >
        <div className="px-4 py-6 text-center text-[13px] text-app-text-muted">
          No subscriptions in this account yet.
        </div>
      </StripeCard>
    );
  }

  return (
    <StripeCard
      title={`${subs.length} ${subs.length === 1 ? "subscription" : "subscriptions"}`}
      eyebrow="stripe · subscriptions · test mode"
    >
      <ul className="divide-y divide-app-border/70">
        {subs.map((s) => (
          <li key={s.id}>
            <SubRow sub={s} />
          </li>
        ))}
      </ul>
    </StripeCard>
  );
}

function SubRow({ sub }: { sub: SubscriptionData }) {
  const pill = statusPillProps(sub.status);
  const intervalLabel =
    (sub.interval_count ?? 1) > 1
      ? `${sub.interval_count} ${sub.interval}s`
      : sub.interval;
  const next =
    sub.current_period_end != null
      ? formatStripeTimestamp(sub.current_period_end)
      : null;
  const href = `https://dashboard.stripe.com/test/subscriptions/${sub.id}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-app-surface-hover"
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] text-app-text">
          {sub.customer_email ?? sub.customer_id ?? "—"}
        </div>
        {next ? (
          <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-app-text-faint">
            next {next.absolute}
          </div>
        ) : null}
      </div>
      <div className="text-right text-[13px] tabular-nums text-app-text">
        {formatMinorUnits(sub.amount, sub.currency)}
        <span className="ml-0.5 text-app-text-faint">/{intervalLabel}</span>
      </div>
      <StatusPill {...pill} />
    </a>
  );
}
