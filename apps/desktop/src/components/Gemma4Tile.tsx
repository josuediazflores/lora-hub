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
    <div className="mx-auto mt-6 flex max-w-2xl items-start gap-2.5 rounded-md border border-app-border bg-app-surface/60 px-3 py-2.5 text-[12px] text-app-text-muted">
      <Info
        size={12}
        className="mt-0.5 shrink-0 text-app-accent"
        strokeWidth={2}
      />
      <div className="flex-1">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-app-text">
          what&apos;s gemma 4?
        </div>
        <p className="mt-1.5 leading-[1.55]">
          Gemma 4 E4B is Google&apos;s April 2026 model — &quot;effective 4B&quot;
          parameters via per-layer caching (5.2 GB on disk). Multimodal upstream;
          LoRA Hub uses the text path only while the adapter ecosystem matures.
          Gemma 3 4B remains the faster, lighter default.
        </p>
      </div>
      <button
        onClick={dismiss}
        title="Dismiss"
        className="shrink-0 rounded-md p-1 text-app-text-faint hover:bg-app-surface-hover hover:text-app-text"
      >
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  );
}
