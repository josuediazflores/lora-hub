const AIRLINE_COLORS: Record<string, string> = {
  BA: "#2a4877",
  AA: "#9c2332",
  VS: "#b53648",
  DL: "#2e5a8e",
  UA: "#3a6db0",
  LH: "#b89239",
  AF: "#1f3b6b",
  KL: "#3a94c4",
  EK: "#c94038",
  QR: "#6b2a3e",
  AC: "#b53648",
  JL: "#9c2332",
  NH: "#2e5a8e",
  SQ: "#2a4877",
  QF: "#9c2332",
  CX: "#2e5a8e",
  IB: "#9c2332",
  AZ: "#2a4877",
  TK: "#9c2332",
};

export function brandColorFor(code: string | undefined | null): string {
  if (!code) return "var(--color-app-accent)";
  const hex = AIRLINE_COLORS[code.toUpperCase()];
  return hex ?? "var(--color-app-accent)";
}
