import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, LayoutGrid, List, Search, Star, X } from "lucide-react";
import { fetchAdapters } from "../lib/store";
import type { StoreAdapter } from "../lib/store";
import {
  compactNum,
  deltaOf,
  sizeOf,
  useCaseOf,
  USE_CASE_LABEL,
  versionOf,
  type UseCase,
} from "../lib/editorial-data";
import { useCaseAccent } from "../lib/adapter-accent";

type SortKey = "downloads" | "trending" | "rating" | "newest" | "size";
type ViewMode = "cards" | "table";

type Props = {
  baseSha: string | null;
  baseLabel: string;
  installedSlugs: Set<string>;
  busy: boolean;
  preset: { useCase?: UseCase } | null;
  onOpenAdapter: (slug: string) => void;
  onOpenLanding: () => void;
  onInstallAdapter: (slug: string) => void;
};

export function StoreBrowse({
  baseSha,
  baseLabel,
  installedSlugs,
  busy: _busy,
  preset,
  onOpenAdapter,
  onOpenLanding,
  onInstallAdapter,
}: Props) {
  const [adapters, setAdapters] = useState<StoreAdapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [useCases, setUseCases] = useState<Set<UseCase>>(
    new Set(preset?.useCase ? [preset.useCase] : []),
  );
  const [licenses, setLicenses] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [compatibleOnly, setCompatibleOnly] = useState(true);
  const [installedOnly, setInstalledOnly] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [maxSizeMB, setMaxSizeMB] = useState(300);
  const [sort, setSort] = useState<SortKey>("downloads");
  const [view, setView] = useState<ViewMode>("cards");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const bases = compatibleOnly && baseSha ? [baseSha] : undefined;
    fetchAdapters({ bases, sort: "downloads", limit: 200 })
      .then((r) => {
        if (!cancelled) {
          setAdapters(r);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [compatibleOnly, baseSha]);

  // Shadow "compatible" — the API already filters by base when compatibleOnly is on.
  // For the facet "only compatible" toggle to work independently (all adapters vs
  // only-compatible), we derive a compatible flag locally.
  const enriched = useMemo(() => {
    return adapters.map((a) => ({
      adapter: a,
      useCase: useCaseOf(a),
      sizeMB: Math.round(sizeOf(a) / (1024 * 1024)),
      delta: deltaOf(a),
      compatible: baseSha ? a.base_sha === baseSha || !a.base_sha : true,
      installed: installedSlugs.has(a.slug),
    }));
  }, [adapters, baseSha, installedSlugs]);

  const useCaseCounts = useMemo(() => {
    const out: Record<UseCase, number> = {
      sql: 0,
      writing: 0,
      code: 0,
      tools: 0,
      summarize: 0,
      translation: 0,
      persona: 0,
    };
    for (const e of enriched) out[e.useCase] += 1;
    return out;
  }, [enriched]);

  const licenseCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const e of enriched)
      out.set(e.adapter.license, (out.get(e.adapter.license) ?? 0) + 1);
    return Array.from(out.entries()).sort((a, b) => b[1] - a[1]);
  }, [enriched]);

  const tagCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const e of enriched)
      for (const t of e.adapter.tags) out.set(t, (out.get(t) ?? 0) + 1);
    return Array.from(out.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [enriched]);

  const filtered = useMemo(() => {
    let out = enriched;
    if (q.trim()) {
      const needle = q.toLowerCase();
      out = out.filter(
        (e) =>
          e.adapter.name.toLowerCase().includes(needle) ||
          e.adapter.description.toLowerCase().includes(needle) ||
          e.adapter.author.toLowerCase().includes(needle) ||
          e.adapter.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }
    if (useCases.size) out = out.filter((e) => useCases.has(e.useCase));
    if (licenses.size) out = out.filter((e) => licenses.has(e.adapter.license));
    if (tags.size)
      out = out.filter((e) => e.adapter.tags.some((t) => tags.has(t)));
    if (compatibleOnly) out = out.filter((e) => e.compatible);
    if (installedOnly) out = out.filter((e) => e.installed);
    if (minRating > 0)
      out = out.filter((e) => (e.adapter.rating_avg ?? 0) >= minRating);
    if (maxSizeMB < 300) out = out.filter((e) => e.sizeMB <= maxSizeMB);

    switch (sort) {
      case "trending":
        out = [...out].sort((a, b) => b.delta - a.delta);
        break;
      case "rating":
        out = [...out].sort(
          (a, b) => (b.adapter.rating_avg ?? 0) - (a.adapter.rating_avg ?? 0),
        );
        break;
      case "newest":
        out = [...out].sort((a, b) => {
          const ax = a.adapter.published_at ?? 0;
          const bx = b.adapter.published_at ?? 0;
          return bx - ax;
        });
        break;
      case "size":
        out = [...out].sort((a, b) => a.sizeMB - b.sizeMB);
        break;
      case "downloads":
      default:
        out = [...out].sort((a, b) => b.adapter.downloads - a.adapter.downloads);
    }
    return out;
  }, [
    enriched,
    q,
    useCases,
    licenses,
    tags,
    compatibleOnly,
    installedOnly,
    minRating,
    maxSizeMB,
    sort,
  ]);

  const hasFilters =
    q.length > 0 ||
    useCases.size > 0 ||
    licenses.size > 0 ||
    tags.size > 0 ||
    installedOnly ||
    minRating > 0 ||
    maxSizeMB < 300;

  function toggleUseCase(uc: UseCase) {
    setUseCases((prev) => {
      const next = new Set(prev);
      if (next.has(uc)) next.delete(uc);
      else next.add(uc);
      return next;
    });
  }
  function toggleLicense(l: string) {
    setLicenses((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  }
  function toggleTag(t: string) {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }
  function clearAll() {
    setQ("");
    setUseCases(new Set());
    setLicenses(new Set());
    setTags(new Set());
    setInstalledOnly(false);
    setMinRating(0);
    setMaxSizeMB(300);
  }

  const shortSha = baseSha ? baseSha.slice(0, 7) : null;

  return (
    <div className="flex flex-1 flex-col">
      {/* Store header */}
      <header className="flex items-center gap-4 border-b border-app-border px-5 py-3.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-app-text">
            Browse adapters
          </h2>
          <div className="font-mono text-[11px] text-app-text-faint">
            · for {baseLabel}
            {shortSha && ` @ ${shortSha}`} · {filtered.length} of {adapters.length}
          </div>
        </div>
        <button
          onClick={onOpenLanding}
          className="ml-auto rounded-md border border-app-border px-2.5 py-1 font-mono text-[11px] text-app-text-muted hover:border-app-border-strong hover:text-app-text"
        >
          ← editorial landing
        </button>
      </header>

      <div className="grid flex-1 min-h-0 grid-cols-[232px_1fr] overflow-hidden">
        {/* Facet rail */}
        <aside className="overflow-y-auto border-r border-app-border px-3.5 pt-3.5 pb-5">
          <FacetSection title="base model">
            <FacetRow
              label="only compatible"
              count={enriched.filter((e) => e.compatible).length}
              active={compatibleOnly}
              onClick={() => setCompatibleOnly((v) => !v)}
            />
            <FacetRow
              label="installed"
              count={enriched.filter((e) => e.installed).length}
              active={installedOnly}
              onClick={() => setInstalledOnly((v) => !v)}
            />
          </FacetSection>

          <FacetSection title="use case">
            {(Object.keys(USE_CASE_LABEL) as UseCase[]).map((uc) => (
              <FacetRow
                key={uc}
                dot={useCaseAccent(uc)}
                label={USE_CASE_LABEL[uc]}
                count={useCaseCounts[uc]}
                active={useCases.has(uc)}
                onClick={() => toggleUseCase(uc)}
              />
            ))}
          </FacetSection>

          <FacetSection title="license">
            {licenseCounts.slice(0, 8).map(([l, c]) => (
              <FacetRow
                key={l}
                label={l || "unknown"}
                count={c}
                active={licenses.has(l)}
                onClick={() => toggleLicense(l)}
              />
            ))}
          </FacetSection>

          <FacetSection title="rating">
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="range"
                min={0}
                max={4.9}
                step={0.1}
                value={minRating}
                onChange={(e) => setMinRating(parseFloat(e.target.value))}
                className="flex-1 accent-app-accent"
              />
              <span className="min-w-[48px] text-right font-mono text-[10.5px] text-app-text-muted">
                {minRating > 0 ? `≥ ${minRating.toFixed(1)}` : "any"}
              </span>
            </div>
          </FacetSection>

          <FacetSection title="size">
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="range"
                min={40}
                max={300}
                step={10}
                value={maxSizeMB}
                onChange={(e) => setMaxSizeMB(parseInt(e.target.value, 10))}
                className="flex-1 accent-app-accent"
              />
              <span className="min-w-[48px] text-right font-mono text-[10.5px] text-app-text-muted">
                {maxSizeMB < 300 ? `≤ ${maxSizeMB}MB` : "any"}
              </span>
            </div>
          </FacetSection>

          <FacetSection title="tags">
            {tagCounts.map(([t, c]) => (
              <FacetRow
                key={t}
                label={t}
                count={c}
                active={tags.has(t)}
                onClick={() => toggleTag(t)}
              />
            ))}
          </FacetSection>

          {hasFilters && (
            <button
              onClick={clearAll}
              className="mt-1 cursor-pointer font-mono text-[10.5px] text-app-accent hover:underline"
            >
              × clear all filters
            </button>
          )}
        </aside>

        {/* Results column */}
        <div className="flex min-w-0 flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-3 border-b border-app-border bg-app-bg px-5 py-2.5">
            <div className="relative max-w-[520px] flex-1">
              <Search
                size={13}
                strokeWidth={2}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-app-text-faint"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="search adapters…"
                className="w-full rounded-[5px] border border-app-border bg-app-surface py-[7px] pr-8 pl-7 font-mono text-[12px] text-app-text placeholder:text-app-text-faint focus:border-app-border-strong focus:outline-none"
              />
              <kbd className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-[3px] border border-app-border border-b-2 bg-app-surface-raised px-1 py-[1px] font-mono text-[10px] text-app-text">
                /
              </kbd>
            </div>

            <div className="ml-auto inline-flex items-center gap-0.5 font-mono text-[11px]">
              <span className="mr-1.5 text-app-text-faint">sort</span>
              {(["downloads", "trending", "rating", "newest", "size"] as SortKey[]).map(
                (k) => (
                  <button
                    key={k}
                    onClick={() => setSort(k)}
                    className={`rounded px-2 py-[3px] ${
                      sort === k
                        ? "bg-app-surface-hover text-app-accent"
                        : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
                    }`}
                  >
                    {k}
                  </button>
                ),
              )}
            </div>

            <div className="ml-3 inline-flex overflow-hidden rounded-[4px] border border-app-border">
              <button
                onClick={() => setView("cards")}
                className={`border-r border-app-border px-2 py-1 ${
                  view === "cards"
                    ? "bg-app-surface-raised text-app-accent"
                    : "text-app-text-faint"
                }`}
                title="cards"
              >
                <LayoutGrid size={13} strokeWidth={2} />
              </button>
              <button
                onClick={() => setView("table")}
                className={`px-2 py-1 ${
                  view === "table"
                    ? "bg-app-surface-raised text-app-accent"
                    : "text-app-text-faint"
                }`}
                title="table"
              >
                <List size={13} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Chips row */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-app-border px-5 py-2.5">
            <span className="mr-2 font-mono text-[11px] text-app-text-muted">
              <b className="font-medium text-app-text">{filtered.length}</b> of{" "}
              {adapters.length}
            </span>
            {[...useCases].map((uc) => (
              <Chip
                key={uc}
                onDrop={() => toggleUseCase(uc)}
                label={USE_CASE_LABEL[uc]}
              />
            ))}
            {[...licenses].map((l) => (
              <Chip key={l} onDrop={() => toggleLicense(l)} label={`license: ${l}`} />
            ))}
            {[...tags].map((t) => (
              <Chip key={t} onDrop={() => toggleTag(t)} label={`tag: ${t}`} />
            ))}
            {installedOnly && (
              <Chip onDrop={() => setInstalledOnly(false)} label="installed" />
            )}
            {minRating > 0 && (
              <Chip
                onDrop={() => setMinRating(0)}
                label={`rating ≥ ${minRating.toFixed(1)}`}
              />
            )}
            {maxSizeMB < 300 && (
              <Chip
                onDrop={() => setMaxSizeMB(300)}
                label={`size ≤ ${maxSizeMB}MB`}
              />
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {error && (
              <div className="mb-4 rounded-md border border-app-accent/30 bg-app-accent/10 px-3 py-2 font-mono text-[12px] text-app-accent">
                storefront unreachable ({error}).
              </div>
            )}
            {loading ? (
              <div className="py-16 text-center font-mono text-[12px] text-app-text-muted">
                loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center font-mono text-[12px] text-app-text-faint">
                no adapters match.
                <br />
                try loosening the filters.
              </div>
            ) : view === "cards" ? (
              <CardsGrid items={filtered} onOpen={onOpenAdapter} onInstall={onInstallAdapter} />
            ) : (
              <TableView items={filtered} onOpen={onOpenAdapter} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Facet rail primitives ---------------------- */

function FacetSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4.5">
      <div className="mb-2 flex items-baseline justify-between border-b border-app-border pb-1.5 font-mono text-[10px] tracking-[0.16em] uppercase text-app-text-faint">
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function FacetRow({
  label,
  count,
  active,
  onClick,
  dot,
}: {
  label: string;
  count: number;
  active?: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mx-1.5 my-[1px] flex w-[calc(100%+0.75rem)] items-center justify-between gap-2 rounded px-1.5 py-[3px] font-mono text-[11.5px] transition-colors ${
        active
          ? "bg-app-accent/15 text-app-accent"
          : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
      }`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
        {dot && (
          <span
            className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ backgroundColor: dot }}
          />
        )}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={`text-[10.5px] ${active ? "text-app-accent" : "text-app-text-faint"}`}
      >
        {count}
      </span>
    </button>
  );
}

function Chip({ label, onDrop }: { label: string; onDrop: () => void }) {
  return (
    <button
      onClick={onDrop}
      className="group inline-flex items-center gap-1 rounded-[3px] border border-app-accent/60 bg-app-accent/10 px-1.5 py-0.5 font-mono text-[10.5px] text-app-accent"
    >
      {label}
      <X
        size={10}
        strokeWidth={2}
        className="opacity-60 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

/* ---------------------- Results views ---------------------- */

function CardsGrid({
  items,
  onOpen,
  onInstall,
}: {
  items: { adapter: StoreAdapter; compatible: boolean; installed: boolean }[];
  onOpen: (slug: string) => void;
  onInstall: (slug: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
      {items.map((e) => (
        <BrowseCard
          key={e.adapter.slug}
          adapter={e.adapter}
          compatible={e.compatible}
          installed={e.installed}
          onOpen={() => onOpen(e.adapter.slug)}
          onInstall={() => onInstall(e.adapter.slug)}
        />
      ))}
    </div>
  );
}

function BrowseCard({
  adapter,
  compatible,
  installed,
  onOpen,
  onInstall,
}: {
  adapter: StoreAdapter;
  compatible: boolean;
  installed: boolean;
  onOpen: () => void;
  onInstall: () => void;
}) {
  const accent = useCaseAccent(useCaseOf(adapter));
  return (
    <article
      onClick={onOpen}
      className={`relative cursor-pointer overflow-hidden rounded-[7px] border border-app-border bg-app-surface transition-colors hover:border-app-border-strong hover:bg-app-surface-hover ${
        !compatible ? "opacity-[0.45]" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className="absolute top-0 left-0 h-full w-[2px]"
        style={{ backgroundColor: accent }}
      />
      <div className="flex flex-col gap-2 p-3.5 pl-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-mono text-[13px] font-medium tracking-[-0.005em]"
              style={{ color: accent }}
            >
              {adapter.name}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-app-text-faint">
              by {adapter.author} · {adapter.license}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 font-mono text-[10.5px] text-app-text-muted">
            {adapter.rating_avg != null && (
              <span className="inline-flex items-center gap-1">
                <Star
                  size={10}
                  className="fill-app-accent text-app-accent"
                  strokeWidth={0}
                />
                {adapter.rating_avg.toFixed(1)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Download size={10} strokeWidth={2} />
              {compactNum(adapter.downloads)}
            </span>
          </div>
        </div>
        <p className="line-clamp-3 font-serif text-[13px] leading-[1.52] text-app-text">
          {adapter.description}
        </p>
        <div className="mt-1 flex items-center justify-between">
          <div className="flex flex-wrap gap-1">
            {adapter.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded-[3px] border border-app-border px-1.5 font-mono text-[10px] leading-[1.6] text-app-text-faint whitespace-nowrap"
              >
                {t}
              </span>
            ))}
          </div>
          {!compatible ? (
            <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-app-warn">
              <AlertTriangle size={10} strokeWidth={2} /> base mismatch
            </span>
          ) : installed ? (
            <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-app-ok">
              ●&nbsp;installed
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onInstall();
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[4px] border border-app-border bg-app-accent px-2 py-0.5 font-mono text-[10.5px] text-white hover:opacity-90"
            >
              <Download size={10} strokeWidth={2} /> install
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function TableView({
  items,
  onOpen,
}: {
  items: { adapter: StoreAdapter; compatible: boolean; installed: boolean }[];
  onOpen: (slug: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[6px] border border-app-border">
      <div
        className="grid gap-2.5 border-b border-app-border bg-app-bg px-3 py-2 font-mono text-[10px] tracking-[0.12em] uppercase text-app-text-faint"
        style={{ gridTemplateColumns: "2fr 1fr 1fr 80px 100px 90px" }}
      >
        <div>name</div>
        <div>use case</div>
        <div>license</div>
        <div>rating</div>
        <div>downloads</div>
        <div>size</div>
      </div>
      {items.map((e) => (
        <TableRow key={e.adapter.slug} enriched={e} onOpen={() => onOpen(e.adapter.slug)} />
      ))}
    </div>
  );
}

function TableRow({
  enriched: e,
  onOpen,
}: {
  enriched: { adapter: StoreAdapter; compatible: boolean; installed: boolean };
  onOpen: () => void;
}) {
  const accent = useCaseAccent(useCaseOf(e.adapter));
  const size = Math.round(sizeOf(e.adapter) / (1024 * 1024));
  return (
    <button
      onClick={onOpen}
      className={`relative grid w-full cursor-pointer items-center gap-2.5 border-b border-app-border px-3 py-2 text-left last:border-b-0 hover:bg-app-surface-hover ${
        !e.compatible ? "opacity-[0.45]" : ""
      }`}
      style={{ gridTemplateColumns: "2fr 1fr 1fr 80px 100px 90px" }}
    >
      <span
        aria-hidden="true"
        className="absolute top-0 left-0 h-full w-[2px]"
        style={{ backgroundColor: accent }}
      />
      <div className="min-w-0">
        <div
          className="truncate font-mono text-[12.5px] font-medium"
          style={{ color: accent }}
        >
          {e.adapter.name}
        </div>
        <div className="truncate font-mono text-[10.5px] text-app-text-faint">
          by {e.adapter.author} · v{versionOf(e.adapter)}
        </div>
      </div>
      <div className="font-mono text-[11px] text-app-text-muted">
        {USE_CASE_LABEL[useCaseOf(e.adapter)]}
      </div>
      <div className="font-mono text-[11px] text-app-text-muted">{e.adapter.license}</div>
      <div className="font-mono text-[11px] text-app-text-muted">
        {e.adapter.rating_avg != null ? e.adapter.rating_avg.toFixed(1) : "—"}
      </div>
      <div className="font-mono text-[11px] text-app-text-muted">
        {compactNum(e.adapter.downloads)}
      </div>
      <div className="font-mono text-[11px] text-app-text-muted">{size} MB</div>
    </button>
  );
}
