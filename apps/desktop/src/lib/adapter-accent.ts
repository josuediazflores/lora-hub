/**
 * Deterministic per-adapter accent color. The app accent stays orange; each
 * adapter additionally gets a stable hue derived from its slug, so "persian",
 * "document-writer", etc. become visually distinct characters in chat without
 * needing curator-assigned palettes.
 */

export type AdapterAccent = {
  /** Pill background — very dark tint of the hue, readable over app bg. */
  bg: string;
  /** Pill label text — a light, saturated variant of the hue. */
  text: string;
  /** Pill border — mid-tone, just enough to separate from surface. */
  border: string;
};

function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return ((h % 360) + 360) % 360;
}

export function adapterAccent(name: string): AdapterAccent {
  const hue = hueFor(name);
  // Re-tuned for the Paper & Ink palette: warmer bg, slightly desaturated
  // text so hues sit alongside saffron and plum without clashing.
  return {
    bg: `hsl(${hue} 24% 20%)`,
    text: `hsl(${hue} 55% 76%)`,
    border: `hsl(${hue} 28% 38%)`,
  };
}

/** Stable color for a use-case slug (sql, writing, code, tools, ...). Used
 * as the dot color in the Browse facet rail and as the accent on trending
 * strips so a single adapter stays visually anchored to its use-case. */
export function useCaseAccent(useCase: string): string {
  return adapterAccent(`usecase:${useCase}`).text;
}
