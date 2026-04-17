import { useEffect, useRef, useState } from "react";
import { Check, Hand } from "lucide-react";
import { PRESETS, type Preset } from "../lib/workspace";

type Props = {
  value: Preset;
  onChange: (p: Preset) => void;
};

export function PermissionsPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const activeLabel = PRESETS.find((p) => p.value === value)?.label ?? value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
        title="Permission preset — sets what the agent can do without prompting"
      >
        <Hand size={12} />
        {activeLabel}
        <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-60">
          <path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" strokeWidth="1.3" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-40 mb-2 w-72 overflow-hidden rounded-xl border border-app-border bg-app-bg shadow-2xl">
          <ul className="py-1">
            {PRESETS.map((p) => {
              const isActive = p.value === value;
              return (
                <li key={p.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(p.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-app-surface-hover ${
                      isActive ? "text-app-text" : "text-app-text-muted"
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.label}</span>
                        {isActive && <Check size={12} className="text-app-purple" />}
                      </div>
                      <div className="mt-0.5 text-[11px] leading-snug text-app-text-faint">
                        {p.description}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
