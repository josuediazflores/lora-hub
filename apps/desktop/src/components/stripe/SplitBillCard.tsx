import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Receipt, Link2 } from "lucide-react";
import { StripeCard } from "./StripeCard";
import { formatMinorUnits } from "./formatters";
import { DottedSpinner } from "../DottedSpinner";
import {
  SplitStatusCard,
  type SplitLinksData,
} from "./SplitStatusCard";

export type SplitItem = { name: string; price: number };
export type SplitPerson = {
  name: string;
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
};
export type SplitBillData = {
  per_person: SplitPerson[];
  grand_total: number;
  items?: SplitItem[];
  tip?: number;
  tax?: number;
  description?: string;
};

type StripeMcpResult = {
  content?: { type: string; text?: string }[];
  isError?: boolean;
};

/** Format a major-units (dollar) number as currency. Reuses the minor-unit
 * helper by multiplying — keeps formatting consistent across all cards. */
function fmt(major: number): string {
  return formatMinorUnits(Math.round(major * 100), "usd");
}

export function SplitBillCard({ data }: { data: SplitBillData }) {
  const items = data.items ?? [];
  const subtotalSum = data.per_person.reduce((s, p) => s + p.subtotal, 0);
  const description = data.description?.trim() || "Bill split";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<SplitLinksData | null>(null);

  async function onCreateLinks() {
    if (busy || links) return;
    setBusy(true);
    setError(null);
    try {
      const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
        toolName: "create_split_payment_links",
        args: {
          per_person: data.per_person.map((p) => ({
            name: p.name,
            total: p.total,
          })),
          description,
        },
      });
      if (r.isError) {
        throw new Error(r.content?.[0]?.text ?? "stripe error");
      }
      const text = r.content?.[0]?.text ?? "{}";
      const parsed = JSON.parse(text) as SplitLinksData & {
        error?: { type: string; message: string };
      };
      if (parsed.error) {
        throw new Error(`${parsed.error.type}: ${parsed.error.message}`);
      }
      setLinks(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <StripeCard
        title={`Bill split — ${description}`}
        eyebrow="lora-hub · receipt · test mode"
        footer={
          <span>
            {data.per_person.length} {data.per_person.length === 1 ? "payer" : "payers"} ·
            subtotal {fmt(subtotalSum)} · tax {fmt(data.tax ?? 0)} · tip {fmt(data.tip ?? 0)}
          </span>
        }
      >
        <div className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2">
              <Receipt size={14} strokeWidth={2} className="text-app-text-muted" />
              <span className="font-mono text-[11px] uppercase tracking-wider text-app-text-faint">
                per person
              </span>
            </div>
            <div className="font-serif text-[20px] leading-none text-app-text tabular-nums">
              {fmt(data.grand_total)}
            </div>
          </div>
          <ul className="mt-3 divide-y divide-app-border/70">
            {data.per_person.map((p) => (
              <li
                key={p.name}
                className="grid grid-cols-[1fr_auto] items-baseline gap-3 py-2"
              >
                <div>
                  <div className="text-[13px] text-app-text">{p.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-app-text-faint">
                    {fmt(p.subtotal)} sub
                    <span className="mx-1.5">·</span>
                    {fmt(p.tax)} tax
                    <span className="mx-1.5">·</span>
                    {fmt(p.tip)} tip
                  </div>
                </div>
                <div className="text-right font-serif text-[16px] tabular-nums text-app-text">
                  {fmt(p.total)}
                </div>
              </li>
            ))}
          </ul>

          {items.length > 0 ? (
            <details className="mt-3 border-t border-app-border/70 pt-2">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider text-app-text-faint">
                line items ({items.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {items.map((it, i) => (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-3 text-[12px]"
                  >
                    <span className="text-app-text">{it.name}</span>
                    <span className="font-mono tabular-nums text-app-text-muted">
                      {fmt(it.price)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {!links ? (
            <div className="mt-4 border-t border-app-border/70 pt-3">
              <button
                type="button"
                onClick={onCreateLinks}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-app-text px-3 py-1.5 text-[12px] font-medium text-app-surface transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Link2 size={12} strokeWidth={2.2} />
                Create payment links
              </button>
              {busy ? (
                <span className="ml-3 inline-flex items-center gap-2 text-[12px] text-app-text-muted">
                  <DottedSpinner size={14} />
                  Creating links…
                </span>
              ) : null}
              {error ? (
                <div className="mt-2 text-[12px] text-rose-600">{error}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </StripeCard>

      {links ? <SplitStatusCard data={links} /> : null}
    </div>
  );
}
