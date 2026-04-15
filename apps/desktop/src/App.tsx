import { useEffect, useRef, useState } from "react";
import * as sidecar from "./lib/sidecar";

const DEFAULT_BASE = "mlx-community/gemma-3-4b-it-4bit";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  adapter?: string | null;
  pending?: boolean;
};

type Status = {
  base_model_id: string | null;
  base_sha: string | null;
  active_adapter: string | null;
  adapters: { name: string; path: string; base_sha: string | null }[];
};

function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "boot",
      role: "system",
      text: "Welcome. Load the base model to start chatting.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  async function handleLoadBase() {
    setBusy(true);
    pushSystem(`Loading ${DEFAULT_BASE}…`);
    const res = await sidecar.loadBase(DEFAULT_BASE);
    if (res.type === "error") {
      pushSystem(`Error: ${res.error.message}`);
    } else {
      const r = res.result as { base_sha: string; cached: boolean };
      pushSystem(
        `Base ready (sha ${r.base_sha.slice(0, 12)}…${r.cached ? ", cached" : ""})`,
      );
    }
    await refreshStatus();
    setBusy(false);
  }

  async function handleSend() {
    const prompt = input.trim();
    if (!prompt || busy) return;
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
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const res = await sidecar.generate(prompt, {
      adapter: status?.active_adapter ?? undefined,
      onToken: (text) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: m.text + text } : m,
          ),
        );
      },
    });

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m;
        if (res.type === "error") {
          return { ...m, text: `[error: ${res.error.message}]`, pending: false };
        }
        return { ...m, pending: false };
      }),
    );
    setBusy(false);
  }

  function pushSystem(text: string) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "system", text },
    ]);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const baseLoaded = !!status?.base_model_id;

  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="text-base font-semibold">LoRA Hub</div>
          <div className="text-xs text-zinc-500">
            {status?.base_model_id ?? "no base loaded"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={status?.active_adapter ?? ""}
            disabled={!baseLoaded || (status?.adapters.length ?? 0) === 0}
            onChange={(e) => {
              setStatus((s) =>
                s ? { ...s, active_adapter: e.target.value || null } : s,
              );
            }}
          >
            <option value="">no adapter</option>
            {status?.adapters.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          {!baseLoaded && (
            <button
              className="rounded-md bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              disabled={busy}
              onClick={handleLoadBase}
            >
              {busy ? "Loading…" : "Load base"}
            </button>
          )}
        </div>
      </header>

      {statusError && (
        <div className="bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          sidecar: {statusError}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
      </div>

      <form
        className="border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500"
            rows={1}
            placeholder={
              baseLoaded ? "Message…" : "Load the base model to start"
            }
            value={input}
            disabled={!baseLoaded || busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            disabled={!baseLoaded || busy || input.trim() === ""}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="self-center rounded-md bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        {message.text}
      </div>
    );
  }
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-white text-zinc-900 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800"
        }`}
      >
        {message.adapter && !isUser && (
          <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            {message.adapter}
          </div>
        )}
        {message.text || (message.pending ? "…" : "")}
      </div>
    </div>
  );
}

export default App;
