import { useMemo, useState } from "react";
import { Plane } from "lucide-react";
import { brandColorFor } from "../lib/airlineColors";

export type FlightResult = {
  airline_code: string;
  airline_name: string;
  origin: string;
  destination: string;
  departure_time: string;
  arrival_time: string;
  duration_minutes: number;
  stops: number;
  price_usd: number;
  booking_url?: string;
};

type SortKey = "cheapest" | "duration" | "departure" | "stops";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "cheapest", label: "Cheapest" },
  { key: "duration", label: "Duration" },
  { key: "departure", label: "Departure" },
  { key: "stops", label: "Stops" },
];

type Props = {
  results: FlightResult[];
  query?: {
    origin?: string;
    destination?: string;
    departure_date?: string;
    return_date?: string;
    sort_by?: string;
  };
};

export function FlightResultsCard({ results, query }: Props) {
  const initialSort = sortKeyFromQuery(query?.sort_by);
  const [sort, setSort] = useState<SortKey>(initialSort);

  const sorted = useMemo(() => sortResults(results, sort), [results, sort]);

  if (!results || results.length === 0) {
    return (
      <div className="rounded-lg border border-app-border bg-app-surface px-4 py-3 text-[13px] text-app-text-muted">
        No flights found.
      </div>
    );
  }

  const header = buildHeader(query, results);
  const origin = query?.origin ?? results[0]?.origin ?? "";
  const destination = query?.destination ?? results[0]?.destination ?? "";

  return (
    <div className="max-w-[620px] overflow-hidden rounded-lg border border-app-border bg-app-surface">
      {header ? (
        <div className="border-b border-app-border/70 px-4 py-2.5">
          <div className="font-serif text-[15px] leading-tight text-app-text">
            {header.title}
          </div>
          {header.subtitle ? (
            <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-app-text-faint">
              {header.subtitle}
            </div>
          ) : null}
        </div>
      ) : null}

      <RouteArc origin={origin} destination={destination} />

      <SortPillRow value={sort} onChange={setSort} />

      <ul className="divide-y divide-app-border/70">
        {sorted.map((r, i) => (
          <FlightRow key={i} flight={r} />
        ))}
      </ul>
    </div>
  );
}

function FlightRow({ flight }: { flight: FlightResult }) {
  const pricePerHour = Math.round(
    flight.price_usd / Math.max(flight.duration_minutes / 60, 0.01),
  );

  const content = (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-app-surface-hover">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
        style={{ background: brandColorFor(flight.airline_code) }}
        aria-hidden="true"
      >
        <Plane size={14} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 font-mono text-[13px] text-app-text">
          <span>{flight.origin}</span>
          <span className="font-sans text-[13px] tabular-nums">
            {flight.departure_time}
          </span>
          <span className="text-app-text-faint">→</span>
          <span className="font-sans text-[13px] tabular-nums">
            {flight.arrival_time}
          </span>
          <span>{flight.destination}</span>
        </div>
        <div className="mt-0.5 text-[12px] text-app-text-muted">
          <span className="font-mono uppercase tracking-wide text-app-text-faint">
            {flight.airline_code}
          </span>
          <span className="mx-1.5 text-app-text-faint">·</span>
          <span className="font-sans">{flight.airline_name}</span>
          <span className="mx-1.5 text-app-text-faint">·</span>
          <span className="font-mono tabular-nums">
            {formatDuration(flight.duration_minutes)}
          </span>
          <span className="mx-1.5 text-app-text-faint">·</span>
          <span>{formatStops(flight.stops)}</span>
          <span className="mx-1.5 text-app-text-faint">·</span>
          <span className="font-mono tabular-nums">${pricePerHour}/hr</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-serif text-[17px] leading-none text-app-text tabular-nums">
          ${flight.price_usd}
        </div>
      </div>
    </div>
  );

  if (flight.booking_url) {
    return (
      <li>
        <a
          href={flight.booking_url}
          target="_blank"
          rel="noreferrer"
          className="block"
        >
          {content}
        </a>
      </li>
    );
  }
  return <li>{content}</li>;
}

function RouteArc({
  origin,
  destination,
}: {
  origin: string;
  destination: string;
}) {
  if (!origin || !destination) return null;

  const width = 560;
  const height = 72;
  const padX = 48;
  const leftX = padX;
  const rightX = width - padX;
  const baselineY = 52;
  const peakY = 18;
  const midX = (leftX + rightX) / 2;

  const dx = rightX - leftX;
  const tangentAngle = (Math.atan2(0, dx) * 180) / Math.PI;

  return (
    <div className="flex justify-center border-b border-app-border/70 px-4 pb-3 pt-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        aria-hidden="true"
        className="max-w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          d={`M ${leftX} ${baselineY} Q ${midX} ${peakY - 18} ${rightX} ${baselineY}`}
          stroke="var(--color-app-border-strong)"
          strokeWidth={1.5}
          fill="none"
          strokeDasharray="4 4"
        />
        <circle cx={leftX} cy={baselineY} r={4} fill="var(--color-app-text)" />
        <circle cx={rightX} cy={baselineY} r={4} fill="var(--color-app-text)" />
        <text
          x={leftX}
          y={baselineY + 16}
          textAnchor="middle"
          className="font-mono"
          fontSize={10}
          letterSpacing="0.08em"
          fill="var(--color-app-text-muted)"
        >
          {origin.toUpperCase()}
        </text>
        <text
          x={rightX}
          y={baselineY + 16}
          textAnchor="middle"
          className="font-mono"
          fontSize={10}
          letterSpacing="0.08em"
          fill="var(--color-app-text-muted)"
        >
          {destination.toUpperCase()}
        </text>
        <g
          transform={`translate(${midX} ${peakY}) rotate(${tangentAngle})`}
        >
          <path
            d="M -6 -4 L 8 0 L -6 4 L -4 0 Z"
            fill="var(--color-app-accent)"
          />
        </g>
      </svg>
    </div>
  );
}

function SortPillRow({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (k: SortKey) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-app-border/70 px-4 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-app-text-faint">
        Sort
      </span>
      <div className="flex flex-wrap gap-1.5">
        {SORT_OPTIONS.map((opt) => {
          const active = opt.key === value;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              className={
                active
                  ? "rounded-full px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-white"
                  : "rounded-full border border-app-border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text"
              }
              style={
                active
                  ? { background: "var(--color-app-accent)" }
                  : undefined
              }
              aria-pressed={active}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function sortKeyFromQuery(sortBy: string | undefined): SortKey {
  switch ((sortBy ?? "").toUpperCase()) {
    case "DURATION":
      return "duration";
    case "DEPARTURE_TIME":
    case "DEPARTURE":
      return "departure";
    case "STOPS":
      return "stops";
    case "CHEAPEST":
    case "":
    default:
      return "cheapest";
  }
}

function sortResults(results: FlightResult[], key: SortKey): FlightResult[] {
  const copy = [...results];
  switch (key) {
    case "cheapest":
      return copy.sort((a, b) => a.price_usd - b.price_usd);
    case "duration":
      return copy.sort((a, b) => a.duration_minutes - b.duration_minutes);
    case "departure":
      return copy.sort((a, b) =>
        a.departure_time.localeCompare(b.departure_time),
      );
    case "stops":
      return copy.sort(
        (a, b) => a.stops - b.stops || a.price_usd - b.price_usd,
      );
  }
}

function buildHeader(
  query: Props["query"],
  results: FlightResult[],
): { title: string; subtitle?: string } | null {
  const origin = query?.origin ?? results[0]?.origin;
  const destination = query?.destination ?? results[0]?.destination;
  if (!origin || !destination) return null;
  const title = `${origin} → ${destination}`;
  const parts: string[] = [`${results.length} result${results.length === 1 ? "" : "s"}`];
  if (query?.departure_date) parts.push(query.departure_date);
  if (query?.return_date) parts.push(`return ${query.return_date}`);
  return { title, subtitle: parts.join(" · ") };
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatStops(stops: number): string {
  if (stops === 0) return "Non-stop";
  if (stops === 1) return "1 stop";
  return `${stops} stops`;
}
