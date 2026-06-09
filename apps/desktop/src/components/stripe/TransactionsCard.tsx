import { StripeCard, StatusPill } from "./StripeCard";
import {
  formatMinorUnits,
  formatStripeTimestamp,
  statusPillProps,
} from "./formatters";

export type Charge = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description: string | null;
  created: number;
};

export type TransactionsData = { charges: Charge[] };

export function TransactionsCard({ data }: { data: TransactionsData }) {
  const charges = data.charges ?? [];

  if (charges.length === 0) {
    return (
      <StripeCard
        title="No charges yet"
        eyebrow="stripe · transactions · test mode"
      >
        <div className="px-4 py-6 text-center text-[13px] text-app-text-muted">
          This sandbox account has no charges to show.
        </div>
      </StripeCard>
    );
  }

  return (
    <StripeCard
      title={`${charges.length} recent ${charges.length === 1 ? "charge" : "charges"}`}
      eyebrow="stripe · transactions · test mode"
    >
      <ul className="divide-y divide-app-border/70">
        {charges.map((c) => (
          <li key={c.id}>
            <ChargeRow charge={c} />
          </li>
        ))}
      </ul>
    </StripeCard>
  );
}

function ChargeRow({ charge }: { charge: Charge }) {
  const ts = formatStripeTimestamp(charge.created);
  const pill = statusPillProps(charge.status);
  const href = `https://dashboard.stripe.com/test/payments/${charge.id}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-app-surface-hover"
    >
      <span
        className="font-mono text-[11px] uppercase tracking-wider text-app-text-faint"
        title={ts.relative}
      >
        {ts.absolute}
      </span>
      <span className="min-w-0 truncate text-[13px] text-app-text">
        {charge.description ? (
          charge.description
        ) : (
          <span className="text-app-text-faint">—</span>
        )}
      </span>
      <span className="font-sans text-[13px] tabular-nums text-app-text">
        {formatMinorUnits(charge.amount, charge.currency)}
      </span>
      <StatusPill {...pill} />
    </a>
  );
}
