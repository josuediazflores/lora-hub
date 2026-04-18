import { adapterAccent } from "../lib/adapter-accent";

type Props = {
  name: string | null;
};

/**
 * Reads like a terminal status-line across the top of the chat pane.
 * Mono throughout, tight padding, square status glyph in the adapter's hue.
 */
export function ActiveAdapterStrip({ name }: Props) {
  if (!name) return null;
  const accent = adapterAccent(name);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b px-6 py-1.5 font-mono text-[11px] tracking-tight"
      style={{
        backgroundColor: accent.bg,
        borderColor: accent.border,
        color: accent.text,
      }}
    >
      <span
        aria-hidden
        className="inline-block h-[7px] w-[7px] rounded-[1px]"
        style={{ backgroundColor: accent.text }}
      />
      <span className="font-medium">{name}</span>
      <span className="text-app-text-faint">· active</span>
    </div>
  );
}
