import { invoke } from "@tauri-apps/api/core";

export async function systemMemoryBytes(): Promise<number> {
  const n = (await invoke("system_memory_bytes")) as number;
  return Number(n) || 0;
}

export type MemoryFit = "fits" | "tight" | "oom" | "unknown";

/**
 * Peak RSS at inference is ~1.3× the quantized weight file for the MLX backend
 * (measured on Gemma 3 4B Q4: 2.5 GB file → 3.2 GB peak RSS). We want 1.5× that
 * peak as comfortable headroom before declaring "fits".
 */
export function memoryFit(sizeBytes: number, totalMem: number): MemoryFit {
  if (!totalMem) return "unknown";
  const peak = sizeBytes * 1.3;
  if (totalMem >= peak * 1.5) return "fits";
  if (totalMem >= peak) return "tight";
  return "oom";
}
