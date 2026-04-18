import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

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

/**
 * Terminal-block styling. Status glyph + tool name + arg summary on the
 * header row; a 2px plum rail on the left when expanded; args and output
 * in mono code blocks.
 */
export function ToolCallBubble({ message }: Props) {
  const [expanded, setExpanded] = useState(message.status !== "success");
  const argsLine = compactArgs(message.args);

  return (
    <div
      className="rounded-md border border-app-border bg-app-surface/60 font-mono"
      style={{
        borderLeftColor: expanded
          ? "var(--color-app-purple)"
          : "var(--color-app-border)",
        borderLeftWidth: expanded ? 2 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]"
      >
        <StatusGlyph status={message.status} />
        <span className="font-medium text-app-text">{message.name}</span>
        {argsLine && (
          <span className="truncate text-app-text-faint">{argsLine}</span>
        )}
        <span className="ml-auto text-app-text-faint">
          {expanded ? (
            <ChevronDown size={11} strokeWidth={2} />
          ) : (
            <ChevronRight size={11} strokeWidth={2} />
          )}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-app-border/60 px-3 py-2 text-[11px]">
          <Section label="args">
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-app-text">
              {JSON.stringify(message.args, null, 2)}
            </pre>
          </Section>

          {message.status === "error" && message.error && (
            <Section label="error" tone="danger">
              <pre className="whitespace-pre-wrap break-words text-app-danger">
                {message.error}
              </pre>
            </Section>
          )}

          {message.status === "denied" && (
            <Section label="denied" tone="warn">
              <span className="text-app-warn">
                {message.error ?? "denied by permission preset"}
              </span>
            </Section>
          )}

          {message.output !== undefined && message.output.length > 0 && (
            <Section
              label={
                message.truncated
                  ? `output (truncated · ${message.output.length} chars)`
                  : `output · ${message.output.length} chars`
              }
            >
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-app-text">
                {message.output}
              </pre>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function StatusGlyph({ status }: { status: ToolStatus }) {
  const map: Record<ToolStatus, { ch: string; cls: string; aria: string }> = {
    pending: { ch: "▸", cls: "text-app-purple animate-pulse", aria: "running" },
    success: { ch: "✓", cls: "text-app-ok", aria: "success" },
    error: { ch: "✗", cls: "text-app-danger", aria: "error" },
    denied: { ch: "⊘", cls: "text-app-warn", aria: "denied" },
  };
  const m = map[status];
  return (
    <span
      className={`inline-block w-[10px] text-center text-[11px] leading-none ${m.cls}`}
      role="img"
      aria-label={m.aria}
    >
      {m.ch}
    </span>
  );
}

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "warn" | "danger";
  children: React.ReactNode;
}) {
  const labelClass =
    tone === "danger"
      ? "text-app-danger"
      : tone === "warn"
        ? "text-app-warn"
        : "text-app-text-faint";
  return (
    <div>
      <div
        className={`mb-1 text-[10px] uppercase tracking-[0.1em] ${labelClass}`}
      >
        {label}
      </div>
      <div className="rounded-sm bg-app-bg/70 px-2 py-1">{children}</div>
    </div>
  );
}

/** Inline compact arg summary like `path="src/App.tsx"` that fits on the
 * collapsed header row. Long values are truncated. */
function compactArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    parts.push(`${k}=${shortValue(v)}`);
  }
  const joined = parts.join(" ");
  return joined.length > 80 ? joined.slice(0, 77) + "…" : joined;
}

function shortValue(v: unknown): string {
  if (typeof v === "string") {
    return v.length > 30 ? JSON.stringify(v.slice(0, 27) + "…") : JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v && typeof v === "object") return "{…}";
  return String(v);
}
