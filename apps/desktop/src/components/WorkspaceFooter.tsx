import { FolderOpen } from "lucide-react";
import {
  PRESETS,
  workspaceShortName,
  type Preset,
  type Workspace,
} from "../lib/workspace";

type Props = {
  workspace: Workspace | null;
  preset: Preset;
  baseLabel: string;
  adapterName: string | null;
  onPickWorkspace: () => void;
};

/**
 * Slim contextual bar shown below the composer when Computer Use is on.
 * Reads like a shell prompt — everything mono, separated by middle dots.
 */
export function WorkspaceFooter({
  workspace,
  preset,
  baseLabel,
  adapterName,
  onPickWorkspace,
}: Props) {
  const presetLabel =
    PRESETS.find((p) => p.value === preset)?.value ?? preset;
  const wsLabel = workspace
    ? `ws/${workspaceShortName(workspace.root)}`
    : "pick workspace";
  const wsTitle = workspace?.root ?? "No workspace selected";

  return (
    <div className="mx-auto mt-1.5 flex max-w-3xl items-center gap-1 px-1 font-mono text-[11px] text-app-text-faint">
      <button
        type="button"
        onClick={onPickWorkspace}
        title={wsTitle}
        className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-app-surface-hover hover:text-app-text ${
          workspace ? "text-app-text-muted" : "text-app-purple"
        }`}
      >
        {!workspace && <FolderOpen size={10} strokeWidth={2.2} />}
        {wsLabel}
      </button>
      <Sep />
      <Chunk label="base" value={baseLabel} />
      <Sep />
      <Chunk label="adapter" value={adapterName ?? "none"} />
      <Sep />
      <Chunk label="perms" value={presetLabel} />
    </div>
  );
}

function Chunk({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5">
      <span className="text-app-text-faint">{label}/</span>
      <span className="text-app-text-muted">{value}</span>
    </span>
  );
}

function Sep() {
  return <span className="text-app-text-faint/60">·</span>;
}
