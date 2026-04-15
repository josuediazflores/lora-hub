import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Star, Tag } from "lucide-react";
import type { StoreAdapter } from "../lib/store";
import { fetchAdapters } from "../lib/store";

type Props = {
  baseSha: string | null;
  baseLabel: string;
  installedSlugs: Set<string>;
  busy: boolean;
  onInstall: (adapter: StoreAdapter) => void;
  onBack: () => void;
};

export function StoreView({
  baseSha,
  baseLabel,
  installedSlugs,
  busy,
  onInstall,
  onBack,
}: Props) {
  const [adapters, setAdapters] = useState<StoreAdapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compatibleOnly, setCompatibleOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const bases = compatibleOnly && baseSha ? [baseSha] : undefined;
    fetchAdapters({ bases, q: search || undefined, sort: "downloads" })
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

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of adapters) {
      for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);
  }, [adapters]);

  const visible = activeTag
    ? adapters.filter((a) => a.tags.includes(activeTag))
    : adapters;

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-app-border px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
            >
              <ArrowLeft size={16} />
            </button>
            <h2 className="text-lg font-semibold">Adapter store</h2>
            <span className="text-xs text-app-text-faint">
              for {baseLabel}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-app-text-muted">
              <input
                type="checkbox"
                checked={compatibleOnly}
                onChange={(e) => setCompatibleOnly(e.target.checked)}
                className="accent-app-accent"
              />
              Only compatible
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search adapters…"
              className="w-64 rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text placeholder:text-app-text-faint focus:border-app-border-strong focus:outline-none"
            />
          </div>
        </div>

        {tags.length > 0 && (
          <div className="mx-auto mt-3 flex max-w-5xl flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag(null)}
              className={`rounded-full border px-3 py-1 text-xs ${
                activeTag === null
                  ? "border-app-accent bg-app-accent/10 text-app-accent"
                  : "border-app-border text-app-text-muted hover:bg-app-surface"
              }`}
            >
              all
            </button>
            {tags.map((t) => (
              <button
                key={t}
                onClick={() => setActiveTag(t === activeTag ? null : t)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  activeTag === t
                    ? "border-app-accent bg-app-accent/10 text-app-accent"
                    : "border-app-border text-app-text-muted hover:bg-app-surface"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-5xl">
          {loading && (
            <div className="py-12 text-center text-sm text-app-text-muted">
              Loading…
            </div>
          )}
          {error && (
            <div className="rounded-md border border-app-accent/30 bg-app-accent/10 px-4 py-3 text-sm text-app-accent">
              Couldn't reach the storefront ({error}). Make sure
              <code className="mx-1 rounded bg-app-surface px-1">
                npm run dev
              </code>
              is running in <code>storefront/</code>.
            </div>
          )}
          {!loading && !error && visible.length === 0 && (
            <div className="py-12 text-center text-sm text-app-text-muted">
              {compatibleOnly && !baseSha
                ? "Load a base model first to see compatible adapters."
                : "No adapters match."}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {visible.map((a) => (
              <AdapterCard
                key={a.slug}
                adapter={a}
                installed={installedSlugs.has(a.slug)}
                disabled={busy}
                onInstall={() => onInstall(a)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdapterCard({
  adapter,
  installed,
  disabled,
  onInstall,
}: {
  adapter: StoreAdapter;
  installed: boolean;
  disabled: boolean;
  onInstall: () => void;
}) {
  return (
    <article className="flex flex-col justify-between rounded-xl border border-app-border bg-app-surface p-4 text-sm transition-colors hover:border-app-border-strong">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-medium text-app-text">{adapter.name}</h3>
            <div className="mt-0.5 text-xs text-app-text-faint">
              by {adapter.author} · {adapter.license}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-app-text-muted">
            {adapter.rating_avg != null && (
              <span className="flex items-center gap-0.5">
                <Star size={12} className="fill-app-accent text-app-accent" />
                {adapter.rating_avg.toFixed(1)}
              </span>
            )}
            <span className="flex items-center gap-0.5">
              <Download size={12} />
              {compact(adapter.downloads)}
            </span>
          </div>
        </div>
        <p className="mt-2 line-clamp-3 text-sm text-app-text-muted">
          {adapter.description}
        </p>
        {adapter.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {adapter.tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-app-border px-2 py-0.5 text-[11px] text-app-text-faint"
              >
                <Tag size={10} />
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={onInstall}
          disabled={disabled || installed}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            installed
              ? "cursor-default bg-app-surface-hover text-app-text-muted"
              : "bg-app-text text-app-bg hover:bg-app-text/90 disabled:opacity-50"
          }`}
        >
          {installed ? "Installed" : "Install"}
        </button>
      </div>
    </article>
  );
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
