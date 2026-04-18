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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
        title="Permission preset — what the agent can do without prompting"
      >
        <Hand size={11} strokeWidth={2} />
        {value}
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          className="opacity-60"
          aria-hidden
        >
          <path
            d="M2 4 L5 7 L8 4"
            stroke="currentColor"
            fill="none"
            strokeWidth="1.3"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-40 mb-2 w-72 overflow-hidden rounded-lg border border-app-border bg-app-surface-raised shadow-2xl">
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
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-app-surface-hover ${
                      isActive ? "text-app-text" : "text-app-text-muted"
                    }`}
                  >
                    <div className="flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 font-mono text-[12px]">
                        <span className="font-medium">{p.value}</span>
                        {isActive && (
                          <Check size={11} className="text-app-purple" />
                        )}
                      </div>
                      <div className="text-[12px] leading-snug text-app-text-faint">
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
