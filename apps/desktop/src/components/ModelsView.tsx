import { useEffect, useState } from "react";
import { ArrowLeft, Check, Download, Trash2 } from "lucide-react";
import type { StoreBase } from "../lib/store";
import { describeBase } from "../lib/base-descriptions";
import { memoryFit, systemMemoryBytes, type MemoryFit } from "../lib/system";

type Props = {
  bases: StoreBase[];
  activeBaseId: string | null;
  busy: boolean;
  /** Lowercased `org/repo` IDs of every HF model materialized on disk.
   * Rows whose `hf_repo` is in this set render a "downloaded" badge
   * so users can tell hot-loads from fresh downloads at a glance. */
  cachedRepos: Set<string>;
  onLoad: (base: StoreBase) => void;
  onDelete?: (base: StoreBase) => void;
  onBack: () => void;
};

export function ModelsView({ bases, activeBaseId, busy, cachedRepos, onLoad, onDelete, onBack }: Props) {
  const [totalMem, setTotalMem] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [onlyDownloaded, setOnlyDownloaded] = useState(false);
  const [onlyFits, setOnlyFits] = useState(false);
  useEffect(() => {
    systemMemoryBytes().then(setTotalMem).catch(() => setTotalMem(0));
  }, []);

  // Families come from the data — avoids hardcoding the list if we
  // later add more (e.g. a Gemma 5 tier).
  const families = Array.from(new Set(bases.map((b) => b.parameters)));

  const filtered = bases.filter((b) => {
    if (family && b.parameters !== family) return false;
    if (onlyDownloaded && !cachedRepos.has(b.hf_repo.toLowerCase())) return false;
    if (onlyFits && memoryFit(b.size_bytes, totalMem) !== "fits") return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !b.name.toLowerCase().includes(q) &&
        !b.hf_repo.toLowerCase().includes(q) &&
        !b.quant.toLowerCase().includes(q) &&
        !b.parameters.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-app-border px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button
            onClick={onBack}
            className="rounded-md p-1 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
            title="Back"
          >
            <ArrowLeft size={14} strokeWidth={2} />
          </button>
          <h2 className="text-[15px] font-semibold text-app-text">Models</h2>
          <span className="font-mono text-[11px] text-app-text-faint">
            · {filtered.length}
            {filtered.length !== bases.length ? ` / ${bases.length}` : ""} curated
            base{bases.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="border-b border-app-border px-6 py-3">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search"
            className="w-36 rounded-md border border-app-border bg-app-surface px-2.5 py-1 font-mono text-[11px] text-app-text placeholder:text-app-text-faint focus:border-app-border-strong focus:outline-none"
          />
          <div className="inline-flex rounded-md border border-app-border bg-app-surface p-0.5">
            <FamilyChip
              label="all"
              active={family === null}
              onClick={() => setFamily(null)}
            />
            {families.map((f) => (
              <FamilyChip
                key={f}
                label={f}
                active={family === f}
                onClick={() => setFamily(family === f ? null : f)}
              />
            ))}
          </div>
          <ToggleChip
            label="downloaded"
            active={onlyDownloaded}
            onClick={() => setOnlyDownloaded((v) => !v)}
          />
          <ToggleChip
            label="fits your Mac"
            active={onlyFits}
            onClick={() => setOnlyFits((v) => !v)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {filtered.length === 0 && (
            <div className="rounded-md border border-dashed border-app-border px-4 py-6 text-center font-mono text-[11px] text-app-text-faint">
              no models match the current filters
            </div>
          )}
          {filtered.map((b) => {
            const active = b.base_id === activeBaseId;
            const fit = memoryFit(b.size_bytes, totalMem);
            return (
              <article
                key={b.base_id}
                className="rounded-md border border-app-border bg-app-surface p-3.5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-app-text-faint">
                      {b.hf_repo}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-app-text">
                        {b.name}
                      </h3>
                      <FitBadge fit={fit} />
                      {cachedRepos.has(b.hf_repo.toLowerCase()) && <CachedBadge />}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-app-text-muted">
                      {b.family} · {b.parameters} · {b.quant} ·{" "}
                      {formatBytes(b.size_bytes)} · {b.license}
                    </div>
                    <p className="mt-2 text-[13px] leading-[1.5] text-app-text-muted">
                      {b.description || describeBase(b)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!active && cachedRepos.has(b.hf_repo.toLowerCase()) && onDelete && (
                      <button
                        onClick={() => onDelete(b)}
                        disabled={busy}
                        title="Delete cached files to reclaim disk space"
                        className="flex items-center gap-1 rounded-md border border-app-border px-2.5 py-1.5 font-mono text-[11px] text-app-text-muted hover:border-app-danger/50 hover:bg-app-danger/10 hover:text-app-danger disabled:opacity-50"
                      >
                        <Trash2 size={11} strokeWidth={2} />
                        delete
                      </button>
                    )}
                    <button
                      onClick={() => onLoad(b)}
                      disabled={busy || active}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] font-medium ${
                        active
                          ? "cursor-default bg-app-surface-hover text-app-text-muted"
                          : "bg-app-accent text-app-bg hover:bg-app-accent-soft disabled:opacity-50"
                      }`}
                    >
                      {active ? (
                        <>
                          <Check size={11} strokeWidth={2.5} />
                          loaded
                        </>
                      ) : (
                        <>
                          <Download size={11} strokeWidth={2} />
                          load
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div className="mt-2.5 border-t border-app-border pt-2 font-mono text-[10px] text-app-text-faint">
                  sha {b.base_sha.slice(0, 24)}…
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

function FamilyChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2.5 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "bg-app-accent text-white"
          : "text-app-text-muted hover:text-app-text"
      }`}
    >
      {label}
    </button>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "border-app-accent/40 bg-app-accent/10 text-app-accent"
          : "border-app-border bg-app-surface text-app-text-muted hover:text-app-text"
      }`}
    >
      {label}
    </button>
  );
}

function CachedBadge() {
  return (
    <span
      className="rounded-sm border border-app-border bg-app-surface-hover px-1.5 py-[1px] font-mono text-[10px] text-app-text-muted"
      title="Already on disk — loading is instant, no re-download needed"
    >
      downloaded
    </span>
  );
}

function FitBadge({ fit }: { fit: MemoryFit }) {
  if (fit === "unknown") return null;
  const copy = {
    fits: {
      label: "fits your Mac",
      cls: "border-app-ok/40 bg-app-ok/10 text-app-ok",
    },
    tight: {
      label: "tight on RAM",
      cls: "border-app-warn/40 bg-app-warn/10 text-app-warn",
    },
    oom: {
      label: "won't fit",
      cls: "border-app-danger/40 bg-app-danger/10 text-app-danger",
    },
  }[fit];
  return (
    <span
      className={`rounded-sm border px-1.5 py-[1px] font-mono text-[10px] ${copy.cls}`}
    >
      {copy.label}
    </span>
  );
}
