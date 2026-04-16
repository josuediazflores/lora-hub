import { X } from "lucide-react";

export type Settings = {
  temperature: number;
  topP: number;
  maxTokens: number;
};

export const DEFAULT_SETTINGS: Settings = {
  temperature: 0.7,
  topP: 0.95,
  maxTokens: 512,
};

const SETTINGS_KEY = "lora-hub:settings:v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

type Props = {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
};

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-app-border bg-app-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-app-border px-5 py-3">
          <h2 className="text-sm font-semibold">Generation settings</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex flex-col gap-5 px-5 py-5">
          <SliderRow
            label="Temperature"
            help="Higher = more random. 0.7 is a good chat default."
            min={0}
            max={1.5}
            step={0.05}
            value={settings.temperature}
            onChange={(v) => onChange({ ...settings, temperature: v })}
          />
          <SliderRow
            label="Top-p"
            help="Nucleus sampling cutoff. 0.95 keeps most plausible tokens in play."
            min={0.1}
            max={1.0}
            step={0.01}
            value={settings.topP}
            onChange={(v) => onChange({ ...settings, topP: v })}
          />
          <NumberRow
            label="Max tokens"
            help="Hard cap on response length. Stops early on EOS."
            min={32}
            max={4096}
            step={32}
            value={settings.maxTokens}
            onChange={(v) => onChange({ ...settings, maxTokens: v })}
          />
        </div>

        <footer className="flex items-center justify-between border-t border-app-border px-5 py-3 text-xs">
          <button
            onClick={() => onChange(DEFAULT_SETTINGS)}
            className="text-app-text-muted hover:text-app-text"
          >
            Reset to defaults
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-app-text px-3 py-1.5 text-app-bg hover:bg-app-text/90"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  help,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-app-text">{label}</span>
        <span className="font-mono text-app-text-muted">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-app-accent"
      />
      <div className="mt-1 text-[11px] text-app-text-faint">{help}</div>
    </div>
  );
}

function NumberRow({
  label,
  help,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-app-text">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 rounded-md border border-app-border bg-app-surface px-2 py-1 text-right font-mono text-xs text-app-text focus:border-app-border-strong focus:outline-none"
        />
      </div>
      <div className="mt-1 text-[11px] text-app-text-faint">{help}</div>
    </div>
  );
}
