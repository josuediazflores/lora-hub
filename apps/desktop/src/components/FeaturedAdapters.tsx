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
    <div className="mx-auto mt-7 max-w-2xl">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-app-text-faint">
        try an adapter
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {adapters.map((a) => {
          const accent = adapterAccent(a.slug);
          const installed = installedSlugs.has(a.slug);
          return (
            <button
              key={a.slug}
              onClick={() => onTry(a)}
              className="group relative flex flex-col items-start gap-1.5 overflow-hidden rounded-md border border-app-border bg-app-surface p-3 text-left transition-colors hover:border-app-border-strong"
            >
              <span
                aria-hidden
                className="absolute top-0 left-0 h-full w-[3px]"
                style={{ backgroundColor: accent.text }}
              />
              <div className="flex w-full items-center justify-between pl-1.5">
                <span
                  className="font-mono text-[11px] font-medium"
                  style={{ color: accent.text }}
                >
                  {a.name}
                </span>
                <Play
                  size={11}
                  strokeWidth={2}
                  className="text-app-text-faint transition-colors group-hover:text-app-accent"
                />
              </div>
              <div className="pl-1.5 font-mono text-[10px] text-app-text-faint">
                by {a.author}
              </div>
              <p className="line-clamp-2 pl-1.5 text-[12px] leading-[1.45] text-app-text-muted">
                {a.description}
              </p>
              {installed && (
                <span className="pl-1.5 font-mono text-[10px] text-app-text-faint">
                  · installed
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
