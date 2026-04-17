import { Sliders } from "lucide-react";
import { adapterAccent } from "../lib/adapter-accent";

type Props = {
  name: string | null;
};

export function ActiveAdapterStrip({ name }: Props) {
  if (!name) return null;
  const accent = adapterAccent(name);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b px-6 py-2 text-xs"
      style={{
        backgroundColor: accent.bg,
        borderColor: accent.border,
      }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: accent.text }}
      />
      <Sliders size={12} style={{ color: accent.text }} />
      <span className="font-medium" style={{ color: accent.text }}>
        {name}
      </span>
      <span className="text-app-text-faint">· active</span>
    </div>
  );
}
