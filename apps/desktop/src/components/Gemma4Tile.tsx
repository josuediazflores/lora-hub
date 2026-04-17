import { useState } from "react";
import { Info, X } from "lucide-react";

const DISMISS_KEY = "lora-hub:welcome:gemma4-dismissed:v1";

function initialDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function Gemma4Tile() {
  const [dismissed, setDismissed] = useState<boolean>(initialDismissed);
  if (dismissed) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  }

  return (
    <div className="mx-auto mt-6 flex max-w-2xl items-start gap-3 rounded-xl border border-app-border bg-app-surface px-4 py-3 text-xs text-app-text-muted">
      <Info size={14} className="mt-0.5 shrink-0 text-app-accent" />
      <div className="flex-1">
        <div className="text-sm font-medium text-app-text">What's Gemma 4?</div>
        <p className="mt-1 leading-relaxed">
          Gemma 4 E4B is Google's April 2026 model — "effective 4B" parameters
          via per-layer caching (5.2 GB on disk). Multimodal upstream; LoRA Hub
          uses the text path only while the adapter ecosystem matures.
          Gemma 3 4B remains the faster, lighter default.
        </p>
      </div>
      <button
        onClick={dismiss}
        title="Dismiss"
        className="shrink-0 rounded-md p-1 text-app-text-faint hover:bg-app-surface-hover hover:text-app-text"
      >
        <X size={12} />
      </button>
    </div>
  );
}
