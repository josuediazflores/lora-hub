import { Columns2 } from "lucide-react";
import { CommandPicker, type CommandPickerItem } from "./CommandPicker";
import { ModeChip } from "./ModeChip";
import { PermissionsPicker } from "./PermissionsPicker";
import { adapterAccent } from "../lib/adapter-accent";
import type { Preset } from "../lib/workspace";

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
  compareMode?: boolean;
  onToggleCompare?: () => void;
  compareAvailable?: boolean;
  computerUseMode?: boolean;
  onToggleComputerUse?: () => void;
  permissionPreset?: Preset;
  onPickPreset?: (p: Preset) => void;
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
  compareMode,
  onToggleCompare,
  compareAvailable,
  computerUseMode,
  onToggleComputerUse,
  permissionPreset,
  onPickPreset,
}: Props) {
  const showAdapterPicker = adapters.length > 0 && !!onPickAdapter;
  const showBasePicker = bases.length > 1 && !!onPickBase;
  const showCompareToggle = !!onToggleCompare;
  const showModeChip = !!onToggleComputerUse;
  const showPermsPicker = !!computerUseMode && !!onPickPreset && !!permissionPreset;

  const adapterItems: CommandPickerItem[] = adapters.map((a) => ({
    id: a.name,
    label: a.name,
    accent: adapterAccent(a.name),
  }));
  const baseItems: CommandPickerItem[] = bases.map((b) => ({
    id: b.base_id,
    label: b.name,
  }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={`mx-auto w-full ${large ? "max-w-2xl" : "max-w-3xl"}`}
    >
      <div
        className={`rounded-2xl border bg-app-surface px-4 pt-3 pb-2 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] ${
          computerUseMode
            ? "border-app-purple/50"
            : "border-app-border"
        }`}
      >
        <div className="flex items-start gap-2">
          {showModeChip && (
            <div className={large ? "pt-1.5" : "pt-0.5"}>
              <ModeChip
                active={!!computerUseMode}
                onToggle={onToggleComputerUse!}
              />
            </div>
          )}
          <textarea
            rows={large ? 2 : 1}
            className={`flex-1 min-w-0 resize-none bg-transparent text-app-text placeholder:text-app-text-faint focus:outline-none ${
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
        </div>

        <div className="mt-1 flex items-center justify-end text-xs text-app-text-muted">
          <div className="flex items-center gap-2">
            {showPermsPicker && (
              <PermissionsPicker
                value={permissionPreset!}
                onChange={onPickPreset!}
              />
            )}
            {showCompareToggle && (
              <button
                type="button"
                onClick={onToggleCompare}
                disabled={!compareAvailable}
                title={
                  compareAvailable
                    ? compareMode
                      ? "Compare mode on — each send runs base and adapter side-by-side"
                      : "Turn on compare mode"
                    : "Select an adapter to enable compare mode"
                }
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                  compareMode
                    ? "bg-app-accent/15 text-app-accent"
                    : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-app-text-muted"
                }`}
              >
                <Columns2 size={12} />
                Compare
              </button>
            )}
            {showAdapterPicker ? (
              <CommandPicker
                triggerLabel={adapterLabel ?? "no adapter"}
                items={adapterItems}
                activeId={adapterLabel ?? null}
                onSelect={(id) => onPickAdapter?.(id)}
                allowNone
                noneLabel="No adapter"
                placeholder="Search adapters…"
                emptyLabel="No adapters installed"
              />
            ) : (
              <span className="text-xs text-app-text-faint">
                {adapterLabel ?? "no adapter"}
              </span>
            )}
            {showBasePicker ? (
              <CommandPicker
                triggerLabel={baseLabel}
                items={baseItems}
                activeId={baseId ?? null}
                onSelect={(id) => id && onPickBase?.(id)}
                placeholder="Search bases…"
              />
            ) : (
              <span className="flex items-center gap-1 rounded-md px-2 py-1">
                {baseLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
