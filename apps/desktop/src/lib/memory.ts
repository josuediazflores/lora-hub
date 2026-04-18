import { invoke } from "@tauri-apps/api/core";

export type Memory = {
  id: string;
  name: string;
  content: string;
  kind?: string | null;
  created_at: number;
  updated_at: number;
  source?: string | null;
};

export type MemoryInput = {
  id?: string | null;
  name: string;
  content: string;
  kind?: string | null;
  source?: string | null;
};

/** Hard caps — mirrors constants in src-tauri/src/memory.rs. */
export const MEMORY_LIMITS = {
  maxMemories: 50,
  maxContentBytes: 2_000,
  maxNameChars: 80,
  maxTotalBytes: 32_768,
};

export async function listMemories(): Promise<Memory[]> {
  return await invoke<Memory[]>("memories_list");
}

export async function saveMemory(memory: MemoryInput): Promise<Memory> {
  return await invoke<Memory>("memory_save", { memory });
}

export async function deleteMemory(id: string): Promise<void> {
  await invoke("memory_delete", { id });
}

/** Total bytes used across all stored memories — for the UI budget gauge. */
export function totalBytes(memories: Memory[]): number {
  return memories.reduce((a, m) => a + m.name.length + m.content.length, 0);
}
