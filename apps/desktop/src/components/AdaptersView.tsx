import { ArrowLeft, Sparkles, Trash2 } from "lucide-react";

type AdapterEntry = { name: string; path: string; base_sha: string | null };

type Props = {
  adapters: AdapterEntry[];
  activeAdapter: string | null;
  busy: boolean;
  onUnload: (name: string) => void;
  onPickActive: (name: string | null) => void;
  onOpenStore: () => void;
  onBack: () => void;
};

export function AdaptersView({
  adapters,
  activeAdapter,
  busy,
  onUnload,
  onPickActive,
  onOpenStore,
  onBack,
}: Props) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-app-border px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
            >
              <ArrowLeft size={16} />
            </button>
            <h2 className="text-lg font-semibold">Adapters</h2>
            <span className="text-xs text-app-text-faint">
              {adapters.length} loaded
            </span>
          </div>
          <button
            onClick={onOpenStore}
            className="flex items-center gap-1 rounded-md border border-app-border px-3 py-1.5 text-xs text-app-text-muted hover:border-app-border-strong hover:text-app-text"
          >
            <Sparkles size={12} />
            Browse store
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl">
          {adapters.length === 0 ? (
            <div className="py-12 text-center text-sm text-app-text-muted">
              No adapters loaded. Install one from the store, or use{" "}
              <span className="font-mono text-xs">Load from disk</span>.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {adapters.map((a) => {
                const active = a.name === activeAdapter;
                return (
                  <article
                    key={a.name}
                    className={`rounded-xl border p-4 transition-colors ${
                      active
                        ? "border-app-accent/40 bg-app-accent/5"
                        : "border-app-border bg-app-surface"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="font-medium text-app-text">{a.name}</h3>
                        <div className="mt-1 font-mono text-[10px] text-app-text-faint">
                          {a.path}
                        </div>
                        {a.base_sha && (
                          <div className="mt-0.5 font-mono text-[10px] text-app-text-faint">
                            base sha {a.base_sha.slice(0, 16)}…
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => onPickActive(active ? null : a.name)}
                          disabled={busy}
                          role="switch"
                          aria-checked={active}
                          title={active ? "Deactivate adapter" : "Activate adapter"}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-app-surface-hover disabled:opacity-50"
                        >
                          <span
                            className={`font-medium ${
                              active ? "text-app-accent" : "text-app-text-faint"
                            }`}
                          >
                            {active ? "Active" : "Inactive"}
                          </span>
                          <span
                            className={`relative inline-block h-[18px] w-8 shrink-0 rounded-full transition-colors ${
                              active ? "bg-app-accent" : "bg-app-border"
                            }`}
                          >
                            <span
                              className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                                active ? "translate-x-[16px]" : "translate-x-[2px]"
                              }`}
                            />
                          </span>
                        </button>
                        <button
                          onClick={() => onUnload(a.name)}
                          disabled={busy}
                          title="Unload from cache"
                          className="rounded-md p-1.5 text-app-text-faint hover:bg-app-surface-hover hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
