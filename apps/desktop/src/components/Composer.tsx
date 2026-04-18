import { Columns2, Paperclip, X } from "lucide-react";
import { CommandPicker, type CommandPickerItem } from "./CommandPicker";
import { ModeChip } from "./ModeChip";
import { PermissionsPicker } from "./PermissionsPicker";
import { adapterAccent } from "../lib/adapter-accent";
import type { Preset } from "../lib/workspace";
import type { Attachment } from "../lib/attachments";

type BaseOption = { base_id: string; name: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  baseLabel: string;
  baseId?: string | null;
  bases?: BaseOption[];
  onPickBase?: (baseId: string) => void;
  adapterLabel?: string | null;
  adapters: { name: string }[];
  onPickAdapter?: (name: string | null) => void;
  large?: boolean;
  compareMode?: boolean;
  onToggleCompare?: () => void;
  compareAvailable?: boolean;
  computerUseMode?: boolean;
  onToggleComputerUse?: () => void;
  permissionPreset?: Preset;
  onPickPreset?: (p: Preset) => void;
  /** Session sha — shown in the composer breadcrumb footer. */
  baseSha?: string | null;
  /** Workspace root — shown in the composer breadcrumb footer. */
  workspacePath?: string | null;
  /** Estimated tokens used by the next turn (history + system + current
   * input), vs. the model's context limit. Rendered as a chip in the
   * breadcrumb row. Omit to hide. */
  tokenUsage?: { used: number; limit: number } | null;
  /** Files dragged onto the window, about to be sent with the next turn. */
  attachments?: Attachment[];
  onRemoveAttachment?: (id: string) => void;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  baseLabel,
  baseId,
  bases = [],
  onPickBase,
  adapterLabel,
  adapters,
  onPickAdapter,
  large,
  compareMode,
  onToggleCompare,
  compareAvailable,
  computerUseMode,
  onToggleComputerUse,
  permissionPreset,
  onPickPreset,
  baseSha,
  workspacePath,
  tokenUsage,
  attachments = [],
  onRemoveAttachment,
}: Props) {
  const showAdapterPicker = adapters.length > 0 && !!onPickAdapter;
  const showBasePicker = bases.length > 1 && !!onPickBase;
  const showCompareToggle = !!onToggleCompare;
  const showModeChip = !!onToggleComputerUse;
  const showPermsPicker = !!onPickPreset && !!permissionPreset;

  const adapterItems: CommandPickerItem[] = adapters.map((a) => ({
    id: a.name,
    label: a.name,
    accent: adapterAccent(a.name),
  }));
  const baseItems: CommandPickerItem[] = bases.map((b) => ({
    id: b.base_id,
    label: b.name,
  }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={`mx-auto w-full ${large ? "max-w-2xl" : "max-w-3xl"}`}
    >
      <div
        className={`rounded-xl border bg-app-surface px-3.5 pt-2.5 pb-1.5 transition-colors ${
          computerUseMode ? "border-app-purple/50" : "border-app-border"
        }`}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                attachment={a}
                onRemove={() => onRemoveAttachment?.(a.id)}
              />
            ))}
          </div>
        )}
        <div className="flex items-start gap-2">
          {showModeChip && (
            <div className={large ? "pt-1.5" : "pt-0.5"}>
              <ModeChip
                active={!!computerUseMode}
                onToggle={onToggleComputerUse!}
              />
            </div>
          )}
          <textarea
            rows={large ? 2 : 1}
            className={`flex-1 min-w-0 resize-none bg-transparent font-sans text-app-text placeholder:text-app-text-faint focus:outline-none ${
              large ? "min-h-[40px] text-[15px] leading-[1.45]" : "min-h-[24px] text-[14px] leading-[1.5]"
            }`}
            placeholder={placeholder ?? "How can I help you today?"}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 border-t border-dashed border-app-border pt-1.5 font-mono text-[11px] text-app-text-muted">
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-app-border px-2 py-1 text-app-text-muted hover:border-app-border-strong hover:bg-app-surface-hover hover:text-app-text"
            title="Attach (coming soon)"
          >
            <Paperclip size={11} strokeWidth={2} />
            attach
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            {showCompareToggle && (
              <button
                type="button"
                onClick={onToggleCompare}
                disabled={!compareAvailable}
                title={
                  compareAvailable
                    ? compareMode
                      ? "Compare mode on — each send runs base and adapter side-by-side"
                      : "Turn on compare mode"
                    : "Select an adapter to enable compare mode"
                }
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  compareMode
                    ? "border-app-accent/50 bg-app-accent/15 text-app-accent"
                    : "border-app-border text-app-text-muted hover:border-app-border-strong hover:bg-app-surface-hover hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
                }`}
              >
                <Columns2 size={11} strokeWidth={2} />
                compare
              </button>
            )}
            {showAdapterPicker ? (
              <CommandPicker
                triggerLabel={adapterLabel ?? "no adapter"}
                items={adapterItems}
                activeId={adapterLabel ?? null}
                onSelect={(id) => onPickAdapter?.(id)}
                allowNone
                noneLabel="No adapter"
                placeholder="Search adapters…"
                emptyLabel="No adapters installed"
              />
            ) : (
              <span className="text-xs text-app-text-faint">
                {adapterLabel ?? "no adapter"}
              </span>
            )}
            {showBasePicker ? (
              <CommandPicker
                triggerLabel={baseLabel}
                items={baseItems}
                activeId={baseId ?? null}
                onSelect={(id) => id && onPickBase?.(id)}
                placeholder="Search bases…"
              />
            ) : (
              <span className="flex items-center gap-1 rounded-md px-2 py-1">
                {baseLabel}
              </span>
            )}
            {showPermsPicker && (
              <PermissionsPicker
                value={permissionPreset!}
                onChange={onPickPreset!}
              />
            )}
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-0 gap-y-1 px-0.5 pt-0.5 font-mono text-[10.5px] text-app-text-faint">
          <span className="text-app-text-faint">base/</span>
          <span className="text-app-text-muted">{baseLabel}</span>
          {baseSha && (
            <>
              <span className="mx-2 opacity-60">·</span>
              <span className="text-app-text-faint">sha/</span>
              <span className="text-app-text-muted">
                {baseSha.slice(0, 4)}…{baseSha.slice(-4)}
              </span>
            </>
          )}
          {workspacePath && (
            <>
              <span className="mx-2 opacity-60">·</span>
              <span className="text-app-text-faint">ws/</span>
              <span className="text-app-text-muted">{workspacePath}</span>
            </>
          )}
          {tokenUsage && (
            <>
              <span className="mx-2 opacity-60">·</span>
              <TokenChip used={tokenUsage.used} limit={tokenUsage.limit} />
            </>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>⏎</Kbd>
            <span>send</span>
            <Kbd>⌘K</Kbd>
            <span>switch</span>
          </span>
        </div>
      </div>
    </form>
  );
}

/** Context-window usage chip: mono digits, tinted when the upcoming turn
 * is getting close to the model's limit. Uses the standard three-tier
 * pattern (fine / warn ≥75% / danger ≥95%) so you notice without noise. */
function TokenChip({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? used / limit : 0;
  const tone =
    ratio >= 0.95
      ? "text-red-400"
      : ratio >= 0.75
        ? "text-amber-500"
        : "text-app-text-muted";
  return (
    <>
      <span className="text-app-text-faint">ctx/</span>
      <span className={tone} title={`~${used.toLocaleString()} of ${limit.toLocaleString()} tokens`}>
        {formatTokens(used)}
        <span className="text-app-text-faint">/</span>
        {formatTokens(limit)}
      </span>
    </>
  );
}

function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(2)}k`;
  return String(n);
}

/** Attachment preview: thumbnail for images, document-glyph + filename
 * for everything else. Truncation and error states are shown in the
 * subtitle line so you know what got through and what didn't. */
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const isError = attachment.kind === "unsupported";
  const subtitleParts: string[] = [];
  if (attachment.size > 0) subtitleParts.push(formatBytes(attachment.size));
  if (attachment.kind === "pdf") subtitleParts.push("pdf · text extracted");
  if (attachment.kind === "text") subtitleParts.push("text");
  if (attachment.kind === "image") subtitleParts.push(attachment.mime || "image");
  if (attachment.truncated) subtitleParts.push("truncated");
  if (isError) subtitleParts.push(attachment.reason ?? "unsupported");

  return (
    <div
      className={`group flex items-center gap-2 rounded-md border px-2 py-1 ${
        isError
          ? "border-red-500/40 bg-red-500/5"
          : "border-app-border bg-app-surface"
      }`}
    >
      {attachment.kind === "image" && attachment.data_url ? (
        <img
          src={attachment.data_url}
          alt={attachment.name}
          className="h-7 w-7 rounded object-cover"
        />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded bg-app-bg">
          <Paperclip size={12} strokeWidth={1.8} className="text-app-text-faint" />
        </div>
      )}
      <div className="min-w-0 max-w-[180px]">
        <div
          className={`truncate font-mono text-[11px] ${
            isError ? "text-red-400" : "text-app-text"
          }`}
          title={attachment.name}
        >
          {attachment.name}
        </div>
        {subtitleParts.length > 0 && (
          <div className="truncate font-mono text-[10px] text-app-text-faint">
            {subtitleParts.join(" · ")}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        className="rounded p-0.5 text-app-text-faint opacity-60 hover:bg-app-surface-hover hover:opacity-100"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[3px] border border-app-border border-b-[1.6px] px-[5px] py-[1px] font-mono text-[10px] text-app-text-muted">
      {children}
    </span>
  );
}
