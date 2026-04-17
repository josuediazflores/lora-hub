import { useEffect, useMemo, useState } from "react";
import { Download, Play, Search, Star, TrendingUp, Box } from "lucide-react";
import { fetchAdapters } from "../lib/store";
import type { StoreAdapter } from "../lib/store";
import {
  communityFor,
  compactNum,
  deltaOf,
  formatBytes,
  isFeatured,
  pullQuoteOf,
  sizeOf,
  trendOf,
  useCaseOf,
  USE_CASE_LABEL,
  versionOf,
  type UseCase,
} from "../lib/editorial-data";
import { useCaseAccent } from "../lib/adapter-accent";

type Props = {
  baseSha: string | null;
  baseLabel: string;
  installedSlugs: Set<string>;
  busy: boolean;
  onInstall: (adapter: StoreAdapter) => void;
  onTry: (adapter: StoreAdapter) => void;
  onOpenAdapter: (slug: string) => void;
  onOpenBrowse: (preset?: { useCase?: UseCase }) => void;
};

export function StoreLanding({
  baseSha,
  baseLabel,
  installedSlugs,
  busy,
  onInstall,
  onTry,
  onOpenAdapter,
  onOpenBrowse,
}: Props) {
  const [adapters, setAdapters] = useState<StoreAdapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [compatibleOnly, setCompatibleOnly] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const bases = compatibleOnly && baseSha ? [baseSha] : undefined;
    fetchAdapters({ bases, q: search || undefined, sort: "downloads", limit: 120 })
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
  }, [compatibleOnly, baseSha, search]);

  const useCaseCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of adapters) {
      const uc = useCaseOf(a);
      out[uc] = (out[uc] ?? 0) + 1;
    }
    return out;
  }, [adapters]);

  const licenseCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const a of adapters) out.set(a.license, (out.get(a.license) ?? 0) + 1);
    return Array.from(out.entries()).sort((a, b) => b[1] - a[1]);
  }, [adapters]);

  const sizeBuckets = useMemo(() => {
    const out = { small: 0, mid: 0, large: 0 };
    for (const a of adapters) {
      const mb = sizeOf(a) / (1024 * 1024);
      if (mb < 50) out.small += 1;
      else if (mb <= 150) out.mid += 1;
      else out.large += 1;
    }
    return out;
  }, [adapters]);

  const compatibleCount = adapters.length;
  const shortSha = baseSha ? baseSha.slice(0, 7) : null;

  return (
    <div className="flex flex-1 flex-col">
      <StoreHeader
        baseLabel={baseLabel}
        shortSha={shortSha}
        compatibleCount={compatibleCount}
        search={search}
        onSearch={setSearch}
        onOpenBrowse={() => onOpenBrowse()}
      />

      <div className="grid flex-1 min-h-0 grid-cols-[208px_1fr] overflow-hidden">
        <FilterRail
          compatibleOnly={compatibleOnly}
          onCompatibleOnly={setCompatibleOnly}
          useCaseCounts={useCaseCounts}
          licenseCounts={licenseCounts}
          sizeBuckets={sizeBuckets}
          totalCount={adapters.length}
          onOpenBrowse={onOpenBrowse}
        />

        <section className="overflow-y-auto px-7 pt-6 pb-20">
          <div className="mx-auto max-w-[1040px]">
            {error && (
              <div className="mb-4 rounded-md border border-app-accent/30 bg-app-accent/10 px-3 py-2 font-mono text-[12px] text-app-accent">
                storefront unreachable ({error}).
              </div>
            )}
            {loading && adapters.length === 0 ? (
              <div className="py-12 text-center font-mono text-[12px] text-app-text-muted">
                loading…
              </div>
            ) : adapters.length === 0 ? (
              <div className="py-12 text-center font-mono text-[12px] text-app-text-muted">
                {compatibleOnly && !baseSha
                  ? "load a base model first to see compatible adapters."
                  : "no adapters found."}
              </div>
            ) : (
              <EditorialContent
                adapters={adapters}
                baseLabel={baseLabel}
                baseSha={baseSha}
                installedSlugs={installedSlugs}
                busy={busy}
                onInstall={onInstall}
                onTry={onTry}
                onOpenAdapter={onOpenAdapter}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------------------- Store header ---------------------- */

function StoreHeader({
  baseLabel,
  shortSha,
  compatibleCount,
  search,
  onSearch,
  onOpenBrowse,
}: {
  baseLabel: string;
  shortSha: string | null;
  compatibleCount: number;
  search: string;
  onSearch: (v: string) => void;
  onOpenBrowse: () => void;
}) {
  return (
    <header className="flex items-center gap-4 border-b border-app-border px-7 py-3.5">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-app-text">
          Adapter store
        </h2>
        <div className="font-mono text-[11px] text-app-text-faint">
          · for {baseLabel}
          {shortSha && ` @ ${shortSha}`} · {compatibleCount} adapters compatible
        </div>
      </div>

      <button
        onClick={onOpenBrowse}
        className="ml-auto rounded-md border border-app-border px-2.5 py-1 font-mono text-[11px] text-app-text-muted hover:border-app-border-strong hover:text-app-text"
        title="Browse all (facets)"
      >
        browse all →
      </button>

      <div className="relative">
        <Search
          size={12}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-app-text-faint"
        />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="search adapters…"
          className="w-[280px] rounded-md border border-app-border bg-app-surface py-1.5 pr-2.5 pl-7 font-mono text-[12px] text-app-text placeholder:text-app-text-faint focus:border-app-border-strong focus:outline-none"
        />
      </div>
    </header>
  );
}

/* ---------------------- Filter rail ---------------------- */

function FilterRail({
  compatibleOnly,
  onCompatibleOnly,
  useCaseCounts,
  licenseCounts,
  sizeBuckets,
  totalCount,
  onOpenBrowse,
}: {
  compatibleOnly: boolean;
  onCompatibleOnly: (v: boolean) => void;
  useCaseCounts: Record<string, number>;
  licenseCounts: [string, number][];
  sizeBuckets: { small: number; mid: number; large: number };
  totalCount: number;
  onOpenBrowse: (preset?: { useCase?: UseCase }) => void;
}) {
  const useCaseKeys: UseCase[] = [
    "sql",
    "writing",
    "code",
    "tools",
    "summarize",
    "translation",
    "persona",
  ];
  return (
    <aside className="overflow-y-auto border-r border-app-border px-3.5 py-4.5 text-[12px]">
      <RailLabel>filters</RailLabel>
      <label className="mb-1 flex items-center gap-2 px-1 text-app-text-muted">
        <input
          type="checkbox"
          checked={compatibleOnly}
          onChange={(e) => onCompatibleOnly(e.target.checked)}
          className="accent-app-accent"
        />
        <span>only compatible</span>
      </label>
      <label className="mb-1 flex items-center gap-2 px-1 text-app-text-muted">
        <input type="checkbox" className="accent-app-accent" />
        <span>has demo prompt</span>
      </label>
      <label className="mb-1 flex items-center gap-2 px-1 text-app-text-muted">
        <input type="checkbox" className="accent-app-accent" />
        <span>installed</span>
      </label>

      <div className="mt-4">
        <RailLabel>use-case</RailLabel>
        <RailRow
          label="all"
          count={totalCount}
          active
          onClick={() => onOpenBrowse()}
        />
        {useCaseKeys.map((uc) => (
          <RailRow
            key={uc}
            label={USE_CASE_LABEL[uc]}
            count={useCaseCounts[uc] ?? 0}
            onClick={() => onOpenBrowse({ useCase: uc })}
          />
        ))}
      </div>

      <div className="mt-4">
        <RailLabel>license</RailLabel>
        {licenseCounts.slice(0, 6).map(([lic, c]) => (
          <RailRow
            key={lic}
            label={lic || "unknown"}
            count={c}
            onClick={() => onOpenBrowse()}
          />
        ))}
      </div>

      <div className="mt-4">
        <RailLabel>size</RailLabel>
        <RailRow label="< 50 MB" count={sizeBuckets.small} onClick={() => onOpenBrowse()} />
        <RailRow
          label="50–150 MB"
          count={sizeBuckets.mid}
          onClick={() => onOpenBrowse()}
        />
        <RailRow
          label="> 150 MB"
          count={sizeBuckets.large}
          onClick={() => onOpenBrowse()}
        />
      </div>
    </aside>
  );
}

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-1 mb-1.5 font-mono text-[10px] tracking-[0.12em] uppercase text-app-text-faint">
      {children}
    </div>
  );
}

function RailRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-md px-1.5 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "bg-app-accent/10 text-app-accent"
          : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={active ? "text-app-accent/70" : "text-app-text-faint"}>
        {count}
      </span>
    </button>
  );
}

/* ---------------------- Editorial content ---------------------- */

function EditorialContent({
  adapters,
  baseLabel,
  baseSha,
  installedSlugs,
  busy,
  onInstall,
  onTry,
  onOpenAdapter,
}: {
  adapters: StoreAdapter[];
  baseLabel: string;
  baseSha: string | null;
  installedSlugs: Set<string>;
  busy: boolean;
  onInstall: (a: StoreAdapter) => void;
  onTry: (a: StoreAdapter) => void;
  onOpenAdapter: (slug: string) => void;
}) {
  const hero = useMemo(
    () => adapters.find((a) => isFeatured(a, adapters)) ?? adapters[0],
    [adapters],
  );

  const trending = useMemo(() => {
    return adapters
      .filter((a) => a.slug !== hero?.slug)
      .map((a) => ({ a, delta: deltaOf(a) }))
      .sort((x, y) => y.delta - x.delta)
      .slice(0, 5);
  }, [adapters, hero]);

  const newAndNotable = useMemo(
    () => adapters.filter((a) => a.slug !== hero?.slug).slice(0, 3),
    [adapters, hero],
  );

  const staffPicks = useMemo(
    () => adapters.filter((a) => a.slug !== hero?.slug).slice(3, 7),
    [adapters, hero],
  );

  const community = useMemo(() => {
    const rows = communityFor(adapters);
    return rows
      .map((r) => ({
        ...r,
        adapter: adapters.find((a) => a.slug === r.slug),
      }))
      .filter((r): r is typeof r & { adapter: StoreAdapter } => !!r.adapter);
  }, [adapters]);

  if (!hero) return null;

  const heroAccent = useCaseAccent(useCaseOf(hero));
  const heroQuote = pullQuoteOf(hero);
  const heroSize = sizeOf(hero);
  const heroVer = versionOf(hero);
  const heroDelta = deltaOf(hero);
  const heroInstalled = installedSlugs.has(hero.slug);

  return (
    <>
      {/* Masthead */}
      <section className="mb-7 border-b border-app-border pb-6">
        <div className="mb-3.5 flex items-center gap-3">
          <span className="whitespace-nowrap font-mono text-[10px] tracking-[0.22em] uppercase text-app-accent">
            The&nbsp;Hub · Weekly
          </span>
          <span
            className="h-px flex-1 opacity-60"
            style={{
              background:
                "linear-gradient(to right, var(--color-app-accent) 0%, var(--color-app-border) 30%, var(--color-app-border) 100%)",
            }}
          />
          <span className="whitespace-nowrap font-mono text-[10px] tracking-[0.22em] uppercase text-app-text-faint">
            Issue · {issueNumber()}
          </span>
        </div>

        <h1 className="max-w-[22ch] font-serif text-[40px] font-medium leading-[1.04] tracking-[-0.02em] text-app-text">
          What we&rsquo;re fine&#8209;tuning this week
        </h1>

        <p className="mt-3.5 max-w-[64ch] font-serif text-[16.5px] leading-[1.58] text-app-text">
          <span className="font-medium uppercase tracking-[0.08em]" style={{ fontVariantCaps: "all-small-caps" }}>
            {leadinFor(adapters.length)}
          </span>{" "}
          adapters landed this month. These are the ones our curators can&rsquo;t stop
          reaching for — the ones quietly changing the shape of what{" "}
          {baseLabel} can do, one carefully-trained head at a time.
        </p>

        <div className="mt-4.5 flex items-center gap-2.5 font-mono text-[10.5px] tracking-[0.04em] text-app-text-faint">
          <span>{newAndNotable.length} new adapters</span>
          <Dot />
          <span>{adapters.length} compatible for {baseLabel}</span>
          <Dot />
          <span>12 min read</span>
        </div>
      </section>

      {/* Hero card */}
      <HeroCard
        hero={hero}
        heroAccent={heroAccent}
        heroQuote={heroQuote}
        heroSize={heroSize}
        heroVer={heroVer}
        heroDelta={heroDelta}
        installed={heroInstalled}
        baseSha={baseSha}
        baseLabel={baseLabel}
        busy={busy}
        onInstall={() => onInstall(hero)}
        onTry={() => onTry(hero)}
        onOpen={() => onOpenAdapter(hero.slug)}
      />

      {/* Hairline ornament */}
      <div className="flex justify-center px-0 pt-5.5 pb-4.5 text-app-text-faint" aria-hidden="true">
        <svg width="92" height="14" viewBox="0 0 92 14" fill="none" stroke="currentColor" strokeWidth="1">
          <line x1="0" y1="7" x2="36" y2="7" />
          <circle cx="46" cy="7" r="2.2" fill="currentColor" stroke="none" />
          <circle cx="40" cy="7" r="1" />
          <circle cx="52" cy="7" r="1" />
          <line x1="56" y1="7" x2="92" y2="7" />
        </svg>
      </div>

      {/* Trending band */}
      {trending.length > 0 && (
        <section className="mt-0">
          <SectionHead
            title="Moving this week"
            dek="by 7-day install delta"
            more="see the full chart →"
          />
          <div className="grid grid-cols-5 border-t border-b border-app-border">
            {trending.map(({ a, delta }, i) => (
              <TrendStrip
                key={a.slug}
                adapter={a}
                rank={i + 1}
                delta={delta}
                onOpen={() => onOpenAdapter(a.slug)}
              />
            ))}
          </div>
        </section>
      )}

      {/* New & notable */}
      {newAndNotable.length > 0 && (
        <section className="mt-7">
          <SectionHead
            title="New &amp; notable"
            dek="published in the last seven days"
            more={`see all ${adapters.length - 1} →`}
          />
          <div className="grid grid-cols-3 gap-4">
            {newAndNotable.map((a, i) => (
              <EditorialRankCard
                key={a.slug}
                adapter={a}
                rank={i + 1}
                installed={installedSlugs.has(a.slug)}
                onOpen={() => onOpenAdapter(a.slug)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Staff picks */}
      {staffPicks.length > 0 && (
        <section className="mt-7">
          <SectionHead
            title="Staff picks, by use-case"
            dek="four adapters our curators keep loaded"
            more="browse all use-cases →"
          />
          <div className="grid grid-cols-2 gap-4">
            {staffPicks.map((a) => (
              <UseCaseCard
                key={a.slug}
                adapter={a}
                onOpen={() => onOpenAdapter(a.slug)}
              />
            ))}
          </div>
        </section>
      )}

      {/* In the community */}
      {community.length > 0 && (
        <section className="mt-7">
          <SectionHead
            title="In the community"
            dek="what your network is installing this week"
            more="see all activity →"
          />
          <div className="border-t border-app-border">
            {community.map((row) => (
              <CommunityRow
                key={row.slug + row.who}
                who={row.who}
                verb={row.verb}
                count={row.count}
                adapter={row.adapter}
                onOpen={() => onOpenAdapter(row.adapter.slug)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Colophon */}
      <section className="mt-11">
        <div className="mb-4.5 h-[3px] bg-app-text opacity-[0.08]" />
        <div className="flex items-start justify-between gap-7">
          <div className="max-w-[52ch] font-serif text-[13.5px] italic leading-[1.55] text-app-text-muted">
            Published weekly by the Hub editorial team. Adapter authors retain
            all rights to their weights and readme content. Corrections and
            notes to{" "}
            <span className="font-mono text-app-text not-italic">editors@lora-hub.dev</span>.
          </div>
          <div className="text-right">
            <div className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-app-text-faint">
              Next issue
            </div>
            <div className="mt-0.5 font-serif text-[15px] text-app-text">
              {nextFriday()}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Dot() {
  return (
    <span
      className="inline-block h-[3px] w-[3px] rounded-full bg-app-text-faint"
      aria-hidden="true"
    />
  );
}

function SectionHead({
  title,
  dek,
  more,
}: {
  title: string;
  dek: string;
  more?: string;
}) {
  return (
    <div className="mb-4.5 flex items-center gap-4.5">
      <div className="shrink-0">
        <div
          className="font-mono text-[10.5px] font-semibold tracking-[0.18em] uppercase text-app-accent"
          dangerouslySetInnerHTML={{ __html: `§ &nbsp;${title}` }}
        />
        <div className="mt-[3px] font-serif text-[13px] italic text-app-text-muted">
          {dek}
        </div>
      </div>
      <div className="mb-1.5 h-px flex-1 self-end bg-app-border" />
      {more && (
        <div className="mb-1 cursor-pointer self-end font-mono text-[10.5px] tracking-[0.04em] text-app-text-faint hover:text-app-accent">
          {more}
        </div>
      )}
    </div>
  );
}

function HeroCard({
  hero,
  heroAccent,
  heroQuote,
  heroSize,
  heroVer,
  heroDelta,
  installed,
  baseLabel,
  baseSha,
  busy,
  onInstall,
  onTry,
  onOpen,
}: {
  hero: StoreAdapter;
  heroAccent: string;
  heroQuote: { pull: string; attr: string };
  heroSize: number;
  heroVer: string;
  heroDelta: number;
  installed: boolean;
  baseLabel: string;
  baseSha: string | null;
  busy: boolean;
  onInstall: () => void;
  onTry: () => void;
  onOpen: () => void;
}) {
  return (
    <article
      className="relative mb-1.5 grid grid-cols-[1.15fr_1fr] overflow-hidden rounded-[10px] border bg-app-surface transition-colors hover:border-app-border-strong"
      style={{ borderColor: heroAccent + "66" }}
    >
      <span
        aria-hidden="true"
        className="absolute top-0 left-0 h-full"
        style={{ width: "4px", backgroundColor: heroAccent }}
      />

      <div className="flex flex-col justify-between gap-5.5 border-r border-app-border px-7.5 py-6.5">
        <div>
          <button
            onClick={onOpen}
            className="block cursor-pointer text-left font-mono text-[10px] tracking-[0.22em] uppercase text-app-accent"
          >
            This week&rsquo;s lede
          </button>
          <button
            onClick={onOpen}
            className="mt-2.5 block cursor-pointer text-left font-serif text-[34px] font-medium leading-[1.06] tracking-[-0.015em]"
            style={{ color: heroAccent }}
          >
            {hero.name}
          </button>
          <div className="mt-2.5 font-mono text-[11.5px] text-app-text-faint">
            by {hero.author} · v{heroVer} · {hero.license}
          </div>
          <p className="mt-4.5 max-w-[52ch] font-serif text-[16.5px] leading-[1.58] text-app-text">
            {hero.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-app-text-muted">
          <span className="inline-flex items-center gap-1">
            <Download size={10} strokeWidth={2} /> {compactNum(hero.downloads)}
          </span>
          {hero.rating_avg != null && (
            <span className="inline-flex items-center gap-1">
              <Star size={10} className="fill-app-accent text-app-accent" strokeWidth={0} />
              {hero.rating_avg.toFixed(1)} ({hero.rating_count})
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Box size={10} strokeWidth={2} /> {formatBytes(heroSize)}
          </span>
          <span className="inline-flex items-center gap-1 text-app-ok">
            <TrendingUp size={11} strokeWidth={2} /> {heroDelta >= 0 ? "+" : ""}
            {heroDelta}% · 7d
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4.5 bg-app-surface-raised px-7 py-6.5">
        <div className="border-l-2 border-app-purple pl-4 font-serif text-[15px] italic leading-[1.58] text-app-text">
          “{heroQuote.pull}”
          <span className="mt-2.5 block font-mono text-[10.5px] tracking-[0.12em] uppercase text-app-text-faint not-italic">
            {heroQuote.attr}
          </span>
        </div>

        {hero.demo_prompt && (
          <div>
            <div className="mb-1.5 font-mono text-[11px] text-app-text-faint">
              try it with
            </div>
            <div className="rounded-[5px] border border-app-border bg-app-bg px-2.5 py-2 font-mono text-[12px] leading-[1.5] text-app-text">
              &gt; {hero.demo_prompt}
            </div>
          </div>
        )}

        <div className="mt-auto flex gap-2">
          {hero.demo_prompt && (
            <button
              onClick={onTry}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-app-purple px-2.5 py-1.5 font-mono text-[11px] text-app-purple hover:bg-app-purple/10 disabled:opacity-50"
            >
              <Play size={10} fill="currentColor" strokeWidth={0} />
              try it
            </button>
          )}
          <button
            onClick={installed ? onOpen : onInstall}
            disabled={busy}
            className={`rounded-md px-2.5 py-1.5 font-mono text-[11px] font-medium ${
              installed
                ? "cursor-default bg-app-surface-hover text-app-text-muted"
                : "bg-app-accent text-app-bg hover:bg-app-accent-soft disabled:opacity-50"
            }`}
          >
            {installed ? "installed · manage" : `install · ${formatBytes(heroSize)}`}
          </button>
        </div>
      </div>

      <div className="col-span-full flex justify-between border-t border-app-border bg-app-surface-hover px-4 py-2.5 font-mono text-[10.5px] text-app-text-muted">
        <span>#{hero.tags.slice(0, 4).join("  #")}</span>
        <span>
          base · {baseLabel}
          {baseSha ? ` @ ${baseSha.slice(0, 7)}` : ""}
        </span>
      </div>
    </article>
  );
}

function TrendStrip({
  adapter,
  rank,
  delta,
  onOpen,
}: {
  adapter: StoreAdapter;
  rank: number;
  delta: number;
  onOpen: () => void;
}) {
  const accent = useCaseAccent(useCaseOf(adapter));
  const trend = trendOf(adapter);
  const sign = delta >= 0 ? "+" : "";
  const dir = delta >= 0 ? "var(--color-app-ok)" : "var(--color-app-danger)";
  return (
    <button
      onClick={onOpen}
      className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2.5 border-r border-app-border px-3.5 py-3 text-left last:border-r-0 hover:bg-app-surface-hover"
    >
      <div className="font-serif text-[14px] text-app-text-faint" style={{ fontVariantNumeric: "oldstyle-nums" }}>
        {String(rank).padStart(2, "0")}
      </div>
      <div className="min-w-0">
        <div
          className="truncate font-serif text-[15px] font-medium leading-[1.1] tracking-[-0.005em]"
          style={{ color: accent }}
        >
          {adapter.name}
        </div>
        <div className="mt-0.5 font-mono text-[10.5px] text-app-text-faint">
          {USE_CASE_LABEL[useCaseOf(adapter)]} · {compactNum(adapter.downloads)} dl
        </div>
      </div>
      <div className="opacity-[0.85]">
        <Sparkline values={trend} width={92} height={18} color={accent} />
      </div>
      <div className="font-mono text-[11px] font-medium" style={{ color: dir }}>
        {sign}
        {delta}%
      </div>
    </button>
  );
}

function Sparkline({
  values,
  width,
  height,
  color,
}: {
  values: number[];
  width: number;
  height: number;
  color: string;
}) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const step = width / (values.length - 1);
  const pts = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EditorialRankCard({
  adapter,
  rank,
  installed,
  onOpen,
}: {
  adapter: StoreAdapter;
  rank: number;
  installed: boolean;
  onOpen: () => void;
}) {
  const accent = useCaseAccent(useCaseOf(adapter));
  return (
    <article
      onClick={onOpen}
      className="relative cursor-pointer overflow-hidden rounded-lg border border-app-border bg-app-surface p-4.5 pl-5.5 pt-4.5 pr-4.5 pb-4 transition-colors hover:border-app-border-strong"
    >
      <span
        aria-hidden="true"
        className="absolute top-0 left-0 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />
      <div
        className="float-right ml-2 mt-0.5 font-serif text-[20px] leading-none text-app-text-faint"
        style={{ fontVariantNumeric: "oldstyle-nums" }}
      >
        {String(rank).padStart(2, "0")}
      </div>
      <div className="font-serif text-[18px] font-medium leading-[1.2] tracking-[-0.008em] text-app-text">
        {adapter.name}
      </div>
      <div className="mt-1 font-mono text-[10.5px] tracking-[0.02em] text-app-text-faint">
        by {adapter.author} · {adapter.license}
      </div>
      <div className="mt-3 line-clamp-3 font-serif text-[13.5px] leading-[1.55] text-app-text">
        {adapter.description}
      </div>
      <div className="mt-3.5 flex items-center justify-between font-mono text-[10.5px] text-app-text-faint">
        <span className="inline-flex items-center gap-2">
          {adapter.rating_avg != null && (
            <span className="inline-flex items-center gap-1">
              <Star size={10} className="fill-app-accent text-app-accent" strokeWidth={0} />
              {adapter.rating_avg.toFixed(1)}
            </span>
          )}
          <span>· {compactNum(adapter.downloads)}&nbsp;dl</span>
        </span>
        {installed ? (
          <span className="inline-flex items-center gap-1 text-app-ok">● installed</span>
        ) : (
          <span className="text-app-accent">install →</span>
        )}
      </div>
    </article>
  );
}

function UseCaseCard({
  adapter,
  onOpen,
}: {
  adapter: StoreAdapter;
  onOpen: () => void;
}) {
  const accent = useCaseAccent(useCaseOf(adapter));
  return (
    <article
      onClick={onOpen}
      className="relative grid cursor-pointer grid-cols-[1fr_auto] gap-x-3.5 gap-y-1 overflow-hidden rounded-lg border border-app-border bg-app-surface p-4.5 pl-5.5 pt-4.5 pr-5 pb-4 transition-colors hover:border-app-border-strong"
    >
      <span
        aria-hidden="true"
        className="absolute top-0 left-0 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />
      <div className="col-span-full mb-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-app-accent">
        {USE_CASE_LABEL[useCaseOf(adapter)]}
      </div>
      <div
        className="font-serif text-[17px] font-medium tracking-[-0.005em]"
        style={{ color: accent }}
      >
        {adapter.name}
      </div>
      {adapter.rating_avg != null && (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-app-text-muted">
          <Star size={10} className="fill-app-accent text-app-accent" strokeWidth={0} />
          {adapter.rating_avg.toFixed(1)}
        </span>
      )}
      <div className="col-span-full mt-1 font-serif text-[13.5px] leading-[1.5] text-app-text-muted">
        {adapter.description}
      </div>
    </article>
  );
}

function CommunityRow({
  who,
  verb,
  count,
  adapter,
  onOpen,
}: {
  who: string;
  verb: string;
  count: number | null;
  adapter: StoreAdapter;
  onOpen: () => void;
}) {
  const accent = useCaseAccent(useCaseOf(adapter));
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-baseline justify-between gap-4.5 border-b border-app-border px-1 py-3.5 text-left hover:bg-app-surface-hover"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="font-serif text-[14.5px] font-medium text-app-text">
          {who}
        </span>
        <span className="font-mono text-[11px] text-app-text-faint">{verb}</span>
        <span
          className="font-serif text-[15px] font-medium tracking-[-0.005em]"
          style={{ color: accent }}
        >
          {adapter.name}
        </span>
      </div>
      <div className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] whitespace-nowrap text-app-text-faint">
        {count ? `${count} this week · ` : ""}
        {compactNum(adapter.downloads)} dl ·{" "}
        <Star size={10} className="fill-app-accent text-app-accent" strokeWidth={0} />
        {adapter.rating_avg != null ? adapter.rating_avg.toFixed(1) : "—"}
      </div>
    </button>
  );
}

/* ---------------------- Tiny helpers ---------------------- */

function issueNumber(): string {
  const start = new Date("2026-01-01").getTime();
  const now = Date.now();
  const weeks = Math.max(1, Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)));
  return `${weeks} · Week of ${new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date())}`;
}

function nextFriday(): string {
  const d = new Date();
  const dow = d.getDay();
  const add = (5 - dow + 7) % 7 || 7;
  const next = new Date(d.getTime() + add * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(next);
}

function leadinFor(n: number): string {
  if (n > 400) return "Four hundred";
  if (n > 300) return "Three hundred";
  if (n > 200) return "Two hundred";
  if (n > 100) return "A hundred";
  if (n > 50) return "Fifty";
  if (n > 20) return "Twenty";
  if (n > 10) return "Ten";
  return "A handful of";
}
