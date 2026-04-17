import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  FilePlus,
  Folder,
  Globe,
  Search,
  Terminal,
  X,
  Check,
  ShieldAlert,
} from "lucide-react";

export type ToolStatus = "pending" | "success" | "error" | "denied";

export type ToolCallMessage = {
  id: string;
  role: "tool_call";
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  output?: string;
  error?: string;
  truncated?: boolean;
};

type Props = {
  message: ToolCallMessage;
};

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  read_file: FileText,
  write_file: FilePlus,
  list_dir: Folder,
  glob: Search,
  grep: Search,
  run_command: Terminal,
  http_fetch: Globe,
};

export function ToolCallBubble({ message }: Props) {
  const [expanded, setExpanded] = useState(message.status !== "success");

  const Icon = ICONS[message.name] ?? Terminal;
  const argsJson = formatArgs(message.args);

  return (
    <div className="rounded-xl border border-app-purple/30 bg-app-purple/[0.04]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <StatusDot status={message.status} />
        <Icon size={12} className="text-app-purple" />
        <span className="font-mono text-app-text">{message.name}</span>
        <span className="truncate font-mono text-app-text-faint">
          {argsJson.summary}
        </span>
        <span className="ml-auto text-app-text-faint">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-app-purple/20 px-3 py-2 text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-app-text-faint">
            args
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-app-bg/60 px-2 py-1 font-mono text-[11px] text-app-text">
            {argsJson.pretty}
          </pre>

          {message.status === "error" && message.error && (
            <>
              <div className="mt-3 mb-1 text-[10px] uppercase tracking-wide text-red-300">
                error
              </div>
              <pre className="whitespace-pre-wrap rounded-md bg-red-500/5 px-2 py-1 font-mono text-[11px] text-red-300">
                {message.error}
              </pre>
            </>
          )}

          {message.status === "denied" && (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-app-surface px-2 py-1 text-[11px] text-app-text-muted">
              <ShieldAlert size={11} className="text-app-accent" />
              Denied by permission preset.
            </div>
          )}

          {message.output !== undefined && message.output.length > 0 && (
            <>
              <div className="mt-3 mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-app-text-faint">
                <span>output{message.truncated ? " (truncated)" : ""}</span>
                <span>{message.output.length.toLocaleString()} chars</span>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-app-bg/60 px-2 py-1 font-mono text-[11px] text-app-text">
                {message.output}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: ToolStatus }) {
  if (status === "pending") {
    return (
      <Circle
        size={10}
        className="animate-pulse fill-app-purple text-app-purple"
      />
    );
  }
  if (status === "success") return <Check size={11} className="text-emerald-400" />;
  if (status === "error") return <X size={11} className="text-red-400" />;
  return <ShieldAlert size={11} className="text-app-accent" />;
}

function formatArgs(args: Record<string, unknown>): { summary: string; pretty: string } {
  const entries = Object.entries(args);
  const summary = entries.length
    ? entries
        .map(([k, v]) => `${k}=${summarizeValue(v)}`)
        .join(" ")
    : "";
  const pretty = JSON.stringify(args, null, 2);
  return { summary, pretty };
}

function summarizeValue(v: unknown): string {
  if (typeof v === "string") {
    return v.length > 40 ? JSON.stringify(v.slice(0, 37) + "…") : JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v && typeof v === "object") return "{…}";
  return String(v);
}
