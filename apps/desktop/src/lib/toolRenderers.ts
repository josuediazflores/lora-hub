import type { ReactNode } from "react";
import { createElement } from "react";
import {
  FlightResultsCard,
  type FlightResult,
} from "../components/FlightResultsCard";
import {
  DateHeatmapCard,
  type DateResult,
} from "../components/DateHeatmapCard";
import { StripeErrorCard } from "../components/stripe/StripeCard";
import {
  PaymentLinkCard,
  type PaymentLinkData,
} from "../components/stripe/PaymentLinkCard";
import {
  InvoiceCard,
  type InvoiceData,
} from "../components/stripe/InvoiceCard";
import {
  TransactionsCard,
  type TransactionsData,
} from "../components/stripe/TransactionsCard";
import {
  RefundCard,
  type RefundData,
} from "../components/stripe/RefundCard";
import {
  SubscriptionCard,
  type SubscriptionData,
} from "../components/stripe/SubscriptionCard";
import {
  SubscriptionsListCard,
  type SubscriptionsListData,
} from "../components/stripe/SubscriptionsListCard";
import { CancelCard, type CancelData } from "../components/stripe/CancelCard";
import { TestClockCard, type TestClockData } from "../components/stripe/TestClockCard";
import {
  SplitBillCard,
  type SplitBillData,
} from "../components/stripe/SplitBillCard";
import {
  SplitStatusCard,
  type SplitLinksData,
  type SplitStatusData,
} from "../components/stripe/SplitStatusCard";
import {
  OutreachDraftsCard,
  type OutreachDraftsData,
} from "../components/stripe/OutreachDraftsCard";

export type ToolResultRenderer = (
  output: string,
  args: Record<string, unknown>,
) => ReactNode | null;

export const TOOL_RESULT_RENDERERS: Record<string, ToolResultRenderer> = {
  search_flights: (output, args) => {
    const parsed = safeParse<FlightResult[]>(output);
    if (!parsed || !Array.isArray(parsed)) return null;
    return createElement(FlightResultsCard, {
      results: parsed,
      query: {
        origin: args.origin as string | undefined,
        destination: args.destination as string | undefined,
        departure_date: args.departure_date as string | undefined,
        return_date: args.return_date as string | undefined,
        sort_by: args.sort_by as string | undefined,
      },
    });
  },
  search_dates: (output, args) => {
    const parsed = safeParse<DateResult[]>(output);
    if (!parsed || !Array.isArray(parsed)) return null;
    return createElement(DateHeatmapCard, {
      results: parsed,
      query: {
        origin: args.origin as string | undefined,
        destination: args.destination as string | undefined,
        trip_duration: args.trip_duration as number | undefined,
        is_round_trip: args.is_round_trip as boolean | undefined,
      },
    });
  },
  create_payment_link: (output, args) =>
    renderStripe<PaymentLinkData>(output, args, "stripe · payment link · test mode", (data) =>
      createElement(PaymentLinkCard, { data }),
    ),
  create_invoice: (output, args) =>
    renderStripe<InvoiceData>(output, args, "stripe · invoice · test mode", (data) =>
      createElement(InvoiceCard, { data, args }),
    ),
  list_transactions: (output, args) =>
    renderStripe<TransactionsData>(output, args, "stripe · transactions · test mode", (data) =>
      createElement(TransactionsCard, { data }),
    ),
  refund_payment: (output, args) =>
    renderStripe<RefundData>(output, args, "stripe · refund · test mode", (data) =>
      createElement(RefundCard, { data, args }),
    ),
  create_subscription: (output, args) =>
    renderStripe<SubscriptionData>(output, args, "stripe · subscription · test mode", (data) =>
      createElement(SubscriptionCard, { data }),
    ),
  list_subscriptions: (output, args) =>
    renderStripe<SubscriptionsListData>(output, args, "stripe · subscriptions · test mode", (data) =>
      createElement(SubscriptionsListCard, { data }),
    ),
  cancel_subscription: (output, args) =>
    renderStripe<CancelData>(output, args, "stripe · cancel · test mode", (data) =>
      createElement(CancelCard, { data }),
    ),
  advance_test_clock: (output, args) =>
    renderStripe<TestClockData>(output, args, "stripe · advance clock · test mode", (data) =>
      createElement(TestClockCard, { data }),
    ),
  get_test_clock: (output, args) =>
    renderStripe<TestClockData>(output, args, "stripe · test clock · test mode", (data) =>
      createElement(TestClockCard, { data }),
    ),
  split_bill: (output, args) =>
    renderStripe<SplitBillData>(output, args, "lora-hub · receipt · test mode", (data) =>
      createElement(SplitBillCard, { data }),
    ),
  create_split_payment_links: (output, args) =>
    renderStripe<SplitLinksData>(output, args, "lora-hub · split · test mode", (data) =>
      createElement(SplitStatusCard, { data }),
    ),
  split_status: (output, args) =>
    renderStripe<SplitStatusData>(output, args, "lora-hub · split · test mode", (data) =>
      createElement(SplitStatusCard, { data }),
    ),
  send_payment_requests: (output, args) =>
    renderStripe<OutreachDraftsData>(output, args, "lora-hub · outreach · test mode", (data) =>
      createElement(OutreachDraftsCard, { data }),
    ),
};

/** Parse a stripe-mcp tool output, route to the error card if the JSON is an
 * error envelope, and otherwise hand the typed payload to the per-tool card.
 * Returns `null` (→ TerminalBlock fallback) on parse failure so renderer
 * crashes never hide the raw output. */
function renderStripe<T>(
  output: string,
  _args: Record<string, unknown>,
  toolEyebrow: string,
  render: (data: T) => ReactNode,
): ReactNode | null {
  const parsed = safeParse<T & { error?: { type?: string; message?: string } }>(
    output,
  );
  if (!parsed) return null;
  if (parsed.error && typeof parsed.error === "object") {
    return createElement(StripeErrorCard, {
      toolEyebrow,
      err: parsed.error,
    });
  }
  return render(parsed);
}

export const TOOL_LABELS: Record<string, string> = {
  search_flights: "Search flights",
  search_dates: "Search dates",
  read_file: "Read file",
  write_file: "Write file",
  edit_file: "Edit file",
  list_dir: "List directory",
  glob: "Find files",
  grep: "Search code",
  run_command: "Run command",
  http_fetch: "Fetch URL",
  fetch_page: "Fetch page",
  web_search: "Web search",
  save_memory: "Save memory",
  list_memories: "List memories",
  recall_memory: "Recall memory",
  compare_outputs: "Compare outputs",
  use_specialist: "Use specialist",
  create_payment_link: "Stripe payment link",
  create_invoice: "Stripe invoice",
  list_transactions: "Stripe transactions",
  refund_payment: "Stripe refund",
  create_subscription: "Stripe subscription",
  list_subscriptions: "Stripe subscriptions",
  cancel_subscription: "Stripe cancel",
  advance_test_clock: "Advance clock",
  get_test_clock: "Test clock",
  parse_receipt: "Parse receipt",
  split_bill: "Split bill",
  create_split_payment_links: "Split links",
  send_payment_requests: "Outreach drafts",
  split_status: "Split status",
};

export const TOOL_BRANDS: Record<string, string> = {
  search_flights: "fl",
  search_dates: "fl",
  read_file: "rd",
  write_file: "wr",
  edit_file: "ed",
  list_dir: "ls",
  glob: "fd",
  grep: "gr",
  run_command: "sh",
  http_fetch: "ht",
  fetch_page: "pg",
  web_search: "ws",
  save_memory: "sv",
  list_memories: "ls",
  recall_memory: "rc",
  compare_outputs: "ab",
  use_specialist: "sp",
  create_payment_link: "$$",
  create_invoice: "$i",
  list_transactions: "$l",
  refund_payment: "$r",
  create_subscription: "$+",
  list_subscriptions: "$L",
  cancel_subscription: "$x",
  advance_test_clock: "⏩",
  get_test_clock: "$c",
  parse_receipt: "rc",
  split_bill: "÷",
  create_split_payment_links: "🔗",
  send_payment_requests: "✉",
  split_status: "◔",
};

export function labelForTool(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function brandForTool(name: string): string {
  if (TOOL_BRANDS[name]) return TOOL_BRANDS[name];
  const cleaned = name.replace(/[^a-z0-9]/gi, "");
  return cleaned.slice(0, 2).toLowerCase() || "tl";
}

function safeParse<T>(s: string | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
