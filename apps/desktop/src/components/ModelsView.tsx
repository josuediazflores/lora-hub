import { ArrowLeft, Check, Download } from "lucide-react";
import type { StoreBase } from "../lib/store";

type Props = {
  bases: StoreBase[];
  activeBaseId: string | null;
  busy: boolean;
  onLoad: (base: StoreBase) => void;
  onBack: () => void;
};

export function ModelsView({ bases, activeBaseId, busy, onLoad, onBack }: Props) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-app-border px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
          >
            <ArrowLeft size={16} />
          </button>
          <h2 className="text-lg font-semibold">Models</h2>
          <span className="text-xs text-app-text-faint">
            {bases.length} curated base{bases.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {bases.map((b) => {
            const active = b.base_id === activeBaseId;
            return (
              <article
                key={b.base_id}
                className="rounded-xl border border-app-border bg-app-surface p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-medium text-app-text">{b.name}</h3>
                    <div className="mt-0.5 text-xs text-app-text-faint">
                      {b.family} · {b.parameters} · {b.quant} ·{" "}
                      {formatBytes(b.size_bytes)} · {b.license}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-app-text-faint">
                      {b.hf_repo}
                    </div>
                    {b.description && (
                      <p className="mt-2 text-sm text-app-text-muted">
                        {b.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onLoad(b)}
                    disabled={busy || active}
                    className={`flex shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                      active
                        ? "cursor-default bg-app-surface-hover text-app-text-muted"
                        : "bg-app-text text-app-bg hover:bg-app-text/90 disabled:opacity-50"
                    }`}
                  >
                    {active ? (
                      <>
                        <Check size={12} />
                        Loaded
                      </>
                    ) : (
                      <>
                        <Download size={12} />
                        Load
                      </>
                    )}
                  </button>
                </div>
                <div className="mt-3 font-mono text-[10px] text-app-text-faint">
                  sha {b.base_sha.slice(0, 16)}…
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
