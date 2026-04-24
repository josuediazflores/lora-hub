import { useMemo } from "react";

export type DateResult = {
  departure_date: string;
  return_date?: string;
  price_usd: number;
  booking_url?: string;
};

type Props = {
  results: DateResult[];
  query?: {
    origin?: string;
    destination?: string;
    trip_duration?: number;
    is_round_trip?: boolean;
  };
};

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function DateHeatmapCard({ results, query }: Props) {
  const data = useMemo(() => buildGrid(results), [results]);

  if (!results || results.length === 0) {
    return (
      <div className="rounded-lg border border-app-border bg-app-surface px-4 py-3 text-[13px] text-app-text-muted">
        No date results.
      </div>
    );
  }

  const origin = query?.origin ?? "";
  const destination = query?.destination ?? "";
  const title =
    origin && destination ? `${origin} → ${destination}` : "Cheapest dates";
  const subtitleParts: string[] = [
    `${results.length} date${results.length === 1 ? "" : "s"}`,
    `$${data.minPrice} – $${data.maxPrice}`,
  ];
  if (query?.trip_duration) {
    subtitleParts.push(`${query.trip_duration}-day trip`);
  }

  return (
    <div className="max-w-[620px] overflow-hidden rounded-lg border border-app-border bg-app-surface">
      <div className="border-b border-app-border/70 px-4 py-2.5">
        <div className="font-serif text-[15px] leading-tight text-app-text">
          {title}
        </div>
        <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-app-text-faint">
          {subtitleParts.join(" · ")}
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="mb-1.5 grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((d) => (
            <div
              key={d}
              className="text-center font-mono text-[9.5px] uppercase tracking-[0.14em] text-app-text-faint"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {data.cells.map((cell, i) => (
            <DayCell key={i} cell={cell} />
          ))}
        </div>
      </div>

      <Legend minPrice={data.minPrice} maxPrice={data.maxPrice} />
    </div>
  );
}

function DayCell({ cell }: { cell: GridCell }) {
  if (cell.kind === "pad") {
    return <div className="aspect-square" aria-hidden="true" />;
  }
  if (cell.kind === "empty") {
    return (
      <div
        className="relative aspect-square rounded"
        style={{ background: "var(--color-app-surface-hover)" }}
      >
        <span className="absolute left-1 top-1 font-mono text-[10px] text-app-text-faint">
          {cell.day}
        </span>
      </div>
    );
  }

  const { day, price, percent, bookingUrl } = cell;
  const bg = `color-mix(in srgb, var(--color-app-accent) ${percent}%, var(--color-app-surface))`;

  const inner = (
    <div
      className="relative aspect-square overflow-hidden rounded transition-transform hover:scale-[1.04]"
      style={{ background: bg }}
      title={`$${price}`}
    >
      <span className="absolute left-1 top-1 font-mono text-[10px] text-app-text">
        {day}
      </span>
      <span className="absolute bottom-1 right-1 font-mono text-[9.5px] tabular-nums text-app-text">
        ${price}
      </span>
    </div>
  );

  if (bookingUrl) {
    return (
      <a href={bookingUrl} target="_blank" rel="noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}

function Legend({
  minPrice,
  maxPrice,
}: {
  minPrice: number;
  maxPrice: number;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-app-border/70 px-4 py-2">
      <span className="font-mono text-[10px] tabular-nums text-app-text-faint">
        ${minPrice}
      </span>
      <div
        className="h-1.5 flex-1 rounded-full"
        style={{
          background:
            "linear-gradient(to right, color-mix(in srgb, var(--color-app-accent) 10%, var(--color-app-surface)), var(--color-app-accent))",
        }}
      />
      <span className="font-mono text-[10px] tabular-nums text-app-text-faint">
        ${maxPrice}
      </span>
    </div>
  );
}

type GridCell =
  | { kind: "pad" }
  | { kind: "empty"; day: number }
  | {
      kind: "data";
      day: number;
      price: number;
      percent: number;
      bookingUrl?: string;
    };

function buildGrid(results: DateResult[]): {
  cells: GridCell[];
  minPrice: number;
  maxPrice: number;
} {
  const byIso = new Map<string, DateResult>();
  for (const r of results) byIso.set(r.departure_date, r);

  const prices = results.map((r) => r.price_usd);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const sortedDates = [...byIso.keys()].sort();
  if (sortedDates.length === 0) {
    return { cells: [], minPrice: 0, maxPrice: 0 };
  }

  const first = parseIso(sortedDates[0]);
  const last = parseIso(sortedDates[sortedDates.length - 1]);

  const gridStart = startOfWeekMonday(first);
  const gridEnd = endOfWeekSunday(last);

  const cells: GridCell[] = [];
  for (
    let d = new Date(gridStart);
    d <= gridEnd;
    d.setDate(d.getDate() + 1)
  ) {
    const iso = isoDate(d);
    if (d < first || d > last) {
      cells.push({ kind: "pad" });
      continue;
    }
    const entry = byIso.get(iso);
    if (!entry) {
      cells.push({ kind: "empty", day: d.getDate() });
      continue;
    }
    const pct =
      maxPrice === minPrice
        ? 50
        : 10 + 70 * ((entry.price_usd - minPrice) / (maxPrice - minPrice));
    cells.push({
      kind: "data",
      day: d.getDate(),
      price: entry.price_usd,
      percent: Math.round(pct),
      bookingUrl: entry.booking_url,
    });
  }

  return { cells, minPrice, maxPrice };
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeekMonday(d: Date): Date {
  const out = new Date(d);
  const dow = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - dow);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfWeekSunday(d: Date): Date {
  const out = new Date(d);
  const dow = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() + (6 - dow));
  out.setHours(23, 59, 59, 999);
  return out;
}
