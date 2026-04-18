import { ArrowLeft, Sparkles, Trash2 } from "lucide-react";
import { adapterAccent } from "../lib/adapter-accent";

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
      <header className="border-b border-app-border px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="rounded-md p-1 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
              title="Back"
            >
              <ArrowLeft size={14} strokeWidth={2} />
            </button>
            <h2 className="text-[15px] font-semibold text-app-text">
              Adapters
            </h2>
            <span className="font-mono text-[11px] text-app-text-faint">
              · {adapters.length} loaded
            </span>
          </div>
          <button
            onClick={onOpenStore}
            className="flex items-center gap-1.5 rounded-md border border-app-border px-2.5 py-1 font-mono text-[11px] text-app-text-muted hover:border-app-border-strong hover:text-app-text"
          >
            <Sparkles size={11} strokeWidth={2} />
            browse store
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-3xl">
          {adapters.length === 0 ? (
            <div className="py-12 text-center font-mono text-[12px] text-app-text-muted">
              no adapters loaded. install one from the store, or use{" "}
              <span className="text-app-text">Load from disk</span>.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {adapters.map((a) => {
                const active = a.name === activeAdapter;
                const accent = adapterAccent(a.name);
                return (
                  <article
                    key={a.name}
                    className="relative overflow-hidden rounded-md border border-app-border bg-app-surface p-3.5"
                  >
                    <span
                      aria-hidden
                      className="absolute top-0 left-0 h-full"
                      style={{
                        width: active ? "3px" : "2px",
                        backgroundColor: active
                          ? "var(--color-app-accent)"
                          : accent.text,
                      }}
                    />
                    <div className="flex items-start justify-between gap-4 pl-1.5">
                      <div className="min-w-0">
                        <h3
                          className="font-mono text-[13px] font-medium"
                          style={{ color: accent.text }}
                        >
                          {a.name}
                        </h3>
                        <div className="mt-1 font-mono text-[10px] text-app-text-faint">
                          {a.path}
                        </div>
                        {a.base_sha && (
                          <div className="mt-0.5 font-mono text-[10px] text-app-text-faint">
                            base {a.base_sha.slice(0, 16)}…
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => onPickActive(active ? null : a.name)}
                          disabled={busy}
                          role="switch"
                          aria-checked={active}
                          title={
                            active ? "Deactivate adapter" : "Activate adapter"
                          }
                          className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-app-surface-hover disabled:opacity-50"
                        >
                          <span
                            className={`font-mono text-[11px] font-medium ${
                              active
                                ? "text-app-accent"
                                : "text-app-text-faint"
                            }`}
                          >
                            {active ? "active" : "inactive"}
                          </span>
                          <span
                            className={`relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors ${
                              active ? "bg-app-accent" : "bg-app-border"
                            }`}
                          >
                            <span
                              className={`absolute top-[2px] h-3 w-3 rounded-full bg-app-text shadow transition-transform ${
                                active
                                  ? "translate-x-[14px]"
                                  : "translate-x-[2px]"
                              }`}
                            />
                          </span>
                        </button>
                        <button
                          onClick={() => onUnload(a.name)}
                          disabled={busy}
                          title="Unload from cache"
                          className="rounded-md p-1 text-app-text-faint opacity-60 transition-opacity hover:bg-app-surface-hover hover:text-app-danger hover:opacity-100"
                        >
                          <Trash2 size={12} strokeWidth={2} />
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
