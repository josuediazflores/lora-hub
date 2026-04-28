import { useEffect, useState } from "react";

const SKIP_VERSION_KEY = "lora-hub:updater:skip-version:v1";

type UpdaterApi = {
  check: () => Promise<{
    version: string;
    body?: string;
    downloadAndInstall: (cb?: (e: unknown) => void) => Promise<void>;
  } | null>;
};
type ProcessApi = { relaunch: () => Promise<void> };

type Phase =
  | { kind: "idle" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "installing"; version: string; pct: number | null }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

/**
 * Polls the Tauri updater on mount and surfaces a discreet banner across the
 * top of the main pane when an update is found. The user can install (which
 * triggers a relaunch on success) or dismiss for the current version. The
 * skip choice is stored per-version, so the banner returns when a newer
 * release lands.
 */
export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const updaterMod = (await import("@tauri-apps/plugin-updater")) as unknown as UpdaterApi;
        const update = await updaterMod.check();
        if (cancelled || !update) return;
        const skipped = (() => {
          try {
            return localStorage.getItem(SKIP_VERSION_KEY);
          } catch {
            return null;
          }
        })();
        if (skipped === update.version) return;
        setPhase({
          kind: "available",
          version: update.version,
          notes: update.body ?? "",
        });
      } catch (e) {
        // Plugin missing in dev or no network — quietly stay idle.
        // Surfacing a "no updater" toast on every launch would be noise.
        console.debug("updater check skipped:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function install() {
    if (phase.kind !== "available") return;
    setPhase({ kind: "installing", version: phase.version, pct: null });
    try {
      const updaterMod = (await import("@tauri-apps/plugin-updater")) as unknown as UpdaterApi;
      const update = await updaterMod.check();
      if (!update) {
        setPhase({ kind: "idle" });
        return;
      }
      let totalBytes = 0;
      let seenBytes = 0;
      await update.downloadAndInstall((event) => {
        const ev = event as { event?: string; data?: { contentLength?: number; chunkLength?: number } };
        if (ev?.event === "Started") {
          totalBytes = ev?.data?.contentLength ?? 0;
        } else if (ev?.event === "Progress") {
          seenBytes += ev?.data?.chunkLength ?? 0;
          const pct = totalBytes > 0 ? Math.round((seenBytes / totalBytes) * 100) : null;
          setPhase((p) =>
            p.kind === "installing" ? { ...p, pct } : p,
          );
        }
      });
      setPhase({ kind: "ready", version: update.version });
    } catch (e) {
      setPhase({ kind: "error", message: String(e) });
    }
  }

  async function relaunch() {
    try {
      const proc = (await import("@tauri-apps/plugin-process")) as unknown as ProcessApi;
      await proc.relaunch();
    } catch (e) {
      setPhase({ kind: "error", message: `relaunch failed: ${e}` });
    }
  }

  function skip() {
    if (phase.kind !== "available" && phase.kind !== "ready") return;
    try {
      localStorage.setItem(SKIP_VERSION_KEY, phase.version);
    } catch {
      // ignore
    }
    setPhase({ kind: "idle" });
  }

  if (phase.kind === "idle") return null;

  return (
    <div className="border-b border-app-border bg-app-surface px-4 py-2 text-[12px] text-app-text">
      <div className="mx-auto flex max-w-[920px] items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full bg-app-accent"
          />
          <span>{message(phase)}</span>
        </div>
        <div className="flex items-center gap-2">
          {phase.kind === "available" && (
            <>
              <button
                onClick={skip}
                className="text-app-text-muted hover:text-app-text"
              >
                Skip this version
              </button>
              <button
                onClick={install}
                className="rounded-md bg-app-accent px-3 py-1 text-app-bg hover:opacity-90"
              >
                Install
              </button>
            </>
          )}
          {phase.kind === "ready" && (
            <button
              onClick={relaunch}
              className="rounded-md bg-app-accent px-3 py-1 text-app-bg hover:opacity-90"
            >
              Restart now
            </button>
          )}
          {phase.kind === "error" && (
            <button
              onClick={() => setPhase({ kind: "idle" })}
              className="text-app-text-muted hover:text-app-text"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function message(phase: Phase): string {
  switch (phase.kind) {
    case "available":
      return `Update available — version ${phase.version}`;
    case "installing":
      return phase.pct !== null
        ? `Installing v${phase.version}… ${phase.pct}%`
        : `Installing v${phase.version}…`;
    case "ready":
      return `v${phase.version} is ready — restart to apply`;
    case "error":
      return `Update failed: ${phase.message}`;
    default:
      return "";
  }
}
