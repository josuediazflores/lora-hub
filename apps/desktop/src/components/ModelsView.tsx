import { useEffect, useState } from "react";
import { ArrowLeft, Check, Download } from "lucide-react";
import type { StoreBase } from "../lib/store";
import { describeBase } from "../lib/base-descriptions";
import { memoryFit, systemMemoryBytes, type MemoryFit } from "../lib/system";

type Props = {
  bases: StoreBase[];
  activeBaseId: string | null;
  busy: boolean;
  onLoad: (base: StoreBase) => void;
  onBack: () => void;
};

export function ModelsView({ bases, activeBaseId, busy, onLoad, onBack }: Props) {
  const [totalMem, setTotalMem] = useState<number>(0);
  useEffect(() => {
    systemMemoryBytes().then(setTotalMem).catch(() => setTotalMem(0));
  }, []);
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
            · {bases.length} curated base{bases.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {bases.map((b) => {
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
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-app-text-muted">
                      {b.family} · {b.parameters} · {b.quant} ·{" "}
                      {formatBytes(b.size_bytes)} · {b.license}
                    </div>
                    <p className="mt-2 text-[13px] leading-[1.5] text-app-text-muted">
                      {b.description || describeBase(b)}
                    </p>
                  </div>
                  <button
                    onClick={() => onLoad(b)}
                    disabled={busy || active}
                    className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] font-medium ${
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
