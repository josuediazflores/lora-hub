import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, Mail, MessageSquare, Copy, Check, RefreshCw } from "lucide-react";
import { StripeCard, StatusPill } from "./StripeCard";
import { formatMinorUnits, statusPillProps, truncateId } from "./formatters";
import { safeHref } from "../../lib/safe-url";

export type SplitLink = {
  name: string;
  url: string;
  id: string;
  amount: number;
};

export type SplitLinksData = {
  split_id: string;
  currency: string;
  links: SplitLink[];
};

export type SplitPaid = {
  name: string;
  amount: number;
  paid_at: number;
  charge_id: string;
};

export type SplitStatusData = {
  split_id: string;
  paid: SplitPaid[];
};

type StripeMcpResult = {
  content?: { type: string; text?: string }[];
  isError?: boolean;
};

/** Render either create_split_payment_links output (with all-pending rows)
 * or split_status output (with paid rows merged in). Both share split_id;
 * if links are absent, we render whatever paid rows exist. */
export function SplitStatusCard({
  data,
  links,
}: {
  data: SplitStatusData | SplitLinksData;
  links?: SplitLinksData;
}) {
  // Normalize: figure out whether `data` is a links payload or a status payload.
  const linksPayload: SplitLinksData | undefined =
    "links" in data ? (data as SplitLinksData) : links;
  const statusPayload: SplitStatusData | undefined =
    "paid" in data ? (data as SplitStatusData) : undefined;

  const splitId = data.split_id;
  const [paid, setPaid] = useState<SplitPaid[]>(statusPayload?.paid ?? []);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(linksPayload, paid), [linksPayload, paid]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
        toolName: "split_status",
        args: { split_id: splitId, limit: 100 },
      });
      const text = r.content?.[0]?.text ?? "{}";
      const parsed = JSON.parse(text) as SplitStatusData & {
        error?: { type: string; message: string };
      };
      if (parsed.error) {
        throw new Error(`${parsed.error.type}: ${parsed.error.message}`);
      }
      setPaid(parsed.paid ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const paidCount = rows.filter((r) => r.paid).length;
  const total = rows.length;

  return (
    <StripeCard
      title={
        total > 0
          ? `Split status — ${paidCount}/${total} paid`
          : "Split status"
      }
      eyebrow="lora-hub · split · test mode"
      footer={
        <span>
          split_id {truncateId(splitId, 6, 4)}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="ml-3 inline-flex items-center gap-1 rounded-md border border-app-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text disabled:opacity-50"
          >
            <RefreshCw
              size={10}
              strokeWidth={2.2}
              className={refreshing ? "animate-spin" : undefined}
            />
            {refreshing ? "checking" : "refresh"}
          </button>
        </span>
      }
    >
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-app-text-muted">
          No payers yet — call create_split_payment_links first.
        </div>
      ) : (
        <ul className="divide-y divide-app-border/70">
          {rows.map((row) => (
            <li key={row.name + row.id}>
              <SplitRow row={row} />
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="px-4 pb-2 text-[12px] text-rose-600">{error}</div>
      ) : null}
    </StripeCard>
  );
}

type Row = {
  name: string;
  amount: number;
  url?: string;
  id: string;
  paid: boolean;
  paidAt?: number;
};

function buildRows(
  links: SplitLinksData | undefined,
  paid: SplitPaid[],
): Row[] {
  const paidByName = new Map<string, SplitPaid>();
  for (const p of paid) paidByName.set(p.name, p);
  if (links && links.links.length > 0) {
    return links.links.map((l) => {
      const hit = paidByName.get(l.name);
      return {
        name: l.name,
        amount: l.amount,
        url: l.url,
        id: l.id,
        paid: !!hit,
        paidAt: hit?.paid_at,
      };
    });
  }
  // No links context — surface paid rows alone (e.g. user called split_status
  // without the prior create call in this turn).
  return paid.map((p) => ({
    name: p.name,
    amount: p.amount,
    id: p.charge_id,
    paid: true,
    paidAt: p.paid_at,
  }));
}

function SplitRow({ row }: { row: Row }) {
  const pill = statusPillProps(row.paid ? "paid" : "pending");
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    if (!row.url) return;
    try {
      await navigator.clipboard.writeText(row.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-[13px] text-app-text">{row.name}</div>
        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-app-text-faint">
          {formatMinorUnits(row.amount, "usd")}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {row.url && !row.paid ? (
          <>
            {safeHref(row.url) && (
              <a
                href={safeHref(row.url)}
                target="_blank"
                rel="noreferrer"
                title="Open Stripe Checkout"
                className="rounded-md border border-app-border p-1 text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text"
              >
                <ExternalLink size={12} strokeWidth={2.2} />
              </a>
            )}
            <a
              href={`sms:?&body=${encodeURIComponent(row.url)}`}
              title="Send via SMS"
              className="rounded-md border border-app-border p-1 text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text"
            >
              <MessageSquare size={12} strokeWidth={2.2} />
            </a>
            <a
              href={`mailto:?subject=Your%20share&body=${encodeURIComponent(row.url)}`}
              title="Send via email"
              className="rounded-md border border-app-border p-1 text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text"
            >
              <Mail size={12} strokeWidth={2.2} />
            </a>
            <button
              type="button"
              onClick={copyUrl}
              title="Copy URL"
              className="rounded-md border border-app-border p-1 text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text"
            >
              {copied ? (
                <Check size={12} strokeWidth={2.2} />
              ) : (
                <Copy size={12} strokeWidth={2.2} />
              )}
            </button>
          </>
        ) : null}
      </div>
      <StatusPill {...pill} />
    </div>
  );
}
