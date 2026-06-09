/** Shared formatting helpers for Stripe tool result cards. */

export function formatMinorUnits(amount: number, currency: string): string {
  const code = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`;
  }
}

export function formatStripeTimestamp(unixSeconds: number): {
  absolute: string;
  relative: string;
} {
  const ms = unixSeconds * 1000;
  const d = new Date(ms);
  const absolute = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const diffDays = Math.round((Date.now() - ms) / 86_400_000);
  let relative: string;
  if (diffDays === 0) relative = "today";
  else if (diffDays === 1) relative = "yesterday";
  else if (diffDays > 1) relative = `${diffDays} days ago`;
  else if (diffDays === -1) relative = "tomorrow";
  else relative = `in ${-diffDays} days`;
  return { absolute, relative };
}

/** Relative formatter for due dates given as YYYY-MM-DD. */
export function formatDueDate(yyyyMmDd: string): {
  absolute: string;
  relative: string;
} {
  const d = new Date(yyyyMmDd + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) {
    return { absolute: yyyyMmDd, relative: "" };
  }
  return formatStripeTimestamp(Math.floor(d.getTime() / 1000));
}

export type StatusPill = { label: string; classes: string };

/** One color map across charge / invoice / refund / payment-link statuses so
 * the visual vocabulary stays consistent. Unknown statuses fall back to gray. */
export function statusPillProps(status: string | null | undefined): StatusPill {
  const s = (status ?? "").toLowerCase();
  switch (s) {
    case "succeeded":
    case "paid":
    case "active":
      return { label: s, classes: "bg-emerald-500/10 text-emerald-600" };
    case "open":
    case "pending":
      return { label: s, classes: "bg-sky-500/10 text-sky-600" };
    case "draft":
    case "canceled":
    case "refunded":
      return { label: s, classes: "bg-app-surface-hover text-app-text-muted" };
    case "failed":
    case "void":
    case "uncollectible":
      return { label: s, classes: "bg-rose-500/10 text-rose-600" };
    case "requires_action":
    case "processing":
    case "advancing":
    case "incomplete":
    case "past_due":
    case "trialing":
      return { label: s, classes: "bg-amber-500/10 text-amber-600" };
    default:
      return {
        label: s || "unknown",
        classes: "bg-app-surface-hover text-app-text-muted",
      };
  }
}

/** Middle-ellipsis a long Stripe id so it stays one line at small sizes. */
export function truncateId(id: string, head = 18, tail = 6): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
