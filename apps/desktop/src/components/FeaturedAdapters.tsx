import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { fetchAdapters, type StoreAdapter } from "../lib/store";
import { adapterAccent } from "../lib/adapter-accent";

type Props = {
  baseSha: string;
  installedSlugs: Set<string>;
  onTry: (adapter: StoreAdapter) => void;
};

export function FeaturedAdapters({ baseSha, installedSlugs, onTry }: Props) {
  const [adapters, setAdapters] = useState<StoreAdapter[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAdapters({ bases: [baseSha], sort: "downloads", limit: 6 })
      .then((rows) => {
        if (cancelled) return;
        setAdapters(rows.filter((a) => !!a.demo_prompt).slice(0, 3));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [baseSha]);

  if (!loaded || adapters.length === 0) return null;

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-app-text-faint">
        Try an adapter
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {adapters.map((a) => {
          const accent = adapterAccent(a.slug);
          const installed = installedSlugs.has(a.slug);
          return (
            <button
              key={a.slug}
              onClick={() => onTry(a)}
              className="group flex flex-col items-start gap-2 rounded-xl border bg-app-surface p-3 text-left transition-colors hover:border-app-border-strong"
              style={{ borderColor: accent.border }}
            >
              <div className="flex w-full items-center justify-between">
                <span
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: accent.bg,
                    color: accent.text,
                    borderColor: accent.border,
                  }}
                >
                  {a.name}
                </span>
                <Play
                  size={12}
                  className="text-app-text-faint group-hover:text-app-accent"
                />
              </div>
              <div className="text-[11px] text-app-text-faint">by {a.author}</div>
              <p className="line-clamp-2 text-xs text-app-text-muted">
                {a.description}
              </p>
              {installed && (
                <span className="text-[10px] text-app-text-faint">installed</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
