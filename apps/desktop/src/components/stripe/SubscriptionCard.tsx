import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, FastForward, Clock } from "lucide-react";
import { StripeCard, StatusPill } from "./StripeCard";
import {
  formatMinorUnits,
  formatStripeTimestamp,
  statusPillProps,
  truncateId,
} from "./formatters";
import { DottedSpinner } from "../DottedSpinner";

export type SubscriptionData = {
  id: string;
  customer_id?: string;
  customer_email?: string;
  test_clock_id?: string | null;
  amount: number;
  currency: string;
  interval: string;
  interval_count?: number;
  status: string;
  current_period_end?: number | null;
  description?: string;
  latest_invoice_url?: string | null;
};

type StripeMcpResult = {
  content?: { type: string; text?: string }[];
  isError?: boolean;
};

export function SubscriptionCard({ data: initial }: { data: SubscriptionData }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<{ months: number; elapsed: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const pill = statusPillProps(busy ? "advancing" : data.status);
  const periodEnd =
    data.current_period_end != null
      ? formatStripeTimestamp(data.current_period_end)
      : null;
  const intervalLabel =
    (data.interval_count ?? 1) > 1
      ? `${data.interval_count} ${data.interval}s`
      : data.interval;

  async function callTool(tool: string, args: Record<string, unknown>) {
    const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
      toolName: tool,
      args,
    });
    if (r.isError) {
      throw new Error(r.content?.[0]?.text ?? "stripe error");
    }
    const text = r.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text);
    if (parsed.error) {
      throw new Error(`${parsed.error.type}: ${parsed.error.message}`);
    }
    return parsed;
  }

  async function onAdvance(months: number) {
    if (busy || !data.test_clock_id) return;
    setError(null);
    setBusy({ months, elapsed: 0 });
    const start = Date.now();
    try {
      // Stripe caps each advance at 2 intervals (e.g. 2 months for a monthly
      // sub). Chunk the requested span and poll between each call until the
      // clock returns to status="ready".
      const CHUNK = 2;
      let remaining = months;
      while (remaining > 0) {
        const step = Math.min(CHUNK, remaining);
        await callTool("advance_test_clock", {
          clock_id: data.test_clock_id,
          by_months: step,
        });
        // Poll until ready (max ~2min per chunk)
        for (let i = 0; i < 60; i++) {
          await sleep(2000);
          const elapsed = Math.round((Date.now() - start) / 1000);
          setBusy({ months, elapsed });
          const clock = await callTool("get_test_clock", {
            clock_id: data.test_clock_id,
          });
          if (clock.status === "ready") break;
          if (clock.status === "internal_failure") {
            throw new Error("Stripe reported internal_failure on the test clock.");
          }
        }
        remaining -= step;
      }
      // Refetch via list_subscriptions and pick our row
      const list = await callTool("list_subscriptions", { limit: 50 });
      const fresh = (list.subscriptions as SubscriptionData[] | undefined)?.find(
        (s) => s.id === data.id,
      );
      if (fresh) setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <StripeCard
      title={`Subscription · ${data.customer_email ?? data.customer_id ?? "customer"}`}
      eyebrow="stripe · subscription · test mode"
      footer={
        <span>
          {truncateId(data.id, 14, 6)}
          {data.test_clock_id ? (
            <>
              <span className="mx-2 text-app-text-faint">·</span>
              {truncateId(data.test_clock_id, 14, 6)}
            </>
          ) : null}
        </span>
      }
    >
      <div className="px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="font-serif text-[28px] leading-none text-app-text tabular-nums">
            {formatMinorUnits(data.amount, data.currency)}
            <span className="ml-1 font-sans text-[14px] text-app-text-muted">
              / {intervalLabel}
            </span>
          </div>
          <StatusPill {...pill} />
        </div>

        {periodEnd ? (
          <div className="mt-2 text-[12px] text-app-text-muted">
            Next invoice {periodEnd.absolute}
            <span className="ml-1.5 text-app-text-faint">
              · {periodEnd.relative}
            </span>
          </div>
        ) : null}

        {data.test_clock_id ? (
          <div className="mt-4 border-t border-app-border/70 pt-3">
            <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-app-text-faint">
              <Clock size={11} strokeWidth={2.2} />
              fast-forward billing
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {[1, 3, 12].map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy != null}
                  onClick={() => onAdvance(m)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-app-border px-2.5 py-1 text-[12px] text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FastForward size={11} strokeWidth={2.2} />
                  {m === 1 ? "1 month" : m === 3 ? "3 months" : "1 year"}
                </button>
              ))}
              {busy ? (
                <span className="ml-1 inline-flex items-center gap-2 text-[12px] text-app-text-muted">
                  <DottedSpinner size={14} />
                  Advancing {busy.months}mo… {busy.elapsed}s
                </span>
              ) : null}
            </div>
            {error ? (
              <div className="mt-2 text-[12px] text-rose-600">{error}</div>
            ) : null}
          </div>
        ) : null}

        {data.latest_invoice_url ? (
          <div className="mt-3">
            <a
              href={data.latest_invoice_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] text-app-text-muted hover:text-app-text"
            >
              <ExternalLink size={11} strokeWidth={2.2} />
              latest invoice
            </a>
          </div>
        ) : null}
      </div>
    </StripeCard>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
