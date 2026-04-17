import { useEffect, useState } from "react";
import { Download, Play, Star, Tag, X } from "lucide-react";
import { fetchAdapter, type AdapterDetail as AdapterDetailType } from "../lib/store";

type Props = {
  slug: string;
  installed: boolean;
  busy: boolean;
  onInstall: () => void;
  onTry: () => void;
  onClose: () => void;
};

export function AdapterDetail({ slug, installed, busy, onInstall, onTry, onClose }: Props) {
  const [detail, setDetail] = useState<AdapterDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-app-border bg-app-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-app-border px-6 py-4">
          <div className="min-w-0">
            {loading ? (
              <div className="text-sm text-app-text-muted">Loading…</div>
            ) : error ? (
              <div className="text-sm text-red-400">Couldn't load: {error}</div>
            ) : detail ? (
              <>
                <h2 className="text-lg font-semibold">{detail.adapter.name}</h2>
                <div className="mt-0.5 text-xs text-app-text-faint">
                  by {detail.adapter.author} · {detail.adapter.license}
                </div>
              </>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {detail && (
            <>
              <div className="mb-4 flex items-center gap-4 text-xs text-app-text-muted">
                {detail.adapter.rating_avg != null && (
                  <span className="flex items-center gap-1">
                    <Star size={12} className="fill-app-accent text-app-accent" />
                    {detail.adapter.rating_avg.toFixed(1)} ({detail.adapter.rating_count})
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Download size={12} />
                  {detail.adapter.downloads.toLocaleString()} installs
                </span>
              </div>

              {detail.adapter.tags.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {detail.adapter.tags.map((t) => (
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

              <p className="mb-6 text-sm text-app-text">{detail.adapter.description}</p>

              {detail.adapter.demo_prompt && (
                <section className="mb-6 rounded-md border border-app-border bg-app-surface p-3">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-app-text-faint">
                    Demo prompt
                  </div>
                  <div className="text-sm text-app-text">
                    {detail.adapter.demo_prompt}
                  </div>
                </section>
              )}

              {detail.adapter.readme_md && (
                <section className="mb-6">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-app-text-faint">
                    README
                  </h3>
                  <pre className="whitespace-pre-wrap rounded-md bg-app-surface px-3 py-2 text-xs text-app-text">
                    {detail.adapter.readme_md}
                  </pre>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-app-text-faint">
                  Versions
                </h3>
                <div className="flex flex-col gap-2">
                  {detail.versions.map((v) => (
                    <div
                      key={v.version}
                      className="rounded-md border border-app-border bg-app-surface px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-app-text">v{v.version}</span>
                        <span className="text-app-text-faint">
                          {formatBytes(v.weights_size)}
                        </span>
                      </div>
                      {v.notes && (
                        <div className="mt-1 text-app-text-muted">{v.notes}</div>
                      )}
                      {v.eval_scores && (
                        <div className="mt-1 flex flex-wrap gap-2 text-app-text-faint">
                          {Object.entries(v.eval_scores).map(([k, val]) => (
                            <span key={k}>
                              <span className="text-app-text-muted">{k}</span>: {val}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-app-border px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
          >
            Close
          </button>
          {detail?.adapter.demo_prompt && (
            <button
              onClick={onTry}
              disabled={busy || loading || !!error}
              className="flex items-center gap-1 rounded-md border border-app-accent px-3 py-1.5 text-xs font-medium text-app-accent hover:bg-app-accent/10 disabled:opacity-50"
            >
              <Play size={12} />
              {installed ? "Run demo" : "Try it"}
            </button>
          )}
          <button
            onClick={onInstall}
            disabled={busy || installed || loading || !!error}
            className={`rounded-md px-4 py-1.5 text-xs font-medium ${
              installed
                ? "cursor-default bg-app-surface-hover text-app-text-muted"
                : "bg-app-text text-app-bg hover:bg-app-text/90 disabled:opacity-50"
            }`}
          >
            {installed ? "Installed" : "Install"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
