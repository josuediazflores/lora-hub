import React from "react";
import { BookOpen, RefreshCw, Square } from "lucide-react";
import { Markdown } from "./Markdown";
import { AttachmentCard } from "./AttachmentCard";
import { Composer } from "./Composer";
import { StoreBase } from "../lib/store";
import { TurnRow, SwapMarker, GutterBtn } from "./TurnRow";
import { ThoughtDisclosure } from "./ThoughtDisclosure";
import { parseThinking } from "../lib/thinking";
import { adapterAccent } from "../lib/adapter-accent";
import { ToolCallBubble } from "./ToolCallBubble";
import { SpecialistStepBubble } from "./SpecialistStepBubble";
import { SpecialistPlanBubble } from "./SpecialistPlanBubble";
import { ABComparePane, type ABPick } from "./ABComparePane";
import { WorkspaceFooter } from "./WorkspaceFooter";
import type { Preset, Workspace } from "../lib/workspace";
import type { Attachment } from "../lib/attachments";
import type { ChatMode } from "./ModeChip";
import type {
  AnyMessage,
  ComparisonMessage,
  Message,
  MemoryChipMessage,
  ToolCallMessage,
} from "../lib/message-types";

export function ChatView({
  messages,
  input,
  onInputChange,
  onSubmit,
  busy,
  scrollRef,
  baseLabel,
  baseLoaded,
  baseSha,
  showThinkingInline,
  adapters,
  adapter,
  onPickAdapter,
  bases,
  baseId,
  onPickBase,
  onRegenerate,
  onStop,
  canStop,
  compareMode,
  onToggleCompare,
  compareAvailable,
  mode,
  onSetMode,
  permissionPreset,
  onPickPreset,
  workspace,
  onPickWorkspace,
  tokenUsage,
  attachments,
  onRemoveAttachment,
  onPickFiles,
  onPickAB,
}: {
  messages: AnyMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  baseLabel: string;
  baseLoaded: boolean;
  baseSha: string | null;
  showThinkingInline: boolean;
  adapters: { name: string }[];
  adapter: string | null;
  onPickAdapter: (n: string | null) => void;
  bases: StoreBase[];
  baseId: string | null;
  onPickBase: (baseId: string) => void;
  onRegenerate: (assistantId: string) => void;
  onStop: () => void;
  canStop: boolean;
  compareMode: boolean;
  onToggleCompare: () => void;
  compareAvailable: boolean;
  mode: ChatMode;
  onSetMode: (m: ChatMode) => void;
  permissionPreset: Preset;
  onPickPreset: (p: Preset) => void;
  workspace: Workspace | null;
  onPickWorkspace: () => void;
  tokenUsage: { used: number; limit: number };
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onPickFiles: () => void;
  onPickAB: (id: string, choice: ABPick) => void;
}) {
  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && !m.pending) return m.id;
    }
    return null;
  })();
  const pendingAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.pending) return m.id;
      if (m.role === "comparison" && m.pending) return m.id;
    }
    return null;
  })();
  const rendered: React.ReactNode[] = [];
  let lastAssistantAdapter: string | null | undefined = undefined;
  for (const m of messages) {
    if (m.role === "assistant") {
      if (
        lastAssistantAdapter !== undefined &&
        (m.adapter ?? null) !== (lastAssistantAdapter ?? null) &&
        m.adapter
      ) {
        rendered.push(<SwapMarker key={`swap-${m.id}`} adapterName={m.adapter} />);
      }
      lastAssistantAdapter = m.adapter ?? null;
    }
    if (m.role === "comparison") {
      rendered.push(
        <CompareTurn
          key={m.id}
          message={m}
          canStop={m.id === pendingAssistantId && canStop}
          onStop={onStop}
        />,
      );
      continue;
    }
    if (m.role === "tool_call") {
      rendered.push(<ToolTurn key={m.id} message={m} />);
      continue;
    }
    if (m.role === "memory_chip") {
      rendered.push(<MemoryChip key={m.id} message={m} />);
      continue;
    }
    if (m.role === "specialist_plan") {
      rendered.push(<SpecialistPlanBubble key={m.id} message={m} />);
      continue;
    }
    if (m.role === "specialist_step") {
      rendered.push(<SpecialistStepBubble key={m.id} message={m} />);
      continue;
    }
    if (m.role === "ab_comparison") {
      rendered.push(
        <TurnRow
          key={m.id}
          kind="comparison"
          title={`a/b · ${m.delta.name}`}
          metaLines={[m.delta.description]}
        >
          <ABComparePane message={m} onPick={onPickAB} />
        </TurnRow>,
      );
      continue;
    }
    rendered.push(
      <MessageTurn
        key={m.id}
        message={m}
        canRegenerate={m.id === lastAssistantId && !busy}
        onRegenerate={() => onRegenerate(m.id)}
        canStop={m.id === pendingAssistantId && canStop}
        onStop={onStop}
        baseLabel={baseLabel}
        showThinkingInline={showThinkingInline}
      />,
    );
  }

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto flex max-w-[1020px] flex-col gap-0">{rendered}</div>
      </div>
      <div className="border-t border-app-border bg-app-bg px-6 py-4">
        <Composer
          value={input}
          onChange={onInputChange}
          onSubmit={onSubmit}
          disabled={busy || !baseLoaded}
          placeholder={
            mode === "cu"
              ? "Describe a task — I'll use tools to do it"
              : mode === "specialist"
                ? "Describe the goal — the planner will delegate across adapters"
                : compareMode
                  ? "Compare prompt — base vs adapter"
                  : baseLoaded
                    ? "Reply…"
                    : "Load the base model first"
          }
          baseLabel={baseLabel}
          baseId={baseId}
          bases={bases}
          onPickBase={onPickBase}
          adapters={adapters}
          adapterLabel={adapter}
          onPickAdapter={onPickAdapter}
          compareMode={compareMode}
          onToggleCompare={onToggleCompare}
          compareAvailable={compareAvailable}
          mode={mode}
          onSetMode={onSetMode}
          permissionPreset={permissionPreset}
          onPickPreset={onPickPreset}
          baseSha={baseSha}
          workspacePath={workspace?.root ?? null}
          tokenUsage={tokenUsage}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          onPickFiles={onPickFiles}
        />
        {mode === "cu" && (
          <WorkspaceFooter
            workspace={workspace}
            preset={permissionPreset}
            baseLabel={baseLabel}
            adapterName={adapter}
            onPickWorkspace={onPickWorkspace}
          />
        )}
      </div>
    </>
  );
}

type MessageTurnProps = {
  message: Message;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  canStop?: boolean;
  onStop?: () => void;
  baseLabel: string;
  showThinkingInline: boolean;
};

function MessageTurnImpl({
  message,
  canRegenerate,
  onRegenerate,
  canStop,
  onStop,
  baseLabel,
  showThinkingInline,
}: MessageTurnProps) {
  if (message.role === "system") {
    return (
      <TurnRow kind="system" title="system">
        <div className="flex max-w-md flex-col gap-1.5 rounded-md border border-app-border bg-app-surface/60 px-3 py-1.5 font-mono text-[11px] text-app-text-muted">
          <div>{message.text}</div>
          {message.progress && (
            <div className="h-[3px] w-full overflow-hidden rounded-sm bg-app-border">
              <div
                className="h-full bg-app-accent transition-[width] duration-200"
                style={{ width: `${Math.min(100, message.progress.percent)}%` }}
              />
            </div>
          )}
        </div>
      </TurnRow>
    );
  }
  if (message.role === "user") {
    const hasAttachments = !!message.attachments?.length;
    const hasText = !!message.text;
    return (
      <TurnRow kind="user" title="you">
        {hasAttachments && (
          <div className="mb-2 flex max-w-[760px] flex-wrap gap-2">
            {message.attachments!.map((a) => (
              <AttachmentCard key={a.id} attachment={a} />
            ))}
          </div>
        )}
        {(hasText || !hasAttachments) && (
          <div className="max-w-[760px] rounded-[10px] border border-app-border bg-app-surface px-3.5 py-2.5 text-[14px] leading-[1.55] whitespace-pre-wrap text-app-text">
            {message.text || (message.pending ? "…" : "")}
          </div>
        )}
      </TurnRow>
    );
  }
  const actions = (
    <>
      {canStop && onStop && (
        <GutterBtn title="Stop generating" onClick={onStop}>
          <Square size={9} className="fill-current" strokeWidth={0} />
        </GutterBtn>
      )}
      {canRegenerate && onRegenerate && (
        <GutterBtn title="Regenerate" onClick={onRegenerate}>
          <RefreshCw size={10} strokeWidth={2} />
        </GutterBtn>
      )}
    </>
  );
  const parsed = showThinkingInline
    ? null
    : parseThinking(message.text, !message.pending);
  return (
    <TurnRow
      kind="assistant"
      adapter={message.adapter ?? null}
      title={message.adapter ?? "assistant"}
      metaLines={[message.pending ? "streaming…" : undefined, baseLabel]}
      actions={message.pending || canRegenerate ? actions : null}
      pending={!!message.pending}
    >
      {parsed?.thought && (
        <ThoughtDisclosure thought={parsed.thought} phase={parsed.phase} />
      )}
      <div className="max-w-[760px] text-[14px] leading-[1.6] text-app-text">
        {(() => {
          const body = parsed ? parsed.answer : message.text;
          if (body) return <Markdown>{body}</Markdown>;
          if (message.pending) return <span className="text-app-text-faint">…</span>;
          return "";
        })()}
      </div>
    </TurnRow>
  );
}

// Memoized so streaming a reply only re-renders the row whose `message` object
// actually changed (patchActiveChat preserves the identity of untouched
// messages). The comparator ignores the inline `onRegenerate`/`onStop`
// callbacks — they're recreated every render but their behavior is stable —
// and compares the props that affect output. Without this, every token
// re-runs the full markdown/highlight/katex pipeline for every message.
const MessageTurn = React.memo(
  MessageTurnImpl,
  (prev: MessageTurnProps, next: MessageTurnProps) =>
    prev.message === next.message &&
    prev.canRegenerate === next.canRegenerate &&
    prev.canStop === next.canStop &&
    prev.baseLabel === next.baseLabel &&
    prev.showThinkingInline === next.showThinkingInline,
);

function ToolTurn({ message }: { message: ToolCallMessage }) {
  return (
    <TurnRow kind="tool" title="tool" metaLines={[message.status]}>
      <div className="max-w-[760px]">
        <ToolCallBubble message={message} />
      </div>
    </TurnRow>
  );
}

function MemoryChip({ message }: { message: MemoryChipMessage }) {
  const labelTone =
    message.status === "saved"
      ? "text-app-text-muted"
      : message.status === "denied"
        ? "text-app-text-faint"
        : "text-red-400";
  const lineTone =
    message.status === "error" ? "bg-red-500/40" : "bg-app-border";
  const verb =
    message.status === "saved"
      ? "added to memory"
      : message.status === "denied"
        ? "memory not saved"
        : "memory error";
  return (
    <div className="px-[calc(var(--turn-gutter)+18px)] py-1.5">
      <div className="flex items-center gap-3" title={message.detail ?? ""}>
        <div className={`h-px flex-1 ${lineTone}`} />
        <div
          className={`flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.02em] ${labelTone}`}
        >
          <BookOpen size={11} strokeWidth={1.8} />
          <span className="uppercase text-[9.5px] tracking-[0.12em] opacity-70">
            {verb}
          </span>
          <span className="truncate max-w-[40ch] text-app-text">{message.name}</span>
          {message.kind && (
            <span className="text-app-text-faint">· {message.kind}</span>
          )}
        </div>
        <div className={`h-px flex-1 ${lineTone}`} />
      </div>
    </div>
  );
}

function CompareTurn({
  message,
  canStop,
  onStop,
}: {
  message: ComparisonMessage;
  canStop?: boolean;
  onStop?: () => void;
}) {
  const accent = adapterAccent(message.adapter);
  const actions = canStop && onStop && (
    <GutterBtn title="Stop generating" onClick={onStop}>
      <Square size={9} className="fill-current" strokeWidth={0} />
    </GutterBtn>
  );
  return (
    <TurnRow
      kind="comparison"
      title={`compare · ${message.adapter}`}
      metaLines={["same prompt · base vs adapter"]}
      actions={actions || null}
      pending={!!message.pending}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ComparePane
          label="base"
          text={message.baseText}
          pending={message.pending === "base"}
          done={message.pending !== "base" && !!message.baseText}
        />
        <ComparePane
          label="adapter"
          adapterName={message.adapter}
          accentBorder={accent.border}
          text={message.adapterText}
          pending={message.pending === "adapter"}
          done={message.pending === null && !!message.adapterText}
        />
      </div>
    </TurnRow>
  );
}

function ComparePane({
  label,
  adapterName,
  accentBorder,
  text,
  pending,
  done,
}: {
  label: string;
  adapterName?: string;
  accentBorder?: string;
  text: string;
  pending: boolean;
  done: boolean;
}) {
  return (
    <div
      className="flex min-h-[160px] flex-col gap-2 rounded-lg border bg-app-surface p-3.5"
      style={{ borderColor: accentBorder ?? undefined }}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-app-text-faint">
        <span>{label}</span>
        {adapterName && <AdapterPill name={adapterName} />}
        {pending && <span className="text-app-accent">· streaming</span>}
      </div>
      <div className="text-[13.5px] leading-[1.55] text-app-text">
        {text ? (
          <Markdown>{text}</Markdown>
        ) : pending ? (
          "…"
        ) : done ? null : (
          <span className="text-app-text-faint">(waiting)</span>
        )}
      </div>
    </div>
  );
}

function AdapterPill({ name }: { name: string }) {
  const accent = adapterAccent(name);
  return (
    <div
      className="mb-1 inline-flex items-center rounded-sm border px-1.5 py-0 font-mono text-[10px] font-medium"
      style={{
        backgroundColor: accent.bg,
        color: accent.text,
        borderColor: accent.border,
      }}
    >
      {name}
    </div>
  );
}
