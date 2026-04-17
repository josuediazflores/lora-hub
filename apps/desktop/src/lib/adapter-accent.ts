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
  return {
    bg: `hsl(${hue} 30% 18%)`,
    text: `hsl(${hue} 65% 72%)`,
    border: `hsl(${hue} 35% 35%)`,
  };
}
