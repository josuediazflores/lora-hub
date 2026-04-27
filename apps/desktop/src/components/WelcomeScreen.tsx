import { Composer } from "./Composer";
import { QuickChips, defaultChips } from "./QuickChips";
import { FeaturedAdapters } from "./FeaturedAdapters";
import { Gemma4Tile } from "./Gemma4Tile";
import { adapterAccent } from "../lib/adapter-accent";
import type { StoreAdapter, StoreBase } from "../lib/store";
import type { Attachment } from "../lib/attachments";
import type { ChatMode } from "./ModeChip";

export function WelcomeScreen({
  input,
  onInputChange,
  onSubmit,
  disabled,
  baseLabel,
  adapters,
  adapter,
  onPickAdapter,
  bases,
  baseId,
  onPickBase,
  chips,
  baseSha,
  installedSlugs,
  onTryAdapter,
  workspacePath,
  tokenUsage,
  attachments,
  onRemoveAttachment,
  onPickFiles,
  mode,
  onSetMode,
}: {
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  baseLabel: string;
  adapters: { name: string }[];
  adapter: string | null;
  onPickAdapter: (n: string | null) => void;
  bases: StoreBase[];
  baseId: string | null;
  onPickBase: (baseId: string) => void;
  chips: ReturnType<typeof defaultChips>;
  baseSha: string | null;
  installedSlugs: Set<string>;
  onTryAdapter: (adapter: StoreAdapter) => void;
  workspacePath: string | null;
  tokenUsage: { used: number; limit: number };
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onPickFiles: () => void;
  mode: ChatMode;
  onSetMode: (m: ChatMode) => void;
}) {
  const ready = !!baseSha;
  const eyebrow = `${adapter ?? "no adapter"} · ${baseLabel} · ${
    ready ? "ready" : "load base to begin"
  }`;

  const suggestions: { text: string; color: string; onClick: () => void }[] =
    adapters.length > 0
      ? adapters.slice(0, 4).map((a) => ({
          text: starterPromptFor(a.name),
          color: adapterAccent(a.name).text,
          onClick: () => {
            onPickAdapter(a.name);
            onInputChange(starterPromptFor(a.name));
          },
        }))
      : [];

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-[720px] text-center">
          <div className="mb-2 font-mono text-[11px] tracking-[0.14em] uppercase text-app-text-faint">
            {eyebrow}
          </div>
          <h1 className="m-0 font-serif text-[32px] font-medium tracking-[-0.01em] text-app-text">
            How can I help you today?
          </h1>
          <p className="mx-auto mt-2.5 mb-5 max-w-[520px] text-[14px] leading-[1.55] text-app-text-muted">
            Every turn is tagged with the adapter and base that produced it.
            Swap adapters mid-conversation — the transcript keeps the receipts.
          </p>

          {suggestions.length > 0 ? (
            <div className="mx-auto grid max-w-[560px] grid-cols-2 gap-2">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={s.onClick}
                  className="flex items-start gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2.5 text-left text-[13px] leading-[1.45] text-app-text hover:border-app-border-strong hover:bg-app-surface-hover"
                >
                  <span
                    aria-hidden="true"
                    className="mt-[5px] inline-block h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: s.color }}
                  />
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <WalkthroughHint
                baseLoaded={ready}
                adaptersInstalled={adapters.length > 0}
              />
              <QuickChips chips={chips} />
              {baseSha && (
                <FeaturedAdapters
                  baseSha={baseSha}
                  installedSlugs={installedSlugs}
                  onTry={onTryAdapter}
                />
              )}
              {bases.some((b) => b.base_id === "gemma-4-e4b-it-4bit") && <Gemma4Tile />}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-app-border bg-app-bg px-6 py-4">
        <Composer
          large
          value={input}
          onChange={onInputChange}
          onSubmit={onSubmit}
          disabled={disabled}
          baseLabel={baseLabel}
          baseId={baseId}
          bases={bases}
          onPickBase={onPickBase}
          adapters={adapters}
          adapterLabel={adapter}
          onPickAdapter={onPickAdapter}
          baseSha={baseSha}
          workspacePath={workspacePath}
          tokenUsage={tokenUsage}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          onPickFiles={onPickFiles}
          mode={mode}
          onSetMode={onSetMode}
        />
      </div>
    </div>
  );
}

export function starterPromptFor(adapterName: string): string {
  const s = adapterName.toLowerCase();
  if (s.includes("sql")) return "top 10 customers by revenue last quarter";
  if (s.includes("email") || s.includes("rewrite"))
    return "rewrite this email more formally";
  if (s.includes("grep") || s.includes("tool"))
    return "extract JSON from an nginx log line";
  if (s.includes("summar")) return "summarize this thread in three bullets";
  return `try ${adapterName} on a real task from your workspace`;
}

function WalkthroughHint({
  baseLoaded,
  adaptersInstalled,
}: {
  baseLoaded: boolean;
  adaptersInstalled: boolean;
}) {
  const step = !baseLoaded
    ? { n: 1, label: "pick a base model" }
    : !adaptersInstalled
      ? { n: 2, label: "install your first adapter" }
      : { n: 3, label: "send a prompt — try compare mode after" };
  return (
    <div className="mx-auto mt-4 flex max-w-2xl items-center justify-center gap-2 font-mono text-[11px] text-app-text-faint">
      <span className="rounded-sm border border-app-border px-1 py-0.5">
        {step.n} / 3
      </span>
      <span>{step.label}</span>
    </div>
  );
}
