import { ExternalLink, AlertTriangle } from "lucide-react";
import { StripeCard, StatusPill } from "./StripeCard";
import {
  formatDueDate,
  formatMinorUnits,
  statusPillProps,
  truncateId,
} from "./formatters";

export type InvoiceData = {
  id: string;
  hosted_invoice_url: string | null;
  amount_due: number;
  status: string;
  sent?: boolean;
  send_error?: string | null;
};

export function InvoiceCard({
  data,
  args,
}: {
  data: InvoiceData;
  args: Record<string, unknown>;
}) {
  const customerEmail = String(args.customer_email ?? "");
  const dueDate = String(args.due_date ?? "");
  const due = dueDate ? formatDueDate(dueDate) : null;
  const pill = statusPillProps(data.status);
  // Currency isn't returned at the invoice level — use the first line item's
  // (or default to USD). The model's prose under the card will clarify if mixed.
  const currency = pickCurrency(args) ?? "usd";

  return (
    <StripeCard
      title={`Invoice for ${customerEmail || "customer"}`}
      eyebrow="stripe · invoice · test mode"
      footer={truncateId(data.id, 16, 6)}
    >
      <div className="px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="font-serif text-[28px] leading-none text-app-text tabular-nums">
            {formatMinorUnits(data.amount_due, currency)}
          </div>
          <StatusPill {...pill} />
        </div>
        {due ? (
          <div className="mt-2 text-[12px] text-app-text-muted">
            Due {due.absolute}
            {due.relative ? (
              <span className="ml-1.5 text-app-text-faint">· {due.relative}</span>
            ) : null}
          </div>
        ) : null}

        {data.hosted_invoice_url ? (
          <div className="mt-3">
            <a
              href={data.hosted_invoice_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-app-text px-3 py-1.5 text-[12px] font-medium text-app-surface transition-opacity hover:opacity-90"
            >
              <ExternalLink size={12} strokeWidth={2.2} />
              Open hosted invoice
            </a>
          </div>
        ) : null}

        {data.sent === false ? (
          <div
            className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700"
            title={data.send_error ?? undefined}
          >
            <AlertTriangle size={12} strokeWidth={2.2} className="mt-0.5 shrink-0" />
            <span>
              Email not sent — sandbox accounts often can't deliver invoice
              emails. Share the hosted URL manually.
            </span>
          </div>
        ) : null}
      </div>
    </StripeCard>
  );
}

function pickCurrency(args: Record<string, unknown>): string | null {
  const items = args.line_items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0] as Record<string, unknown>;
  const c = first.currency;
  return typeof c === "string" ? c : null;
}
