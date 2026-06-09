import { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { StripeCard } from "./StripeCard";
import { formatMinorUnits, truncateId } from "./formatters";
import { safeHref } from "../../lib/safe-url";

export type PaymentLinkData = {
  url: string;
  id: string;
  amount: number;
  currency: string;
};

export function PaymentLinkCard({ data }: { data: PaymentLinkData }) {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silently no-op */
    }
  }

  return (
    <StripeCard
      title="Payment link created"
      eyebrow="stripe · payment link · test mode"
      footer={truncateId(data.id, 18, 6)}
    >
      <div className="px-4 py-4">
        <div className="font-serif text-[28px] leading-none text-app-text tabular-nums">
          {formatMinorUnits(data.amount, data.currency)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {safeHref(data.url) && (
            <a
              href={safeHref(data.url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-app-text px-3 py-1.5 text-[12px] font-medium text-app-surface transition-opacity hover:opacity-90"
            >
              <ExternalLink size={12} strokeWidth={2.2} />
              Open Stripe Checkout
            </a>
          )}
          <button
            type="button"
            onClick={copyUrl}
            className="inline-flex items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-[12px] text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text"
          >
            {copied ? (
              <>
                <Check size={12} strokeWidth={2.2} />
                Copied
              </>
            ) : (
              <>
                <Copy size={12} strokeWidth={2.2} />
                Copy URL
              </>
            )}
          </button>
        </div>
      </div>
    </StripeCard>
  );
}
