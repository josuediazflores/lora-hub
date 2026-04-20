import type { StoreBase } from "./store";

/** Two-sentence blurb shown under each model card. Composed from the
 * structured family + quant fields so the 28 base entries stay lean and
 * copy tweaks land in one place.
 *
 * Intentionally only used as a fallback — when a storefront-seeded entry
 * supplies its own description, that wins. See ModelsView.tsx. */
export function describeBase(base: StoreBase): string {
  const fam = familyBlurb(base.parameters);
  const q = quantBlurb(base.quant, base.parameters);
  return q ? `${fam} ${q}` : fam;
}

function familyBlurb(parameters: string): string {
  switch (parameters) {
    case "E2B":
      return "Gemma 4's smallest — ~2B effective params with MatFormer elastic inference; fastest, lightest on RAM.";
    case "E4B":
      return "Gemma 4 mid-tier — ~4B effective params with MatFormer elastic inference; balanced speed and quality.";
    case "26B-A4B":
      return "Mixture-of-Experts — 26B total parameters, only ~4B active per token; near-frontier quality with a smaller active footprint.";
    case "31B":
      return "Dense 31B — Gemma 4's top-quality tier; heaviest to run but no routing overhead.";
    default:
      return `Gemma 4 ${parameters}.`;
  }
}

function quantBlurb(quant: string, parameters: string): string {
  // E2B has no smaller sibling, so the "beats a smaller bf16 model" framing
  // doesn't apply — keep the 4-bit blurb neutral there.
  const hasSmallerSibling = parameters !== "E2B";
  switch (quant) {
    case "4bit":
      return hasSmallerSibling
        ? "4-bit keeps this size tiny — at similar RAM, this often beats the next-smaller model at bf16 on reasoning and recall."
        : "4-bit: smallest footprint with modest quality loss vs. bf16.";
    case "5bit":
      return "5-bit: a small step up from 4-bit for marginal accuracy gain.";
    case "6bit":
      return "6-bit: close to 8-bit quality at a smaller size; good middle ground.";
    case "8bit":
      return "8-bit: near-bf16 quality at roughly half the bf16 size. Safe default when you want precision without full-precision cost.";
    case "mxfp4":
      return "mxfp4: Apple Silicon-native FP4 — similar memory to int-4 with better GPU throughput on M-series.";
    case "mxfp8":
      return "mxfp8: Apple Silicon-native FP8 — near-lossless quality and typically the fastest path on M-series.";
    case "bf16":
      return "Full precision — reference output quality, no quantization artifacts. Use when you care most about fidelity.";
    default:
      return "";
  }
}
