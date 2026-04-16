import { ChevronDown, Mic, Plus } from "lucide-react";

type BaseOption = { base_id: string; name: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  baseLabel: string;
  baseId?: string | null;
  bases?: BaseOption[];
  onPickBase?: (baseId: string) => void;
  adapterLabel?: string | null;
  adapters: { name: string }[];
  onPickAdapter?: (name: string | null) => void;
  large?: boolean;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  baseLabel,
  baseId,
  bases = [],
  onPickBase,
  adapterLabel,
  adapters,
  onPickAdapter,
  large,
}: Props) {
  const showSelect = adapters.length > 0 && !!onPickAdapter;
  const showBaseSelect = bases.length > 1 && !!onPickBase;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={`mx-auto w-full ${large ? "max-w-2xl" : "max-w-3xl"}`}
    >
      <div className="rounded-2xl border border-app-border bg-app-surface px-4 pt-3 pb-2 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]">
        <textarea
          rows={large ? 2 : 1}
          className={`w-full resize-none bg-transparent text-app-text placeholder:text-app-text-faint focus:outline-none ${
            large ? "min-h-[44px] text-base" : "min-h-[28px] text-sm"
          }`}
          placeholder={placeholder ?? "How can I help you today?"}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />

        <div className="mt-1 flex items-center justify-between text-xs text-app-text-muted">
          <button
            type="button"
            className="rounded-md p-1.5 hover:bg-app-surface-hover hover:text-app-text"
          >
            <Plus size={16} />
          </button>

          <div className="flex items-center gap-2">
            {showSelect ? (
              <select
                className="cursor-pointer rounded-md bg-transparent px-2 py-1 text-xs text-app-text-muted hover:text-app-text focus:outline-none"
                value={adapterLabel ?? ""}
                onChange={(e) => onPickAdapter?.(e.target.value || null)}
              >
                <option value="">no adapter</option>
                {adapters.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-app-text-faint">
                {adapterLabel ?? "no adapter"}
              </span>
            )}
            {showBaseSelect ? (
              <div className="relative flex items-center">
                <select
                  className="cursor-pointer appearance-none rounded-md bg-transparent py-1 pl-2 pr-5 text-xs text-app-text-muted hover:text-app-text focus:outline-none"
                  value={baseId ?? ""}
                  onChange={(e) => onPickBase?.(e.target.value)}
                >
                  {bases.map((b) => (
                    <option key={b.base_id} value={b.base_id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="pointer-events-none absolute right-1.5"
                />
              </div>
            ) : (
              <span className="flex items-center gap-1 rounded-md px-2 py-1">
                {baseLabel}
                <ChevronDown size={12} />
              </span>
            )}
            <button
              type="button"
              className="rounded-md p-1.5 hover:bg-app-surface-hover hover:text-app-text"
            >
              <Mic size={14} />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
