import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Play, Star } from "lucide-react";
import { fetchAdapter, type AdapterDetail as AdapterDetailRecord } from "../lib/store";
import {
  compactNum,
  detailExtras,
  formatBytes,
  sizeOf,
  useCaseOf,
  USE_CASE_LABEL,
  versionOf,
  type DetailExample,
  type DetailExtras,
} from "../lib/editorial-data";
import { useCaseAccent } from "../lib/adapter-accent";

type Props = {
  slug: string;
  baseSha: string | null;
  baseLabel: string;
  installed: boolean;
  busy: boolean;
  onInstall: () => void;
  onTry: () => void;
  onManage: () => void;
  onBack: () => void;
};

export function AdapterSpecSheet({
  slug,
  baseSha,
  baseLabel,
  installed,
  busy,
  onInstall,
  onTry,
  onManage,
  onBack,
}: Props) {
  const [detail, setDetail] = useState<AdapterDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exampleId, setExampleId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdapter(slug)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
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
  }, [slug]);

  const extras: DetailExtras | null = useMemo(
    () => (detail ? detailExtras(detail.adapter) : null),
    [detail],
  );

  useEffect(() => {
    if (extras && !exampleId) setExampleId(extras.examples[0]?.id ?? null);
  }, [extras, exampleId]);

  const compat: "ok" | "warn" = useMemo(() => {
    if (!detail || !baseSha) return "ok";
    if (!detail.adapter.base_sha) return "ok";
    return detail.adapter.base_sha === baseSha ? "ok" : "warn";
  }, [detail, baseSha]);

  if (loading) {
    return (
      <PageShell onBack={onBack}>
        <div className="py-16 text-center font-mono text-[12px] text-app-text-muted">
          loading…
        </div>
      </PageShell>
    );
  }
  if (error || !detail || !extras) {
    return (
      <PageShell onBack={onBack}>
        <div className="py-16 text-center font-mono text-[12px] text-app-danger">
          couldn&rsquo;t load adapter: {error ?? "not found"}
        </div>
      </PageShell>
    );
  }

  const a = detail.adapter;
  const useCase = useCaseOf(a);
  const accent = useCaseAccent(useCase);
  const example = extras.examples.find((e) => e.id === exampleId) ?? extras.examples[0];
  const version = detail.versions[0];
  const versionLabel = version?.version ?? versionOf(a);
  const size = version?.weights_size ?? sizeOf(a);
  const publishedAt = a.published_at
    ? new Date(a.published_at * 1000).toISOString().slice(0, 10)
    : "—";

  return (
    <PageShell onBack={onBack}>
      <div className="mx-auto max-w-[1120px] px-8 pt-5 pb-16">
        {/* ------- Hero ------- */}
        <header className="mb-7">
          <Eyebrow useCase={useCase} />
          <h1 className="mt-1 font-mono text-[34px] font-medium leading-[1.1] tracking-[-0.01em] text-app-text">
            {a.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[12px] text-app-text-muted">
            <span>by</span>
            <span className="border-b border-app-border-strong text-app-text">
              {extras.authorHandle}
            </span>
            {extras.authorVerified && (
              <span className="text-app-accent">✓ verified</span>
            )}
            <Sep /> <span>v{versionLabel}</span>
            <Sep /> <span>{a.license}</span>
            <Sep /> <span>{formatBytes(size)}</span>
          </div>

          <p className="mt-4.5 max-w-[760px] font-serif text-[20px] leading-[1.42] text-app-text">
            {extras.tagline}
          </p>

          <div className="mt-5 flex flex-wrap items-stretch gap-3">
            <CompatBanner compat={compat} sessionBase={baseLabel} adapterBase={a.base_id} />
            <StatCluster
              ratingAvg={a.rating_avg}
              ratingCount={a.rating_count}
              downloads={a.downloads}
              version={versionLabel}
              publishedAt={publishedAt}
              size={size}
              license={a.license}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-app-border bg-app-surface px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <strong className="text-[13px] font-semibold text-app-text">
                Install to this session
              </strong>
              <span className="font-mono text-[11px] text-app-text-muted">
                {formatBytes(size)} · weights cached locally · reversible
              </span>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              {installed ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-app-ok/50 bg-app-ok/10 px-3 py-1.5 font-mono text-[11.5px] text-app-ok">
                    <span className="inline-block h-2 w-2 rounded-full bg-app-ok" />
                    installed
                  </span>
                  <button
                    onClick={onManage}
                    className="rounded-md border border-app-border-strong px-3 py-1.5 font-mono text-[11.5px] text-app-text hover:bg-app-surface-hover"
                  >
                    manage
                  </button>
                </>
              ) : compat === "ok" ? (
                <>
                  {a.demo_prompt && (
                    <button
                      onClick={onTry}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-app-purple px-3 py-1.5 font-mono text-[11.5px] text-app-purple hover:bg-app-purple/10 disabled:opacity-50"
                    >
                      <Play size={10} fill="currentColor" strokeWidth={0} />
                      try first
                    </button>
                  )}
                  <button
                    onClick={onInstall}
                    disabled={busy}
                    className="rounded-md bg-app-accent px-3 py-1.5 font-mono text-[11.5px] font-medium text-app-bg hover:bg-app-accent-soft disabled:opacity-50"
                  >
                    install {a.name}
                  </button>
                </>
              ) : (
                <>
                  <button
                    disabled
                    className="cursor-not-allowed rounded-md bg-app-surface-hover px-3 py-1.5 font-mono text-[11.5px] font-medium text-app-text-muted"
                  >
                    install blocked — base mismatch
                  </button>
                  <button
                    className="rounded-md border border-app-border-strong px-3 py-1.5 font-mono text-[11.5px] text-app-text hover:bg-app-surface-hover"
                    title="Request the author port this adapter to your base"
                  >
                    request port
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {/* ------- Section 01: Side-by-side ------- */}
        {example && (
          <Section
            number="01"
            title="side-by-side"
            dek={`same prompt · base vs adapter · ${extras.examples.length} curated example${extras.examples.length === 1 ? "" : "s"}`}
          >
            <PromptBar
              examples={extras.examples}
              exampleId={example.id}
              onPick={setExampleId}
            />
            <blockquote
              className="mt-3 rounded-[0_4px_4px_0] border-l-2 bg-app-surface px-3.5 py-2.5 font-serif text-[15px] text-app-text italic"
              style={{ borderColor: "var(--color-app-accent)" }}
            >
              “{example.prompt}”
            </blockquote>
            <div
              className="mt-3 grid grid-cols-2"
              style={{
                backgroundColor: "var(--color-app-border)",
                columnGap: "1px",
                border: "1px solid var(--color-app-border)",
                borderRadius: "6px",
                overflow: "hidden",
              }}
            >
              <DiffPane
                label={`base · ${baseLabel}`}
                dotColor="var(--color-app-text-faint)"
                latencyMs={example.base.latencyMs}
                body={example.base.body}
                muted
              />
              <DiffPane
                label={`+ ${a.name} ${versionLabel}`}
                dotColor={accent}
                latencyMs={example.adapter.latencyMs}
                body={example.adapter.body}
              />
            </div>
            <ul className="mt-4 list-disc space-y-1 pl-5 font-serif text-[14.5px] text-app-text-muted">
              {example.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </Section>
        )}

        {/* ------- Section 02: What this changes ------- */}
        <Section
          number="02"
          title="what this changes"
          dek="behavioral delta, not marketing"
        >
          <div className="max-w-[720px] space-y-4 font-serif text-[15px] leading-[1.65] text-app-text">
            {extras.whatChanges.map((p, i) => (
              <p
                key={i}
                className="[&_b]:rounded-sm [&_b]:bg-app-surface [&_b]:px-1 [&_b]:py-[1px] [&_b]:font-mono [&_b]:text-[14px] [&_b]:font-medium [&_b]:text-app-text"
                dangerouslySetInnerHTML={{ __html: p }}
              />
            ))}
          </div>
        </Section>

        {/* ------- Section 03: Compatibility matrix ------- */}
        <Section
          number="03"
          title="compatibility"
          dek={`tested against ${extras.compat.length} base models`}
        >
          <div
            className="grid gap-x-4 gap-y-0"
            style={{ gridTemplateColumns: "200px 120px 100px 1fr" }}
          >
            <MatrixHead>base model</MatrixHead>
            <MatrixHead>status</MatrixHead>
            <MatrixHead>size delta</MatrixHead>
            <MatrixHead>notes</MatrixHead>
            {extras.compat.map((row) => (
              <MatrixRow key={row.base} row={row} />
            ))}
          </div>
        </Section>

        {/* ------- Section 04: Versions ------- */}
        <Section
          number="04"
          title="versions"
          dek={`${detail.versions.length} release${detail.versions.length === 1 ? "" : "s"} · ${compactNum(a.downloads)} total downloads`}
        >
          <div className="overflow-hidden rounded-md border border-app-border">
            <div
              className="grid border-b border-app-border bg-app-bg px-3 py-2 font-mono text-[10px] tracking-[0.12em] uppercase text-app-text-faint"
              style={{ gridTemplateColumns: "100px 120px 1fr 100px" }}
            >
              <div>version</div>
              <div>published</div>
              <div>notes</div>
              <div className="text-right">downloads</div>
            </div>
            {detail.versions.map((v, i) => (
              <div
                key={v.version}
                className={`grid items-center border-b border-app-border px-3 py-2.5 last:border-b-0 ${
                  i === 0
                    ? "bg-[color-mix(in_oklab,var(--color-app-accent)_4%,transparent)]"
                    : ""
                }`}
                style={{ gridTemplateColumns: "100px 120px 1fr 100px" }}
              >
                <div className="font-mono text-[12px] text-app-text">
                  v{v.version}
                  {i === 0 && (
                    <span className="ml-1.5 rounded-[2px] bg-app-accent/20 px-1 py-[1px] font-mono text-[9px] text-app-accent">
                      latest
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-app-text-muted">
                  {v.version}
                </div>
                <div className="truncate font-serif text-[13px] italic text-app-text-muted">
                  {v.notes ?? "—"}
                </div>
                <div className="text-right font-mono text-[11px] text-app-text-muted">
                  {compactNum(Math.floor(a.downloads * (i === 0 ? 0.6 : 0.4 / detail.versions.length)))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ------- Section 05: Caveats ------- */}
        <Section
          number="05"
          title="caveats"
          dek="what the author wants you to know"
        >
          <div className="max-w-[720px] font-serif text-[15px] leading-[1.65] text-app-text">
            <ul className="list-disc space-y-2 pl-5 text-app-text-muted">
              {extras.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        </Section>

        {/* ------- Section 06: Reviews ------- */}
        <Section
          number="06"
          title="reviews"
          dek={`${compactNum(a.rating_count)} verified installs`}
        >
          <div
            className="grid"
            style={{ gridTemplateColumns: "260px 1fr", gap: "32px" }}
          >
            <ReviewStats
              avg={a.rating_avg ?? 0}
              count={a.rating_count}
              hist={extras.ratingHist}
            />
            <div className="flex flex-col gap-3">
              {extras.reviews.map((r, i) => (
                <ReviewCard key={i} review={r} />
              ))}
            </div>
          </div>
        </Section>

        {/* ------- Section 07: Used with ------- */}
        <Section
          number="07"
          title="used with"
          dek={`adapters commonly stacked with ${a.name}`}
        >
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
          >
            {extras.usedWith.map((u) => (
              <a
                key={u.slug}
                className="rounded-[5px] border border-app-border bg-app-surface px-3.5 py-3 transition-colors hover:border-app-border-strong"
              >
                <div className="font-mono text-[12.5px] text-app-text">{u.name}</div>
                <div className="mt-1 line-clamp-2 font-serif text-[13px] text-app-text-muted">
                  {u.description}
                </div>
              </a>
            ))}
          </div>
        </Section>
      </div>
    </PageShell>
  );
}

/* ---------------------- Page chrome & primitives ---------------------- */

function PageShell({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-app-border px-5 py-2.5">
        <button
          onClick={onBack}
          title="Back"
          className="rounded-md p-1 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
        >
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <span className="font-mono text-[11px] text-app-text-faint">adapter detail</span>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function Eyebrow({ useCase }: { useCase: string }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-app-text-faint">
      STORE / {USE_CASE_LABEL[useCase as keyof typeof USE_CASE_LABEL]?.toUpperCase() ?? useCase.toUpperCase()}{" "}
      /{" "}
      <b className="font-semibold text-app-accent">ADAPTER DETAIL</b>
    </div>
  );
}

function Sep() {
  return <span className="text-app-text-faint">·</span>;
}

function Section({
  number,
  title,
  dek,
  children,
}: {
  number: string;
  title: string;
  dek: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="mb-4.5 flex items-baseline justify-between gap-4 border-b border-app-border pb-2.5">
        <div>
          <div className="font-mono text-[11px] font-medium tracking-[0.22em] uppercase text-app-accent">
            {number} · {title}
          </div>
        </div>
        <div className="font-mono text-[10.5px] text-app-text-faint">{dek}</div>
      </div>
      {children}
    </section>
  );
}

/* ---------------------- Hero bits ---------------------- */

function CompatBanner({
  compat,
  sessionBase,
  adapterBase,
}: {
  compat: "ok" | "warn";
  sessionBase: string;
  adapterBase: string;
}) {
  if (compat === "ok") {
    return (
      <div
        className="inline-flex items-center gap-2 self-start rounded-[4px] border px-2.5 py-[5px] font-mono text-[11.5px]"
        style={{
          backgroundColor: "color-mix(in oklab, var(--color-app-ok) 8%, transparent)",
          borderColor: "color-mix(in oklab, var(--color-app-ok) 40%, transparent)",
          color: "var(--color-app-ok)",
        }}
      >
        <Check size={12} strokeWidth={3} />
        <span>
          compatible with <b className="font-semibold">{sessionBase}</b>
        </span>
      </div>
    );
  }
  return (
    <div
      className="inline-flex items-center gap-2 self-start rounded-[4px] border px-2.5 py-[5px] font-mono text-[11.5px]"
      style={{
        backgroundColor: "color-mix(in oklab, var(--color-app-warn) 8%, transparent)",
        borderColor: "color-mix(in oklab, var(--color-app-warn) 45%, transparent)",
        color: "var(--color-app-warn)",
      }}
    >
      <AlertTriangle size={12} strokeWidth={2.5} />
      <span>
        base mismatch — your session runs <b className="font-semibold">{sessionBase}</b>
        , this adapter needs <b className="font-semibold">{adapterBase}</b>
      </span>
    </div>
  );
}

function StatCluster({
  ratingAvg,
  ratingCount,
  downloads,
  version,
  publishedAt,
  size,
  license,
}: {
  ratingAvg: number | null;
  ratingCount: number;
  downloads: number;
  version: string;
  publishedAt: string;
  size: number;
  license: string;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-app-border bg-app-surface">
      <StatCell label="rating" accent>
        <Star size={10} className="mr-0.5 inline fill-app-accent text-app-accent" strokeWidth={0} />
        {ratingAvg != null ? ratingAvg.toFixed(1) : "—"}
        <span className="ml-1 font-mono text-[11px] text-app-text-faint">
          · {compactNum(ratingCount)}
        </span>
      </StatCell>
      <StatCell label="downloads">{compactNum(downloads)}</StatCell>
      <StatCell label="version">
        {version} · {publishedAt}
      </StatCell>
      <StatCell label="size">{formatBytes(size)}</StatCell>
      <StatCell label="license" last>
        {license}
      </StatCell>
    </div>
  );
}

function StatCell({
  label,
  children,
  accent,
  last,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex flex-col justify-center px-3.5 py-2 ${
        !last ? "border-r border-app-border" : ""
      }`}
    >
      <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-app-text-faint">
        {label}
      </span>
      <span
        className={`mt-0.5 font-mono text-[13px] whitespace-nowrap ${
          accent ? "text-app-accent" : "text-app-text"
        }`}
      >
        {children}
      </span>
    </div>
  );
}

/* ---------------------- Diff canvas ---------------------- */

function PromptBar({
  examples,
  exampleId,
  onPick,
}: {
  examples: DetailExample[];
  exampleId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-app-border bg-app-surface px-4 py-2.5 font-mono text-[12px]">
      <span className="text-app-text-faint">PROMPT</span>
      <div className="flex flex-wrap gap-1.5">
        {examples.map((e) => (
          <button
            key={e.id}
            onClick={() => onPick(e.id)}
            className={`rounded-[999px] border px-2.5 py-[2px] transition-colors ${
              e.id === exampleId
                ? "border-app-accent/70 bg-app-accent/10 text-app-accent"
                : "border-app-border text-app-text-muted hover:border-app-border-strong hover:text-app-text"
            }`}
          >
            {e.label}
            {e.id === exampleId && " · active"}
          </button>
        ))}
      </div>
    </div>
  );
}

function DiffPane({
  label,
  dotColor,
  latencyMs,
  body,
  muted,
}: {
  label: string;
  dotColor: string;
  latencyMs: number;
  body: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col bg-app-bg">
      <div className="flex items-center justify-between border-b border-app-border bg-app-surface-raised px-3 py-2 font-mono text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-app-text">
          <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ backgroundColor: dotColor }} />
          {label}
        </span>
        <span className="text-app-text-faint">{latencyMs}ms</span>
      </div>
      <pre
        className={`min-h-[380px] overflow-x-auto px-3 py-3 font-mono text-[12.5px] leading-[1.55] ${
          muted ? "text-app-text-muted" : "text-app-text"
        }`}
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {body}
      </pre>
    </div>
  );
}

/* ---------------------- Compat matrix row ---------------------- */

function MatrixHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-app-border pb-2 font-mono text-[10px] tracking-[0.12em] uppercase text-app-text-faint">
      {children}
    </div>
  );
}

function MatrixRow({
  row,
}: {
  row: { base: string; status: "ok" | "untested"; sizeDelta: string; notes: string };
}) {
  return (
    <>
      <div className="border-t border-app-border py-2.5 font-mono text-[12px] text-app-text">
        {row.base}
      </div>
      <div
        className={`border-t border-app-border py-2.5 font-mono text-[12px] ${
          row.status === "ok" ? "text-app-ok" : "text-app-text-faint"
        }`}
      >
        {row.status === "ok" ? "✓ ok" : "— untested"}
      </div>
      <div className="border-t border-app-border py-2.5 font-mono text-[12px] text-app-text-muted">
        {row.sizeDelta}
      </div>
      <div className="border-t border-app-border py-2.5 font-mono text-[12px] text-app-text-muted">
        {row.notes}
      </div>
    </>
  );
}

/* ---------------------- Reviews ---------------------- */

function ReviewStats({
  avg,
  count,
  hist,
}: {
  avg: number;
  count: number;
  hist: [number, number, number, number, number];
}) {
  const total = Math.max(1, hist.reduce((a, b) => a + b, 0));
  return (
    <div className="flex flex-col gap-2.5">
      <div className="font-serif text-[48px] leading-none text-app-accent">
        {avg.toFixed(1)}
        <sub className="ml-1 font-mono text-[14px] font-normal text-app-text-faint">
          /5
        </sub>
      </div>
      <div className="font-mono text-[11.5px] text-app-text-muted">
        based on {compactNum(count)} reviews
      </div>
      <div className="mt-3 space-y-1.5">
        {[5, 4, 3, 2, 1].map((n, i) => {
          const c = hist[i];
          const pct = Math.round((c / total) * 100);
          return (
            <div
              key={n}
              className="grid items-center gap-2"
              style={{ gridTemplateColumns: "20px 1fr 40px" }}
            >
              <span className="font-mono text-[11px] text-app-text-muted">{n}★</span>
              <div className="relative h-[6px] overflow-hidden rounded-full bg-app-border">
                <div
                  className="absolute top-0 bottom-0 left-0 bg-app-accent"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-right font-mono text-[10.5px] text-app-text-muted">
                {compactNum(c)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewCard({
  review,
}: {
  review: {
    handle: string;
    verified: boolean;
    date: string;
    stars: number;
    body: string;
    base: string;
  };
}) {
  return (
    <article className="rounded-md border border-app-border bg-app-surface px-5 py-4">
      <div className="flex items-center justify-between font-mono text-[12px] text-app-text">
        <span className="inline-flex items-center gap-2">
          <span>{review.handle}</span>
          {review.verified && (
            <span
              className="rounded-[999px] px-1.5 py-[1px] font-mono text-[9px] tracking-[0.08em] uppercase"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--color-app-ok) 8%, transparent)",
                color: "var(--color-app-ok)",
              }}
            >
              verified install
            </span>
          )}
        </span>
        <span className="text-app-text-faint">{review.date}</span>
      </div>
      <div className="mt-1.5 text-app-accent">
        {"★".repeat(review.stars)}
        <span className="text-app-text-faint">{"☆".repeat(5 - review.stars)}</span>
      </div>
      <div className="mt-2 font-serif text-[14px] leading-[1.55] text-app-text">
        {review.body}
      </div>
      <div className="mt-2 font-mono text-[10.5px] text-app-text-faint">
        on {review.base}
      </div>
    </article>
  );
}
