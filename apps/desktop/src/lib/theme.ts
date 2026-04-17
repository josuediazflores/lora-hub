import type { Theme } from "../components/SettingsPanel";

/**
 * Resolves the user's theme preference to the concrete appearance that should
 * apply right now. "system" falls back to the OS preferred-color-scheme.
 */
export function resolveTheme(pref: Theme): "dark" | "light" {
  if (pref === "system") {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches
    ) {
      return "light";
    }
    return "dark";
  }
  return pref;
}

/** Writes `data-theme` on <html> so the CSS token overrides cascade app-wide. */
export function applyTheme(pref: Theme): void {
  const effective = resolveTheme(pref);
  document.documentElement.dataset.theme = effective;
}

/**
 * Subscribe to OS theme changes. Returns an unsubscribe. Only fires while
 * the user's preference is "system"; the caller re-invokes applyTheme.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => onChange();
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
