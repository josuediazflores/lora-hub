import { invoke } from "@tauri-apps/api/core";

export type Workspace = {
  root: string;
};

export type Preset = "read_only" | "standard" | "trusted";

export const PRESETS: { value: Preset; label: string; description: string }[] = [
  {
    value: "read_only",
    label: "Read-only",
    description: "Read files and GET fetches. Nothing writes.",
  },
  {
    value: "standard",
    label: "Standard",
    description: "Adds writes in the workspace and a safe shell allowlist.",
  },
  {
    value: "trusted",
    label: "Trusted",
    description: "Arbitrary shell. Workspace still confines writes.",
  },
];

export async function setWorkspace(root: string | null): Promise<Workspace | null> {
  return (await invoke("set_workspace", { root })) as Workspace | null;
}

export async function getWorkspace(): Promise<Workspace | null> {
  return (await invoke("get_workspace")) as Workspace | null;
}

export async function setPreset(preset: Preset): Promise<Preset> {
  return (await invoke("set_preset", { preset })) as Preset;
}

export async function getPreset(): Promise<Preset> {
  return (await invoke("get_preset")) as Preset;
}

/**
 * Heuristic: does this path look safe to use as a workspace? Returns a warning
 * string when the path is home / root / contains sensitive subdirs; null when
 * it looks fine. The backend also enforces confinement — this is only for
 * UX messaging on selection.
 */
export function workspaceWarning(path: string): string | null {
  const normalized = path.replace(/\/+$/, "");
  if (!normalized || normalized === "/" || normalized === "/Users") {
    return "Pick a narrower folder — full filesystem root as workspace is unsafe.";
  }
  const home = (typeof navigator !== "undefined" && /Mac/.test(navigator.platform))
    ? undefined
    : undefined;
  if (home && normalized === home) {
    return "Your home directory is broad. A project subfolder is safer.";
  }
  if (/\/\.ssh(\/|$)|\/\.aws(\/|$)|\/\.config\/gcloud(\/|$)/.test(normalized)) {
    return "This path contains credentials — pick a project folder instead.";
  }
  return null;
}

/** Short label for footer display — last path component, no leading slash. */
export function workspaceShortName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const last = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
  return last || trimmed;
}
