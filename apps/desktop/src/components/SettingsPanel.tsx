import { useState } from "react";
import { ArrowLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  type Memory,
  type MemoryInput,
  MEMORY_LIMITS,
  totalBytes,
} from "../lib/memory";
import { AuditLogSection } from "./AuditLogSection";

export type Theme = "dark" | "light" | "system";
export type MemoryWritePolicy = "off" | "ask" | "auto";
export type SearchProvider = "duckduckgo" | "brave";

export type Settings = {
  temperature: number;
  topP: number;
  maxTokens: number;
  theme: Theme;
  /** Auto-load the last-used base model on app start. Off by default so
   * cold starts never block on an unwanted several-GB load. */
  autoLoadLastBase: boolean;
  /** When true, render the model's chain-of-thought inline with the final
   * answer (legacy behavior). Default collapses it behind a disclosure. */
  showThinkingInline: boolean;
  /** Prepended as a system-role message to every turn. Blank disables it. */
  systemPrompt: string;
  /** How the agent's save_memory tool call is handled:
   *  off  → rejected outright (denied tool call)
   *  ask  → confirmation modal with editable name/content
   *  auto → runs without prompting (still audited) */
  memoryWritePolicy: MemoryWritePolicy;
  /** When true, memory notes are prepended to the system context. Off
   * hides them from the model without deleting anything. */
  useMemoryInContext: boolean;
  /** When true, the model can call save_memory during normal (non–computer
   * use) chat. Saves render as a compact inline chip rather than a tool
   * bubble. Policy (off/ask/auto) still applies. */
  memoryInNormalChat: boolean;
  /** When true, `fetch_page` and `web_search` are exposed in normal chat
   * (not just Computer Use). Neither touches the filesystem or shell, so
   * they're safe to allow by default. */
  webToolsInNormalChat: boolean;
  /** Which backend powers the web_search tool. DuckDuckGo is zero-setup
   * (uses DuckDuckGo's lite HTML endpoint). Brave requires an API key but
   * is more reliable. */
  searchProvider: SearchProvider;
  /** Brave Search API key — used only when searchProvider === "brave".
   * Stored in localStorage at rest; sent only to Brave. */
  braveApiKey: string;
};

export const DEFAULT_SETTINGS: Settings = {
  temperature: 0.7,
  topP: 0.95,
  maxTokens: 7168,
  theme: "system",
  autoLoadLastBase: false,
  showThinkingInline: false,
  systemPrompt: "",
  memoryWritePolicy: "auto",
  useMemoryInContext: true,
  memoryInNormalChat: true,
  webToolsInNormalChat: true,
  searchProvider: "duckduckgo",
  braveApiKey: "",
};

const SETTINGS_KEY = "lora-hub:settings:v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Migrate installs that were on the old "ask" default to "auto". The
    // old default caused a modal on every save_memory; users who'd never
    // visited Settings had no way to know they could change it. Users
    // who deliberately picked "off" are preserved.
    if (parsed.memoryWritePolicy === "ask") {
      parsed.memoryWritePolicy = "auto";
    }
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

type Props = {
  settings: Settings;
  onChange: (s: Settings) => void;
  onBack: () => void;
  memories: Memory[];
  onSaveMemory: (m: MemoryInput) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
};

/**
 * Full-page Settings view. Matches the app chrome used by Adapter Spec Sheet
 * and Store: mono "settings" eyebrow in the titlebar, scrollable body with
 * numbered sections. Designed to grow as more knobs land.
 */
export function SettingsPage({ settings, onChange, onBack, memories, onSaveMemory, onDeleteMemory }: Props) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-app-border px-5 py-2.5">
        <button
          onClick={onBack}
          title="Back"
          className="rounded-md p-1 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
        >
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <span className="font-mono text-[11px] text-app-text-faint">settings</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-8 pt-6 pb-16">
          <h1 className="mb-2 font-serif text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-app-text">
            Settings
          </h1>
          <p className="mb-8 max-w-[52ch] font-serif text-[14px] leading-[1.55] text-app-text-muted">
            Preferences persist on this device only.
          </p>

          <Section number="01" title="appearance" dek="how the app looks">
            <ThemeRow
              value={settings.theme}
              onChange={(t) => onChange({ ...settings, theme: t })}
            />
          </Section>

          <Section
            number="02"
            title="memory"
            dek="durable notes the model sees on every turn"
          >
            <MemorySection
              memories={memories}
              policy={settings.memoryWritePolicy}
              useInContext={settings.useMemoryInContext}
              inNormalChat={settings.memoryInNormalChat}
              onPolicyChange={(p) => onChange({ ...settings, memoryWritePolicy: p })}
              onUseInContextChange={(v) => onChange({ ...settings, useMemoryInContext: v })}
              onInNormalChatChange={(v) => onChange({ ...settings, memoryInNormalChat: v })}
              onSave={onSaveMemory}
              onDelete={onDeleteMemory}
            />
          </Section>

          <Section
            number="03"
            title="system prompt"
            dek="prepended as a system-role message to every turn"
          >
            <TextareaRow
              label="system prompt"
              help="Shapes the model's voice across every chat on this device. Leave blank to disable. Common uses: set a role, enforce a tone, require a format, pin safety constraints."
              placeholder="You are a helpful engineering assistant. Be concise. Answer in plain English. When code is requested, prefer idiomatic, well-commented examples."
              rows={6}
              value={settings.systemPrompt}
              onChange={(v) => onChange({ ...settings, systemPrompt: v })}
            />
          </Section>

          <Section
            number="04"
            title="session"
            dek="behavior at launch &amp; during a turn"
          >
            <ToggleRow
              label="auto-load last base"
              help="On next launch, reload whatever base you had loaded last. Weights are cached on disk, but the load still takes a few seconds and a few GB of RAM — so off by default."
              value={settings.autoLoadLastBase}
              onChange={(v) =>
                onChange({ ...settings, autoLoadLastBase: v })
              }
            />
            <ToggleRow
              label="show thinking inline"
              help="Render the model's chain-of-thought alongside the final answer. Off by default — thinking collapses behind a disclosure you can click open."
              value={settings.showThinkingInline}
              onChange={(v) =>
                onChange({ ...settings, showThinkingInline: v })
              }
            />
          </Section>

          <Section
            number="05"
            title="generation"
            dek="sampling knobs — applied to every turn"
          >
            <SliderRow
              label="temperature"
              help="Higher = more random. 0.7 is a good chat default."
              min={0}
              max={1.5}
              step={0.05}
              value={settings.temperature}
              onChange={(v) => onChange({ ...settings, temperature: v })}
            />
            <SliderRow
              label="top_p"
              help="Nucleus sampling cutoff. 0.95 keeps most plausible tokens in play."
              min={0.1}
              max={1.0}
              step={0.01}
              value={settings.topP}
              onChange={(v) => onChange({ ...settings, topP: v })}
            />
            <NumberRow
              label="max_tokens"
              help="Hard cap on response length. Stops early on EOS."
              min={32}
              max={4096}
              step={32}
              value={settings.maxTokens}
              onChange={(v) => onChange({ ...settings, maxTokens: v })}
            />
          </Section>

          <Section
            number="06"
            title="integrations"
            dek="api keys for optional external services"
          >
            <div>
              <div className="mb-1.5 font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">
                search provider
              </div>
              <div className="inline-flex rounded-md border border-app-border bg-app-surface p-0.5">
                {(["duckduckgo", "brave"] as SearchProvider[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => onChange({ ...settings, searchProvider: p })}
                    className={`rounded px-3 py-1 font-mono text-[11px] ${
                      settings.searchProvider === p
                        ? "bg-app-accent text-white"
                        : "text-app-text-muted hover:text-app-text"
                    }`}
                  >
                    {p === "duckduckgo" ? "duckduckgo (free)" : "brave (api key)"}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[12px] leading-[1.45] text-app-text-faint">
                {settings.searchProvider === "duckduckgo" ? (
                  <>Zero setup — uses DuckDuckGo's lite HTML endpoint. Brittle to layout changes; swap to Brave for reliability.</>
                ) : (
                  <>Brave Search API. 2000 free queries/month, then $3/mo for 20k. Key stays on this device.</>
                )}
              </div>
            </div>
            {settings.searchProvider === "brave" && (
              <SecretRow
                label="brave search api key"
                help="Sign up at brave.com/search/api. Stored only on this device, sent only to Brave."
                placeholder="BSA… (leave blank to disable web_search)"
                value={settings.braveApiKey}
                onChange={(v) => onChange({ ...settings, braveApiKey: v })}
              />
            )}
            <ToggleRow
              label="web tools in normal chat"
              help="Expose fetch_page and web_search in normal chat (not just Computer Use mode). Lets the model answer questions like 'what's the weather in San Jose?' without requiring a workspace pick. Neither tool writes to your filesystem."
              value={settings.webToolsInNormalChat}
              onChange={(v) => onChange({ ...settings, webToolsInNormalChat: v })}
            />
          </Section>

          <Section
            number="07"
            title="audit log"
            dek="every tool call recorded on this device"
          >
            <AuditLogSection />
          </Section>

          <div className="mt-10 flex items-center justify-between border-t border-app-border pt-6">
            <button
              onClick={() => onChange(DEFAULT_SETTINGS)}
              className="font-mono text-[11px] text-app-text-muted hover:text-app-accent"
            >
              reset to defaults
            </button>
            <button
              onClick={onBack}
              className="rounded-md border border-app-border-strong px-3 py-1.5 font-mono text-[11px] text-app-text hover:bg-app-surface-hover"
            >
              done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Section primitives ---------------------- */

function Section({
  number,
  title,
  dek,
  children,
}: {
  number: string;
  title: string;
  dek: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 first:mt-6">
      <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-app-border pb-2.5">
        <div className="font-mono text-[11px] font-medium tracking-[0.22em] uppercase text-app-accent">
          {number} · {title}
        </div>
        <div
          className="font-mono text-[10.5px] text-app-text-faint"
          dangerouslySetInnerHTML={{ __html: dek }}
        />
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function ThemeRow({
  value,
  onChange,
}: {
  value: Theme;
  onChange: (t: Theme) => void;
}) {
  const opts: { v: Theme; label: string; help: string }[] = [
    { v: "dark", label: "dark", help: "Paper & Ink" },
    { v: "light", label: "light", help: "Paper" },
    { v: "system", label: "system", help: "follow OS" },
  ];
  return (
    <div>
      <div className="mb-1.5 font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">
        theme
      </div>
      <div className="inline-flex overflow-hidden rounded-md border border-app-border">
        {opts.map((o, i) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`border-app-border px-3 py-1 font-mono text-[11px] ${
              i < opts.length - 1 ? "border-r" : ""
            } ${
              value === o.v
                ? "bg-app-accent text-app-bg"
                : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
            }`}
            title={o.help}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-1 text-[12px] leading-[1.45] text-app-text-faint">
        Switches between the Paper &amp; Ink (dark) and Paper (light) palettes.
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <label className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          onClick={() => onChange(!value)}
          className={`relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors ${
            value
              ? "border-app-accent bg-app-accent"
              : "border-app-border bg-app-surface"
          }`}
        >
          <span
            className={`inline-block h-[12px] w-[12px] rounded-full transition-transform ${
              value
                ? "translate-x-[16px] bg-app-bg"
                : "translate-x-[2px] bg-app-text-muted"
            }`}
          />
        </button>
      </label>
      <div className="mt-1 text-[12px] leading-[1.45] text-app-text-faint">
        {help}
      </div>
    </div>
  );
}

function TextareaRow({
  label,
  help,
  placeholder,
  rows,
  value,
  onChange,
}: {
  label: string;
  help: string;
  placeholder?: string;
  rows?: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">
          {label}
        </span>
        <span className="font-mono text-[10.5px] text-app-text-faint">
          {value.length} char{value.length === 1 ? "" : "s"}
        </span>
      </div>
      <textarea
        rows={rows ?? 4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full resize-y rounded-md border border-app-border bg-app-surface px-3 py-2 font-mono text-[12.5px] leading-[1.55] text-app-text placeholder:text-app-text-faint focus:border-app-border-strong focus:outline-none"
      />
      <div className="mt-1 text-[12px] leading-[1.45] text-app-text-faint">
        {help}
      </div>
    </div>
  );
}

/** Password-style input with a reveal toggle. Used for API keys; defaults
 * to masked so the value doesn't shoulder-surf in screen shares. */
function SecretRow({
  label,
  help,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  help: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">
          {label}
        </span>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="font-mono text-[10.5px] text-app-text-faint hover:text-app-text"
        >
          {revealed ? "hide" : value ? "reveal" : ""}
        </button>
      </div>
      <input
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-md border border-app-border bg-app-surface px-3 py-2 font-mono text-[12.5px] leading-[1.55] text-app-text placeholder:text-app-text-faint focus:border-app-border-strong focus:outline-none"
      />
      <div className="mt-1 text-[12px] leading-[1.45] text-app-text-faint">
        {help}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  help,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-app-text-muted">
          {label}
        </span>
        <span className="font-mono text-[12px] text-app-text">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-app-accent"
      />
      <div className="mt-1 text-[12px] leading-[1.45] text-app-text-faint">
        {help}
      </div>
    </div>
  );
}

function NumberRow({
  label,
  help,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-app-text-muted">
          {label}
        </span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 rounded-md border border-app-border bg-app-surface px-2 py-1 text-right font-mono text-[12px] text-app-text focus:border-app-border-strong focus:outline-none"
        />
      </div>
      <div className="mt-1 text-[12px] leading-[1.45] text-app-text-faint">
        {help}
      </div>
    </div>
  );
}

function MemorySection({
  memories,
  policy,
  useInContext,
  inNormalChat,
  onPolicyChange,
  onUseInContextChange,
  onInNormalChatChange,
  onSave,
  onDelete,
}: {
  memories: Memory[];
  policy: MemoryWritePolicy;
  useInContext: boolean;
  inNormalChat: boolean;
  onPolicyChange: (p: MemoryWritePolicy) => void;
  onUseInContextChange: (v: boolean) => void;
  onInNormalChatChange: (v: boolean) => void;
  onSave: (m: MemoryInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemoryInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editsOpen, setEditsOpen] = useState(false);

  const bytes = totalBytes(memories);
  const nearLimit = bytes > MEMORY_LIMITS.maxTotalBytes * 0.8;
  const grouped = groupMemoriesByKind(memories);

  function startNew() {
    setEditingId("__new__");
    setDraft({ name: "", content: "", kind: null, source: "user" });
    setError(null);
    setEditsOpen(true);
  }

  function startEdit(m: Memory) {
    setEditingId(m.id);
    setDraft({ id: m.id, name: m.name, content: m.content, kind: m.kind ?? null, source: m.source ?? "user" });
    setError(null);
    setEditsOpen(true);
  }

  async function commitDraft() {
    if (!draft) return;
    try {
      await onSave(draft);
      setEditingId(null);
      setDraft(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-[1.5] text-app-text-muted">
        Here's what your model remembers about you. This summary is grouped
        by kind and updates as memories are saved — each entry below the
        card can be edited or deleted individually.
      </p>

      <div className="rounded-lg border border-app-border bg-app-surface p-5">
        {memories.length === 0 ? (
          <div className="text-[13px] leading-[1.5] text-app-text-faint">
            No memories yet. Turn on <strong>agent writes</strong> below and
            let the model save durable facts it notices, or add one manually
            under Manage edits.
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map((g) => (
              <div key={g.kind ?? "__unclassified__"}>
                <h3 className="text-[14px] font-semibold text-app-text">
                  {humanizeKind(g.kind)}
                </h3>
                <div className="mt-1.5 space-y-2 font-serif text-[13.5px] leading-[1.55] text-app-text">
                  {g.memories.map((m) => (
                    <p key={m.id}>{m.content}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setEditsOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-app-border bg-app-surface px-3.5 py-2.5 text-left hover:bg-app-surface-hover"
      >
        <span className="text-[13px] text-app-text">Manage edits</span>
        <span className="flex items-center gap-2 font-mono text-[11px] text-app-text-muted">
          {memories.length}
          <ChevronRight
            size={14}
            strokeWidth={2}
            className={`transition-transform ${editsOpen ? "rotate-90" : ""}`}
          />
        </span>
      </button>

      {editsOpen && (
        <div className="space-y-3 rounded-md border border-app-border bg-app-surface/50 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10.5px] text-app-text-faint">
              {memories.length} / {MEMORY_LIMITS.maxMemories} memories · {bytes} /{" "}
              {MEMORY_LIMITS.maxTotalBytes} bytes
              {nearLimit ? " · near limit" : ""}
            </span>
            <button
              onClick={startNew}
              disabled={memories.length >= MEMORY_LIMITS.maxMemories || editingId === "__new__"}
              className="rounded-md border border-app-border-strong px-2.5 py-1 font-mono text-[11px] text-app-text hover:bg-app-surface-hover disabled:opacity-50"
            >
              + add memory
            </button>
          </div>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 font-mono text-[11px] text-red-400">
              {error}
            </div>
          )}

          {editingId === "__new__" && draft && (
            <MemoryEditor
              draft={draft}
              onChange={setDraft}
              onCancel={() => {
                setEditingId(null);
                setDraft(null);
              }}
              onSave={commitDraft}
            />
          )}

          {memories.length === 0 && editingId !== "__new__" && (
            <div className="rounded-md border border-dashed border-app-border px-3 py-4 text-[12.5px] leading-[1.5] text-app-text-faint">
              No memories yet.
            </div>
          )}

          <ul className="space-y-2">
            {[...memories]
              .sort((a, b) => b.updated_at - a.updated_at)
              .map((m) => (
                <li
                  key={m.id}
                  className="rounded-md border border-app-border bg-app-surface"
                >
                  {editingId === m.id && draft ? (
                    <MemoryEditor
                      draft={draft}
                      onChange={setDraft}
                      onCancel={() => {
                        setEditingId(null);
                        setDraft(null);
                      }}
                      onSave={commitDraft}
                    />
                  ) : (
                    <div className="flex items-start gap-2 px-3 py-2">
                      <div className="flex-1 cursor-pointer" onClick={() => startEdit(m)}>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-[12px] text-app-text">{m.name}</span>
                          {m.kind && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-app-text-faint">
                              {m.kind}
                            </span>
                          )}
                          {m.source?.startsWith("agent:") && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-app-accent">
                              agent
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate font-serif text-[13px] leading-[1.4] text-app-text-muted">
                          {m.content}
                        </div>
                      </div>
                      <button
                        onClick={() => void onDelete(m.id)}
                        title="Delete memory"
                        className="rounded p-1 text-app-text-faint hover:bg-app-surface-hover hover:text-red-400"
                      >
                        <Trash2 size={13} strokeWidth={1.8} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="space-y-4 border-t border-app-border pt-4">
        <div>
          <div className="mb-1.5 font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">
            agent writes
          </div>
          <div className="inline-flex rounded-md border border-app-border bg-app-surface p-0.5">
            {(["off", "ask", "auto"] as MemoryWritePolicy[]).map((p) => (
              <button
                key={p}
                onClick={() => onPolicyChange(p)}
                className={`rounded px-3 py-1 font-mono text-[11px] ${
                  policy === p
                    ? "bg-app-accent text-white"
                    : "text-app-text-muted hover:text-app-text"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[12px] leading-[1.45] text-app-text-faint">
            Whether the assistant may call <code>save_memory</code> on its own.{" "}
            <strong>ask</strong> shows a confirmation modal with editable fields. <strong>auto</strong> skips
            confirmation but still audits every write. Secret-like strings are always blocked.
          </div>
        </div>

        <ToggleRow
          label="use memory in context"
          help="Prepend saved memories to the system context on every turn. Turn off to hide them from the model without deleting anything."
          value={useInContext}
          onChange={onUseInContextChange}
        />

        <ToggleRow
          label="save during normal chat"
          help="Let the model call save_memory outside Computer Use mode. Saves render as a small inline chip instead of a full tool bubble. Still respects the agent-writes policy above."
          value={inNormalChat}
          onChange={onInNormalChatChange}
        />
      </div>
    </div>
  );
}

function groupMemoriesByKind(memories: Memory[]): {
  kind: string | null;
  memories: Memory[];
}[] {
  // Preserve the order in which kinds first appear, so new kinds land at
  // the bottom rather than shuffling every time a memory is added.
  const byKind = new Map<string, Memory[]>();
  for (const m of memories) {
    const k = m.kind ?? "";
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(m);
  }
  const result: { kind: string | null; memories: Memory[] }[] = [];
  for (const [k, list] of byKind) {
    // Within a kind, sort newest-last so the reader's eye lands on the
    // oldest context first and the fresher facts build on top.
    const sorted = [...list].sort((a, b) => a.updated_at - b.updated_at);
    result.push({ kind: k === "" ? null : k, memories: sorted });
  }
  return result;
}

function humanizeKind(kind: string | null): string {
  if (!kind) return "Notes";
  // Title-case the kind and pluralize crude categories so the heading
  // reads like a section title: "fact" → "Facts", "preference" →
  // "Preferences", "identity" → "Identity" (no plural — already a mass noun).
  const titled = kind.charAt(0).toUpperCase() + kind.slice(1);
  if (kind === "fact" || kind === "preference" || kind === "interest" || kind === "goal") {
    return `${titled}s`;
  }
  return titled;
}

function MemoryEditor({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: MemoryInput;
  onChange: (d: MemoryInput) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-2 px-3 py-3">
      <input
        autoFocus
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        placeholder="Short title"
        maxLength={MEMORY_LIMITS.maxNameChars}
        className="w-full rounded-md border border-app-border bg-app-bg px-2.5 py-1.5 font-mono text-[12.5px] text-app-text focus:border-app-border-strong focus:outline-none"
      />
      <textarea
        rows={4}
        value={draft.content}
        onChange={(e) => onChange({ ...draft, content: e.target.value })}
        placeholder="What should the model remember?"
        maxLength={MEMORY_LIMITS.maxContentBytes}
        className="w-full resize-y rounded-md border border-app-border bg-app-bg px-2.5 py-1.5 font-mono text-[12.5px] leading-[1.5] text-app-text focus:border-app-border-strong focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <select
          value={draft.kind ?? ""}
          onChange={(e) => onChange({ ...draft, kind: e.target.value || null })}
          className="rounded-md border border-app-border bg-app-bg px-2 py-1 font-mono text-[11px] text-app-text"
        >
          <option value="">(no kind)</option>
          <option value="preference">preference</option>
          <option value="fact">fact</option>
          <option value="project">project</option>
          <option value="reference">reference</option>
        </select>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="font-mono text-[11px] text-app-text-muted hover:text-app-text"
          >
            cancel
          </button>
          <button
            onClick={onSave}
            disabled={!draft.name.trim() || !draft.content.trim()}
            className="rounded-md border border-app-border-strong px-2.5 py-1 font-mono text-[11px] text-app-text hover:bg-app-surface-hover disabled:opacity-50"
          >
            save
          </button>
        </div>
      </div>
    </div>
  );
}
