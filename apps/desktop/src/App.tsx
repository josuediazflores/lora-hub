import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Logo } from "./components/Logo";
import { Sidebar, type Conversation } from "./components/Sidebar";
import { Composer } from "./components/Composer";
import { QuickChips, defaultChips } from "./components/QuickChips";
import * as sidecar from "./lib/sidecar";

const DEFAULT_BASE = "mlx-community/gemma-3-4b-it-4bit";
const BASE_LABEL = "Gemma 3 4B";
const USER_NAME = "Josue Diaz Flores";

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

function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [chats, setChats] = useState<Chat[]>([emptyChat()]);
  const [activeChatId, setActiveChatId] = useState<string>(chats[0].id);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeChat = chats.find((c) => c.id === activeChatId)!;
  const messages = activeChat.messages;
  const baseLoaded = !!status?.base_model_id;
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
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

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

  async function handleLoadBase() {
    setBusy(true);
    const progressId = crypto.randomUUID();
    patchActiveChat((c) => ({
      ...c,
      messages: [
        ...c.messages,
        {
          id: progressId,
          role: "system",
          text: `Loading ${BASE_LABEL}…`,
          progress: { desc: "preparing", percent: 0, n: 0, total: 0 },
        },
      ],
    }));

    const res = await sidecar.loadBase(DEFAULT_BASE, {
      onProgress: (p) => {
        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === progressId
              ? {
                  ...m,
                  text: p.total
                    ? `${BASE_LABEL} — ${p.desc || "downloading"} ${p.n ?? 0}/${p.total} (${p.percent ?? 0}%)`
                    : `${BASE_LABEL} — ${p.desc || "preparing"}`,
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
                text: `${BASE_LABEL} ready (${r.base_sha.slice(0, 8)}…${r.cached ? ", cached" : ""})`,
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

    const res = await sidecar.generate(prompt, {
      adapter: status?.active_adapter ?? undefined,
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

  function pickAdapter(name: string | null) {
    setStatus((s) => (s ? { ...s, active_adapter: name } : s));
  }

  const sidebarConversations: Conversation[] = chats
    .filter((c) => c.messages.length > 0)
    .map((c) => ({ id: c.id, title: c.title }));

  return (
    <div className="flex h-full bg-app-bg text-app-text">
      <Sidebar
        conversations={sidebarConversations}
        activeId={activeChatId}
        onSelect={setActiveChatId}
        onNewChat={newChat}
        userName={USER_NAME}
      />

      <main className="flex flex-1 flex-col">
        {statusError && (
          <div className="border-b border-app-border bg-app-surface px-4 py-2 text-xs text-app-accent">
            sidecar: {statusError}
          </div>
        )}

        {isWelcome ? (
          <WelcomeScreen
            input={input}
            onInputChange={setInput}
            onSubmit={handleSend}
            disabled={busy}
            baseLabel={BASE_LABEL}
            adapters={status?.adapters ?? []}
            adapter={status?.active_adapter ?? null}
            onPickAdapter={pickAdapter}
            chips={defaultChips({
              baseLoaded,
              adaptersInstalled: status?.adapters.length ?? 0,
              onLoadBase: handleLoadBase,
              onOpenStore: () => pushSystem("Store is coming soon."),
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
            baseLabel={BASE_LABEL}
            baseLoaded={baseLoaded}
            adapters={status?.adapters ?? []}
            adapter={status?.active_adapter ?? null}
            onPickAdapter={pickAdapter}
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
}) {
  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
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
          adapters={adapters}
          adapterLabel={adapter}
          onPickAdapter={onPickAdapter}
        />
      </div>
    </>
  );
}

function MessageBubble({ message }: { message: Message }) {
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
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
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
    </div>
  );
}

function emptyChat(): Chat {
  return { id: crypto.randomUUID(), title: "", messages: [] };
}

export default App;
