import { Folder, FolderOpen } from "lucide-react";
import { PRESETS, workspaceShortName, type Preset, type Workspace } from "../lib/workspace";

type Props = {
  workspace: Workspace | null;
  preset: Preset;
  baseLabel: string;
  adapterName: string | null;
  onPickWorkspace: () => void;
};

/**
 * Slim contextual bar shown below the composer whenever Computer Use is on.
 * Matches the Codex-mockup footer (project / environment chips). Clicking
 * the workspace chip opens the directory picker.
 */
export function WorkspaceFooter({
  workspace,
  preset,
  baseLabel,
  adapterName,
  onPickWorkspace,
}: Props) {
  const presetLabel = PRESETS.find((p) => p.value === preset)?.label ?? preset;
  const wsLabel = workspace ? workspaceShortName(workspace.root) : "Pick workspace";
  const wsTitle = workspace?.root ?? "No workspace selected";

  return (
    <div className="mx-auto mt-2 flex max-w-3xl items-center gap-3 px-1 text-[11px] text-app-text-faint">
      <button
        type="button"
        onClick={onPickWorkspace}
        title={wsTitle}
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-app-surface-hover hover:text-app-text ${
          workspace ? "text-app-text-muted" : "text-app-purple"
        }`}
      >
        {workspace ? <Folder size={11} /> : <FolderOpen size={11} />}
        {wsLabel}
      </button>
      <Separator />
      <span className="inline-flex items-center gap-1.5 px-2 py-1">
        base · {baseLabel}
      </span>
      <Separator />
      <span className="inline-flex items-center gap-1.5 px-2 py-1">
        adapter · {adapterName ?? "none"}
      </span>
      <Separator />
      <span className="inline-flex items-center gap-1.5 px-2 py-1">
        perms · {presetLabel}
      </span>
    </div>
  );
}

function Separator() {
  return <span className="text-app-text-faint/60">·</span>;
}
