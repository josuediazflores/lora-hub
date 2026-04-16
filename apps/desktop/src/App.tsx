import { useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { RefreshCw } from "lucide-react";
import { Logo } from "./components/Logo";
import { Sidebar, type Conversation } from "./components/Sidebar";
import { Composer } from "./components/Composer";
import { QuickChips, defaultChips } from "./components/QuickChips";
import { StoreView } from "./components/StoreView";
import * as sidecar from "./lib/sidecar";
import * as store from "./lib/store";
import type { StoreAdapter, StoreBase } from "./lib/store";

const USER_NAME = "Josue Diaz Flores";

const FALLBACK_BASES: StoreBase[] = [
  {
    base_id: "gemma-3-4b-it-4bit",
    name: "Gemma 3 4B Instruct (4-bit)",
    family: "gemma",
    parameters: "4B",
    quant: "4bit",
    base_sha: "3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698",
    hf_repo: "mlx-community/gemma-3-4b-it-4bit",
    size_bytes: 2_500_000_000,
    license: "Gemma Terms",
    description: "",
  },
];

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  adapter?: string | null;
  pending?: boolean;
  progress?: { desc: string; percent: number; n: number; total: number } | null;
};

type Status = {
  base_model_id: string | null;
  base_sha: string | null;
  active_adapter: string | null;
  adapters: { name: string; path: string; base_sha: string | null }[];
};

type Chat = {
  id: string;
  title: string;
  messages: Message[];
};

type View = "chat" | "store";

const STORAGE_KEY = "lora-hub:chats:v1";
const ACTIVE_KEY = "lora-hub:active-chat:v1";

type PersistedChat = { id: string; title: string; messages: Message[] };

function loadPersistedChats(): { chats: Chat[]; activeId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chats: [emptyChat()], activeId: "" };
    const parsed = JSON.parse(raw) as PersistedChat[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { chats: [emptyChat()], activeId: "" };
    }
    const chats: Chat[] = parsed.map((c) => ({
      id: c.id,
      title: c.title,
      messages: (c.messages ?? []).map((m) => ({
        ...m,
        progress: null,
        pending: false,
      })),
    }));
    const activeId = localStorage.getItem(ACTIVE_KEY) ?? chats[0].id;
    return { chats, activeId: chats.some((c) => c.id === activeId) ? activeId : chats[0].id };
  } catch {
    return { chats: [emptyChat()], activeId: "" };
  }
}

function persistChats(chats: Chat[]): void {
  try {
    const cleaned: PersistedChat[] = chats.map((c) => ({
      id: c.id,
      title: c.title,
      messages: c.messages.map((m) => ({ ...m, progress: null, pending: false })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // ignore quota errors etc.
  }
}

function App() {
  const initial = useRef(loadPersistedChats());
  const [status, setStatus] = useState<Status | null>(null);
  const [bases, setBases] = useState<StoreBase[]>(FALLBACK_BASES);
  const [chats, setChats] = useState<Chat[]>(initial.current.chats);
  const [activeChatId, setActiveChatId] = useState<string>(
    initial.current.activeId || initial.current.chats[0].id,
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeChat = chats.find((c) => c.id === activeChatId)!;
  const messages = activeChat.messages;
  const baseLoaded = !!status?.base_model_id;
  const activeBase =
    bases.find((b) => b.hf_repo === status?.base_model_id) ?? null;
  const baseLabel = activeBase?.name ?? "no base";
  const isWelcome = messages.length === 0;

  async function refreshStatus() {
    try {
      const res = await sidecar.status();
      if (res.type === "done") {
        setStatus(res.result as Status);
        setStatusError(null);
      } else {
        setStatusError(res.error.message);
      }
    } catch (e) {
      setStatusError(String(e));
    }
  }

  useEffect(() => {
    refreshStatus();
    store
      .fetchBases()
      .then((bs) => bs.length && setBases(bs))
      .catch(() => {
        // storefront unreachable — keep fallback so the app still works
      });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    persistChats(chats);
  }, [chats]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_KEY, activeChatId);
    } catch {
      // ignore
    }
  }, [activeChatId]);

  function patchActiveChat(fn: (c: Chat) => Chat) {
    setChats((prev) => prev.map((c) => (c.id === activeChatId ? fn(c) : c)));
  }

  function pushSystem(text: string) {
    patchActiveChat((c) => ({
      ...c,
      messages: [
        ...c.messages,
        { id: crypto.randomUUID(), role: "system", text },
      ],
    }));
  }

  function newChat() {
    const c = emptyChat();
    setChats((prev) => [c, ...prev]);
    setActiveChatId(c.id);
  }

  async function handleLoadBase(base: StoreBase) {
    setBusy(true);
    const progressId = crypto.randomUUID();
    patchActiveChat((c) => ({
      ...c,
      messages: [
        ...c.messages,
        {
          id: progressId,
          role: "system",
          text: `Loading ${base.name}…`,
          progress: { desc: "preparing", percent: 0, n: 0, total: 0 },
        },
      ],
    }));

    const res = await sidecar.loadBase(base.hf_repo, {
      onProgress: (p) => {
        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === progressId
              ? {
                  ...m,
                  text: p.total
                    ? `${base.name} — ${p.desc || "downloading"} ${p.n ?? 0}/${p.total} (${p.percent ?? 0}%)`
                    : `${base.name} — ${p.desc || "preparing"}`,
                  progress: {
                    desc: p.desc ?? "",
                    percent: p.percent ?? 0,
                    n: p.n ?? 0,
                    total: p.total ?? 0,
                  },
                }
              : m,
          ),
        }));
      },
    });

    if (res.type === "error") {
      patchActiveChat((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === progressId
            ? { ...m, text: `Error: ${res.error.message}`, progress: null }
            : m,
        ),
      }));
    } else {
      const r = res.result as { base_sha: string; cached: boolean };
      patchActiveChat((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === progressId
            ? {
                ...m,
                text: `${base.name} ready (${r.base_sha.slice(0, 8)}…${r.cached ? ", cached" : ""})`,
                progress: null,
              }
            : m,
        ),
      }));
    }
    await refreshStatus();
    setBusy(false);
  }

  async function handleLoadLocalAdapter() {
    if (!baseLoaded) {
      pushSystem("Load the base model before loading an adapter.");
      return;
    }
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Select a LoRA adapter directory",
    });
    if (!picked || typeof picked !== "string") return;
    const name = picked.split("/").filter(Boolean).pop() ?? "adapter";
    setBusy(true);
    const res = await sidecar.loadAdapter(name, picked);
    if (res.type === "error") {
      pushSystem(
        res.error.code === "BASE_MISMATCH"
          ? `Adapter not compatible with the loaded base (${res.error.message}).`
          : `Error loading adapter: ${res.error.message}`,
      );
    } else {
      pushSystem(`Loaded adapter "${name}".`);
      await refreshStatus();
      setStatus((s) => (s ? { ...s, active_adapter: name } : s));
    }
    setBusy(false);
  }

  async function handleInstallAdapter(adapter: StoreAdapter) {
    if (!baseLoaded) {
      setView("chat");
      pushSystem("Load the base model first.");
      return;
    }
    if (status?.adapters.some((a) => a.name === adapter.slug)) {
      setView("chat");
      pushSystem(`"${adapter.slug}" is already installed.`);
      return;
    }
    setBusy(true);
    setView("chat");
    const progressId = crypto.randomUUID();
    patchActiveChat((c) => ({
      ...c,
      messages: [
        ...c.messages,
        {
          id: progressId,
          role: "system",
          text: `Installing "${adapter.name}"…`,
          progress: { desc: "fetching", percent: 0, n: 0, total: 0 },
        },
      ],
    }));

    try {
      const detail = await store.fetchAdapter(adapter.slug);
      const version = detail.versions[0];
      if (!version) throw new Error("no published version for this adapter");
      const files = version.files.map((f) => ({
        name: f.name,
        url: store.absolutize(f.path),
      }));

      const channel = new Channel<{ type: string; [k: string]: unknown }>();
      channel.onmessage = (ev) => {
        if (ev.type === "file") {
          const bytes = Number(ev.bytes ?? 0);
          const total = Number(ev.total ?? 0);
          const percent = total ? Math.round((bytes / total) * 100) : 0;
          patchActiveChat((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === progressId
                ? {
                    ...m,
                    text: `Downloading ${ev.name} ${formatBytes(bytes)}${
                      total ? ` / ${formatBytes(total)}` : ""
                    }`,
                    progress: {
                      desc: String(ev.name),
                      percent,
                      n: bytes,
                      total,
                    },
                  }
                : m,
            ),
          }));
        }
      };

      const installedDir = (await invoke("download_adapter", {
        slug: adapter.slug,
        files,
        onEvent: channel,
      })) as string;

      const ld = await sidecar.loadAdapter(adapter.slug, installedDir);
      if (ld.type === "error") {
        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === progressId
              ? { ...m, text: `Install failed: ${ld.error.message}`, progress: null }
              : m,
          ),
        }));
        return;
      }
      await refreshStatus();
      setStatus((s) => (s ? { ...s, active_adapter: adapter.slug } : s));
      void store.markInstalled(adapter.slug);
      patchActiveChat((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === progressId
            ? {
                ...m,
                text: `Installed "${adapter.name}" — active.`,
                progress: null,
              }
            : m,
        ),
      }));
    } catch (e) {
      patchActiveChat((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === progressId
            ? { ...m, text: `Install error: ${String(e)}`, progress: null }
            : m,
        ),
      }));
    }
    setBusy(false);
  }

  async function handleCreateTestAdapters() {
    if (!baseLoaded) {
      pushSystem("Load the base model before creating test adapters.");
      return;
    }
    setBusy(true);
    try {
      const root = (await invoke("app_adapters_dir")) as string;
      const samples = [
        { name: "test-alpha", seed: 1 },
        { name: "test-beta", seed: 2 },
      ];
      for (const s of samples) {
        const outDir = `${root}/${s.name}`;
        const mk = await sidecar.makeTestAdapter(outDir, s.seed);
        if (mk.type === "error") {
          pushSystem(`make_test_adapter failed: ${mk.error.message}`);
          continue;
        }
        const ld = await sidecar.loadAdapter(s.name, outDir);
        if (ld.type === "error") {
          pushSystem(`load_adapter ${s.name} failed: ${ld.error.message}`);
        }
      }
      pushSystem("Test adapters created and loaded.");
      await refreshStatus();
      setStatus((s) => (s ? { ...s, active_adapter: "test-alpha" } : s));
    } catch (e) {
      pushSystem(`Error: ${String(e)}`);
    }
    setBusy(false);
  }

  async function handleSend() {
    const prompt = input.trim();
    if (!prompt || busy) return;
    if (!baseLoaded) {
      pushSystem("Load the base model first.");
      return;
    }
    setInput("");
    setBusy(true);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: prompt,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      text: "",
      adapter: status?.active_adapter ?? null,
      pending: true,
    };
    patchActiveChat((c) => ({
      ...c,
      title: c.title || prompt.slice(0, 48),
      messages: [...c.messages, userMsg, assistantMsg],
    }));

    const history: sidecar.ChatMessage[] = activeChat.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.text.trim().length > 0)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));

    const res = await sidecar.generate(prompt, {
      adapter: status?.active_adapter ?? undefined,
      messages: history,
      onToken: (text) => {
        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantId ? { ...m, text: m.text + text } : m,
          ),
        }));
      },
    });

    patchActiveChat((c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== assistantId) return m;
        if (res.type === "error") {
          return { ...m, text: `[error: ${res.error.message}]`, pending: false };
        }
        return { ...m, pending: false };
      }),
    }));
    setBusy(false);
  }

  async function handleRegenerate(assistantId: string) {
    if (busy) return;
    if (!baseLoaded) {
      pushSystem("Load the base model first.");
      return;
    }
    const idx = activeChat.messages.findIndex((m) => m.id === assistantId);
    if (idx === -1) return;
    // Find the most recent user message before this assistant turn.
    let userIdx = idx - 1;
    while (userIdx >= 0 && activeChat.messages[userIdx].role !== "user") {
      userIdx -= 1;
    }
    if (userIdx < 0) return;
    const userPrompt = activeChat.messages[userIdx].text;

    // Truncate everything from the user message onward and re-add a fresh
    // user + pending assistant.
    const newAssistantId = crypto.randomUUID();
    const beforeUser = activeChat.messages.slice(0, userIdx);
    patchActiveChat((c) => ({
      ...c,
      messages: [
        ...beforeUser,
        { ...activeChat.messages[userIdx] },
        {
          id: newAssistantId,
          role: "assistant",
          text: "",
          adapter: status?.active_adapter ?? null,
          pending: true,
        },
      ],
    }));

    const history: sidecar.ChatMessage[] = beforeUser
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.text.trim().length > 0)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));

    setBusy(true);
    const res = await sidecar.generate(userPrompt, {
      adapter: status?.active_adapter ?? undefined,
      messages: history,
      onToken: (text) => {
        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === newAssistantId ? { ...m, text: m.text + text } : m,
          ),
        }));
      },
    });

    patchActiveChat((c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== newAssistantId) return m;
        if (res.type === "error") {
          return { ...m, text: `[error: ${res.error.message}]`, pending: false };
        }
        return { ...m, pending: false };
      }),
    }));
    setBusy(false);
  }

  function pickAdapter(name: string | null) {
    setStatus((s) => (s ? { ...s, active_adapter: name } : s));
  }

  const sidebarConversations: Conversation[] = chats
    .filter((c) => c.messages.length > 0)
    .map((c) => ({ id: c.id, title: c.title }));

  const installedSlugs = new Set(status?.adapters.map((a) => a.name) ?? []);

  return (
    <div className="flex h-full bg-app-bg text-app-text">
      <Sidebar
        conversations={sidebarConversations}
        activeId={activeChatId}
        onSelect={(id) => {
          setActiveChatId(id);
          setView("chat");
        }}
        onNewChat={() => {
          newChat();
          setView("chat");
        }}
        onOpenStore={() => setView("store")}
        activeView={view}
        userName={USER_NAME}
      />

      <main className="flex flex-1 flex-col">
        {statusError && (
          <div className="border-b border-app-border bg-app-surface px-4 py-2 text-xs text-app-accent">
            sidecar: {statusError}
          </div>
        )}

        {view === "store" ? (
          <StoreView
            baseSha={status?.base_sha ?? null}
            baseLabel={baseLabel}
            installedSlugs={installedSlugs}
            busy={busy}
            onInstall={handleInstallAdapter}
            onBack={() => setView("chat")}
          />
        ) : isWelcome ? (
          <WelcomeScreen
            input={input}
            onInputChange={setInput}
            onSubmit={handleSend}
            disabled={busy}
            baseLabel={baseLabel}
            baseId={activeBase?.base_id ?? null}
            bases={bases}
            onPickBase={(id) => {
              const b = bases.find((x) => x.base_id === id);
              if (b) handleLoadBase(b);
            }}
            adapters={status?.adapters ?? []}
            adapter={status?.active_adapter ?? null}
            onPickAdapter={pickAdapter}
            chips={defaultChips({
              baseLoaded,
              adaptersInstalled: status?.adapters.length ?? 0,
              bases,
              onLoadBase: (baseId) => {
                const b = bases.find((x) => x.base_id === baseId);
                if (b) handleLoadBase(b);
              },
              onOpenStore: () => setView("store"),
              onLoadLocalAdapter: handleLoadLocalAdapter,
              onCreateTestAdapters: handleCreateTestAdapters,
            })}
          />
        ) : (
          <ChatView
            messages={messages}
            input={input}
            onInputChange={setInput}
            onSubmit={handleSend}
            busy={busy}
            scrollRef={scrollRef}
            baseLabel={baseLabel}
            baseLoaded={baseLoaded}
            baseId={activeBase?.base_id ?? null}
            bases={bases}
            onPickBase={(id) => {
              const b = bases.find((x) => x.base_id === id);
              if (b) handleLoadBase(b);
            }}
            adapters={status?.adapters ?? []}
            adapter={status?.active_adapter ?? null}
            onPickAdapter={pickAdapter}
            onRegenerate={handleRegenerate}
          />
        )}
      </main>
    </div>
  );
}

function WelcomeScreen({
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
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-8 flex items-center justify-center gap-3 text-5xl tracking-tight">
          <Logo className="h-9 w-9 text-app-accent" />
          <span style={{ fontFamily: "var(--font-serif)" }}>LoRA Hub</span>
        </h1>
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
        />
        <QuickChips chips={chips} />
      </div>
    </div>
  );
}

function ChatView({
  messages,
  input,
  onInputChange,
  onSubmit,
  busy,
  scrollRef,
  baseLabel,
  baseLoaded,
  adapters,
  adapter,
  onPickAdapter,
  bases,
  baseId,
  onPickBase,
  onRegenerate,
}: {
  messages: Message[];
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  baseLabel: string;
  baseLoaded: boolean;
  adapters: { name: string }[];
  adapter: string | null;
  onPickAdapter: (n: string | null) => void;
  bases: StoreBase[];
  baseId: string | null;
  onPickBase: (baseId: string) => void;
  onRegenerate: (assistantId: string) => void;
}) {
  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && !messages[i].pending) {
        return messages[i].id;
      }
    }
    return null;
  })();

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              canRegenerate={m.id === lastAssistantId && !busy}
              onRegenerate={() => onRegenerate(m.id)}
            />
          ))}
        </div>
      </div>
      <div className="border-t border-app-border bg-app-bg px-6 py-4">
        <Composer
          value={input}
          onChange={onInputChange}
          onSubmit={onSubmit}
          disabled={busy || !baseLoaded}
          placeholder={baseLoaded ? "Reply…" : "Load the base model first"}
          baseLabel={baseLabel}
          baseId={baseId}
          bases={bases}
          onPickBase={onPickBase}
          adapters={adapters}
          adapterLabel={adapter}
          onPickAdapter={onPickAdapter}
        />
      </div>
    </>
  );
}

function MessageBubble({
  message,
  canRegenerate,
  onRegenerate,
}: {
  message: Message;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
}) {
  if (message.role === "system") {
    return (
      <div className="w-full self-center">
        <div
          className={`mx-auto flex max-w-lg flex-col gap-2 rounded-md bg-app-surface px-4 py-2 text-xs text-app-text-muted`}
        >
          <div>{message.text}</div>
          {message.progress && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-app-border">
              <div
                className="h-full bg-app-accent transition-[width] duration-200"
                style={{ width: `${Math.min(100, message.progress.percent)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }
  const isUser = message.role === "user";
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-app-surface text-app-text"
            : "text-app-text"
        }`}
      >
        {message.adapter && !isUser && (
          <div className="mb-1 text-[10px] uppercase tracking-wide text-app-text-faint">
            {message.adapter}
          </div>
        )}
        {message.text || (message.pending ? "…" : "")}
      </div>
      {!isUser && canRegenerate && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-app-text-faint hover:bg-app-surface-hover hover:text-app-text"
          title="Regenerate response"
        >
          <RefreshCw size={12} />
          Regenerate
        </button>
      )}
    </div>
  );
}

function emptyChat(): Chat {
  return { id: crypto.randomUUID(), title: "", messages: [] };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default App;
