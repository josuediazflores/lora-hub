import { invoke } from "@tauri-apps/api/core";

/** Query the Rust side for the list of `org/repo` IDs (lowercased)
 * that have at least one HuggingFace snapshot on disk. Used by the
 * Models view to tag rows that won't trigger a fresh download. */
export async function listCachedHfModels(): Promise<Set<string>> {
  const list = await invoke<string[]>("list_cached_hf_models");
  return new Set(list.map((s) => s.toLowerCase()));
}
