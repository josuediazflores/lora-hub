import { useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { RefreshCw, Square } from "lucide-react";
import { Markdown } from "./components/Markdown";
import {
  SettingsPage,
  loadSettings,
  saveSettings,
  type Settings,
} from "./components/SettingsPanel";
import { Sidebar, type Conversation, type SidebarView } from "./components/Sidebar";
import { AttachmentCard } from "./components/AttachmentCard";
import { Composer } from "./components/Composer";
import { QuickChips, defaultChips } from "./components/QuickChips";
import { StoreLanding } from "./components/StoreLanding";
import { StoreBrowse } from "./components/StoreBrowse";
import { AdapterSpecSheet } from "./components/AdapterSpecSheet";
import type { UseCase } from "./lib/editorial-data";
import { ModelsView } from "./components/ModelsView";
import { AdaptersView } from "./components/AdaptersView";
import { ConfirmModal } from "./components/ConfirmModal";
import { Gemma4Tile } from "./components/Gemma4Tile";
import { FeaturedAdapters } from "./components/FeaturedAdapters";
import { ActiveAdapterStrip } from "./components/ActiveAdapterStrip";
import { WorkspaceFooter } from "./components/WorkspaceFooter";
import { ToolCallBubble, type ToolCallMessage } from "./components/ToolCallBubble";
import { TurnRow, SwapMarker, GutterBtn } from "./components/TurnRow";
import { ThoughtDisclosure } from "./components/ThoughtDisclosure";
import { parseThinking } from "./lib/thinking";
import { adapterAccent } from "./lib/adapter-accent";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import {
  listMemories,
  saveMemory,
  deleteMemory,
  type Memory,
  type MemoryInput,
} from "./lib/memory";
import {
  readAttachment,
  formatAttachmentsForPrompt,
  type Attachment,
} from "./lib/attachments";
import {
  CommandPalette,
  PaletteIcons,
  type PaletteAction,
  type PaletteChat,
} from "./components/CommandPalette";
import {
  getPreset,
  getWorkspace,
  setPreset,
  setWorkspace as saveWorkspaceRoot,
  workspaceWarning,
  type Preset,
  type Workspace,
} from "./lib/workspace";
import * as sidecar from "./lib/sidecar";
import * as store from "./lib/store";
import { TOOL_DEFS, runTool } from "./lib/tools";
import type { StoreAdapter, StoreBase } from "./lib/store";

const USER_NAME = "Josue Diaz Flores";

// Every mlx-community Gemma 4 instruct variant across the four sizes
// (E2B, E4B, 26B-A4B, 31B) and every quant mlx-community publishes:
// 4bit, 5bit, 6bit, 8bit, mxfp4, mxfp8, bf16. nvfp4 is intentionally
// skipped — it's an NVIDIA FP4 format and can't run on MLX/Apple
// Silicon. Ordered by family size first, then by quant (smallest →
// largest). `base_sha` is the content fingerprint computed by the
// sidecar on first load; we leave it empty here and let the sidecar
// fill it in on load — only adapter-compatibility checks consult it,
// and they compare against the adapter's declared sha, not this list.
const FALLBACK_BASES: StoreBase[] = [
  // ── E2B (~2B effective) ──────────────────────────────────────────
  {
    base_id: "gemma-4-e2b-it-4bit",
    name: "Gemma 4 E2B Instruct (4-bit)",
    family: "gemma",
    parameters: "E2B",
    quant: "4bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e2b-it-4bit",
    size_bytes: 3_610_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e2b-it-5bit",
    name: "Gemma 4 E2B Instruct (5-bit)",
    family: "gemma",
    parameters: "E2B",
    quant: "5bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e2b-it-5bit",
    size_bytes: 4_190_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e2b-it-mxfp4",
    name: "Gemma 4 E2B Instruct (mxfp4)",
    family: "gemma",
    parameters: "E2B",
    quant: "mxfp4",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e2b-it-mxfp4",
    size_bytes: 4_300_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e2b-it-6bit",
    name: "Gemma 4 E2B Instruct (6-bit)",
    family: "gemma",
    parameters: "E2B",
    quant: "6bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e2b-it-6bit",
    size_bytes: 4_770_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e2b-it-mxfp8",
    name: "Gemma 4 E2B Instruct (mxfp8)",
    family: "gemma",
    parameters: "E2B",
    quant: "mxfp8",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e2b-it-mxfp8",
    size_bytes: 5_790_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e2b-it-8bit",
    name: "Gemma 4 E2B Instruct (8-bit)",
    family: "gemma",
    parameters: "E2B",
    quant: "8bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e2b-it-8bit",
    size_bytes: 5_930_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e2b-it-bf16",
    name: "Gemma 4 E2B Instruct (bf16)",
    family: "gemma",
    parameters: "E2B",
    quant: "bf16",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e2b-it-bf16",
    size_bytes: 10_280_000_000,
    license: "Gemma Terms",
    description: "",
  },
  // ── E4B (~4B effective) ──────────────────────────────────────────
  {
    base_id: "gemma-4-e4b-it-4bit",
    name: "Gemma 4 E4B Instruct (4-bit)",
    family: "gemma",
    parameters: "E4B",
    quant: "4bit",
    base_sha: "769bec7273285355f6ba44a974df0e223fa7db7e3267e86b3e032ff006f792bc",
    hf_repo: "mlx-community/gemma-4-e4b-it-4bit",
    size_bytes: 5_250_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e4b-it-5bit",
    name: "Gemma 4 E4B Instruct (5-bit)",
    family: "gemma",
    parameters: "E4B",
    quant: "5bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e4b-it-5bit",
    size_bytes: 6_190_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e4b-it-mxfp4",
    name: "Gemma 4 E4B Instruct (mxfp4)",
    family: "gemma",
    parameters: "E4B",
    quant: "mxfp4",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e4b-it-mxfp4",
    size_bytes: 6_770_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e4b-it-6bit",
    name: "Gemma 4 E4B Instruct (6-bit)",
    family: "gemma",
    parameters: "E4B",
    quant: "6bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e4b-it-6bit",
    size_bytes: 7_120_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e4b-it-mxfp8",
    name: "Gemma 4 E4B Instruct (mxfp8)",
    family: "gemma",
    parameters: "E4B",
    quant: "mxfp8",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e4b-it-mxfp8",
    size_bytes: 8_760_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e4b-it-8bit",
    name: "Gemma 4 E4B Instruct (8-bit)",
    family: "gemma",
    parameters: "E4B",
    quant: "8bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e4b-it-8bit",
    size_bytes: 9_000_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-e4b-it-bf16",
    name: "Gemma 4 E4B Instruct (bf16)",
    family: "gemma",
    parameters: "E4B",
    quant: "bf16",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-e4b-it-bf16",
    size_bytes: 16_020_000_000,
    license: "Gemma Terms",
    description: "",
  },
  // ── 26B-A4B (26B total, ~4B active; MoE) ─────────────────────────
  {
    base_id: "gemma-4-26b-a4b-it-mxfp4",
    name: "Gemma 4 26B-A4B Instruct (mxfp4)",
    family: "gemma",
    parameters: "26B-A4B",
    quant: "mxfp4",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-26b-a4b-it-mxfp4",
    size_bytes: 29_420_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-26b-a4b-it-8bit",
    name: "Gemma 4 26B-A4B Instruct (8-bit)",
    family: "gemma",
    parameters: "26B-A4B",
    quant: "8bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-26b-a4b-it-8bit",
    size_bytes: 27_990_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-26b-a4b-it-4bit",
    name: "Gemma 4 26B-A4B Instruct (4-bit)",
    family: "gemma",
    parameters: "26B-A4B",
    quant: "4bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-26b-a4b-it-4bit",
    size_bytes: 30_980_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-26b-a4b-it-5bit",
    name: "Gemma 4 26B-A4B Instruct (5-bit)",
    family: "gemma",
    parameters: "26B-A4B",
    quant: "5bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-26b-a4b-it-5bit",
    size_bytes: 37_220_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-26b-a4b-it-6bit",
    name: "Gemma 4 26B-A4B Instruct (6-bit)",
    family: "gemma",
    parameters: "26B-A4B",
    quant: "6bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-26b-a4b-it-6bit",
    size_bytes: 43_460_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-26b-a4b-it-bf16",
    name: "Gemma 4 26B-A4B Instruct (bf16)",
    family: "gemma",
    parameters: "26B-A4B",
    quant: "bf16",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-26b-a4b-it-bf16",
    size_bytes: 51_640_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-26b-a4b-it-mxfp8",
    name: "Gemma 4 26B-A4B Instruct (mxfp8)",
    family: "gemma",
    parameters: "26B-A4B",
    quant: "mxfp8",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-26b-a4b-it-mxfp8",
    size_bytes: 53_860_000_000,
    license: "Gemma Terms",
    description: "",
  },
  // ── 31B (dense) ──────────────────────────────────────────────────
  {
    base_id: "gemma-4-31b-it-mxfp4",
    name: "Gemma 4 31B Instruct (mxfp4)",
    family: "gemma",
    parameters: "31B",
    quant: "mxfp4",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-31b-it-mxfp4",
    size_bytes: 17_480_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-31b-it-5bit",
    name: "Gemma 4 31B Instruct (5-bit)",
    family: "gemma",
    parameters: "31B",
    quant: "5bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-31b-it-5bit",
    size_bytes: 22_280_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-31b-it-6bit",
    name: "Gemma 4 31B Instruct (6-bit)",
    family: "gemma",
    parameters: "31B",
    quant: "6bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-31b-it-6bit",
    size_bytes: 26_120_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-31b-it-mxfp8",
    name: "Gemma 4 31B Instruct (mxfp8)",
    family: "gemma",
    parameters: "31B",
    quant: "mxfp8",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-31b-it-mxfp8",
    size_bytes: 32_840_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-31b-it-8bit",
    name: "Gemma 4 31B Instruct (8-bit)",
    family: "gemma",
    parameters: "31B",
    quant: "8bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-31b-it-8bit",
    size_bytes: 33_800_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-31b-it-4bit",
    name: "Gemma 4 31B Instruct (4-bit)",
    family: "gemma",
    parameters: "31B",
    quant: "4bit",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-31b-it-4bit",
    size_bytes: 36_860_000_000,
    license: "Gemma Terms",
    description: "",
  },
  {
    base_id: "gemma-4-31b-it-bf16",
    name: "Gemma 4 31B Instruct (bf16)",
    family: "gemma",
    parameters: "31B",
    quant: "bf16",
    base_sha: "",
    hf_repo: "mlx-community/gemma-4-31b-it-bf16",
    size_bytes: 62_580_000_000,
    license: "Gemma Terms",
    description: "",
  },
];

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  /** Files the user attached to this turn. User messages only. Rendered
   * as cards next to the text bubble; the extracted bodies are folded
   * into the prompt the model sees via buildHistory, so the stored
   * `text` stays clean (just what the user typed). */
  attachments?: Attachment[];
  adapter?: string | null;
  pending?: boolean;
  progress?: { desc: string; percent: number; n: number; total: number } | null;
};

type ComparisonMessage = {
  id: string;
  role: "comparison";
  prompt: string;
  adapter: string;
  baseText: string;
  adapterText: string;
  /** Which half is currently streaming, or null once both are done. */
  pending: "base" | "adapter" | null;
};

/** Lightweight inline marker rendered when the model uses save_memory
 * during normal chat. Keeps the reading flow uninterrupted — no expandable
 * tool bubble, just a single-line pill that links back to Settings → Memory. */
type MemoryChipMessage = {
  id: string;
  role: "memory_chip";
  name: string;
  kind?: string | null;
  status: "saved" | "denied" | "error";
  detail?: string;
};

type AnyMessage = Message | ComparisonMessage | ToolCallMessage | MemoryChipMessage;

type Status = {
  base_model_id: string | null;
  base_sha: string | null;
  active_adapter: string | null;
  adapters: { name: string; path: string; base_sha: string | null }[];
};

type Chat = {
  id: string;
  title: string;
  messages: AnyMessage[];
  pinned?: boolean;
};

type View = SidebarView;

const STORAGE_KEY = "lora-hub:chats:v1";
const ACTIVE_KEY = "lora-hub:active-chat:v1";
const LAST_BASE_KEY = "lora-hub:last-base-id:v1";

type PersistedChat = { id: string; title: string; messages: AnyMessage[]; pinned?: boolean };

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
      pinned: !!c.pinned,
      messages: (c.messages ?? []).map((m) => cleanOnLoad(m)),
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
      pinned: c.pinned,
      messages: c.messages.map((m) => cleanOnLoad(m)),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // ignore quota errors etc.
  }
}

/** Strip transient fields on (re)load/persist without clobbering the
 * discriminated-union shape for comparison / tool_call messages. */
function cleanOnLoad(m: AnyMessage): AnyMessage {
  if (m.role === "comparison") {
    return { ...m, pending: null };
  }
  if (m.role === "memory_chip") {
    return m;
  }
  if (m.role === "tool_call") {
    // Trim big outputs on persist so localStorage doesn't balloon.
    const MAX = 2000;
    const output =
      m.output && m.output.length > MAX
        ? m.output.slice(0, MAX) + "\n…truncated for persistence…"
        : m.output;
    // A pending tool call from a prior session is dead — mark it denied so
    // the transcript makes sense after reload.
    const status = m.status === "pending" ? "denied" : m.status;
    return { ...m, output, status };
  }
  // Drop image `data_url`s from stored attachments — base64'd images are
  // the real bloat risk for localStorage. The card still renders from
  // name/kind/size and the extracted text survives for follow-up turns.
  const attachments = m.attachments?.map((a) => ({ ...a, data_url: undefined }));
  return { ...m, progress: null, pending: false, attachments };
}

/** Fold chat history into sidecar-ready turns. Comparison messages collapse
 * to their adapter output. Tool-call messages expand into a synthetic
 * assistant turn carrying the call marker followed by a synthetic user turn
 * carrying the tool result, so the model sees prior tool interactions on any
 * follow-up generate. A non-empty `systemPrompt` is prepended as a single
 * `system` role message; the sidecar routes it through the tokenizer's
 * chat template. */
function buildHistory(
  msgs: AnyMessage[],
  systemPrompt: string = "",
  memories: Memory[] = [],
): sidecar.ChatMessage[] {
  const out: sidecar.ChatMessage[] = [];
  const sys = buildSystemMessage(systemPrompt, memories);
  if (sys) out.push({ role: "system", content: sys });
  for (const m of msgs) {
    if (m.role === "comparison") {
      const content = m.adapterText.trim();
      if (content) out.push({ role: "assistant", content });
    } else if (m.role === "memory_chip") {
      // Memory chips are UI-only — the memory itself already lives in the
      // system message, and the tool exchange is folded into the assistant's
      // enclosing message. Nothing to emit here.
      continue;
    } else if (m.role === "tool_call") {
      out.push({
        role: "assistant",
        content: `<tool_call>${JSON.stringify({
          name: m.name,
          args: m.args,
        })}</tool_call>`,
      });
      const resultText =
        m.status === "success"
          ? (m.output ?? "")
          : (m.error ?? `[${m.status}]`);
      out.push({
        role: "user",
        content: `[tool result: ${m.name}${
          m.status !== "success" ? " " + m.status : ""
        }]\n${resultText}`,
      });
    } else if (m.role === "user" || m.role === "assistant") {
      // Re-assemble the user-visible text with any attachment bodies at
      // history-build time. Stored `text` stays clean for the transcript;
      // the model sees the full fenced-block formatting it was trained on.
      let content = m.text;
      if (m.role === "user" && m.attachments && m.attachments.length) {
        content = content + formatAttachmentsForPrompt(m.attachments);
      }
      content = content.trim();
      if (content) out.push({ role: m.role, content });
    }
  }
  return out;
}

/** Combines the user's static system prompt with a bulleted block of stored
 * memories. Memories are dropped from the tail until the combined message is
 * under the budget; individual memories are never silently truncated. */
const MEMORY_SYSTEM_BUDGET = 4_000;

/** Back-of-envelope token count. Proper tokenizers live in the sidecar,
 * but pinging it on every keystroke is wasteful. For a context-usage
 * chip, ~3.8 chars/token (English+code mix) is within ~10% of the
 * actual HF tokenizer output and is what matters for a "near the limit"
 * warning. */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

function estimateMessageTokens(messages: AnyMessage[]): number {
  let sum = 0;
  for (const m of messages) {
    if (m.role === "comparison") {
      sum += estimateTokens(m.adapterText) + estimateTokens(m.baseText) + 8;
    } else if (m.role === "tool_call") {
      sum +=
        estimateTokens(m.name) +
        estimateTokens(JSON.stringify(m.args)) +
        estimateTokens(m.output ?? "") +
        estimateTokens(m.error ?? "") +
        16;
    } else if (m.role === "memory_chip") {
      // Not included in prompt — see buildHistory.
      continue;
    } else {
      sum += estimateTokens(m.text) + 4; // + role overhead
      if (m.role === "user" && m.attachments) {
        // Attachment bodies are re-injected into the prompt at history
        // time; their text counts toward the context window even though
        // the stored `text` doesn't contain them.
        for (const a of m.attachments) {
          sum += estimateTokens(a.text ?? "") + 8;
        }
      }
    }
  }
  return sum;
}

/** Context window per base family. Numbers are conservative — we'd rather
 * warn at 6.5k when the real cap is 8k than miss a warning. Keyed by
 * substrings of `base_model_id` so we don't have to exhaustively list
 * every repo. */
function contextLimitFor(baseId: string | null | undefined): number {
  if (!baseId) return 8192;
  const id = baseId.toLowerCase();
  if (id.includes("gemma-4") || id.includes("gemma4")) return 8192;
  if (id.includes("gemma-3") || id.includes("gemma3")) return 8192;
  if (id.includes("llama-3") || id.includes("llama3")) return 8192;
  return 8192;
}

/** Short date/time anchor prepended to every system message. Gemma has no
 * internal clock — without this it resolves "tomorrow" / "this year" from
 * its training cutoff, which produces wrong answers for anything temporal. */
function currentDateContext(): string {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // ignore — some exotic runtimes don't expose this
  }
  return `Today is ${iso} (${weekday}). The user's local timezone is ${tz}. Use this as ground truth for any time-sensitive question — "tomorrow", "next week", "this year" — and when deciding whether to run a fresh web_search.`;
}

function buildSystemMessage(systemPrompt: string, memories: Memory[]): string {
  const prompt = systemPrompt.trim();
  const dateLine = currentDateContext();

  if (!memories.length) {
    return prompt ? `${prompt}\n\n${dateLine}` : dateLine;
  }

  // Greedy fit: include memories oldest-updated-first until the block would
  // overflow. Tail memories (newest) are the ones that get dropped — the
  // rationale is that a fresh, un-curated memory is more likely to be noise
  // than something you've had pinned for weeks.
  const lines = ["The user has recorded the following durable notes about themselves. Use them to personalize responses; don't repeat them back verbatim unless asked."];
  const baseBytes = (prompt ? prompt.length + 2 : 0) + dateLine.length + 2;
  let bytes = baseBytes + lines[0].length;
  const sortedOldestFirst = [...memories].sort((a, b) => a.updated_at - b.updated_at);
  for (const m of sortedOldestFirst) {
    const suffix = m.kind ? ` (${m.kind})` : "";
    const line = `- ${m.name}: ${m.content}${suffix}`;
    if (bytes + line.length + 1 > MEMORY_SYSTEM_BUDGET) break;
    lines.push(line);
    bytes += line.length + 1;
  }
  const memoryBlock = lines.join("\n");
  const parts = [prompt, dateLine, memoryBlock].filter((s) => s.length > 0);
  return parts.join("\n\n");
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [inflightGenId, setInflightGenId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("lora-hub:sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "lora-hub:sidebar-collapsed",
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [storeSubView, setStoreSubView] = useState<"landing" | "browse">("landing");
  const [browsePreset, setBrowsePreset] = useState<{ useCase?: UseCase } | null>(null);
  const [adapterDetailSlug, setAdapterDetailSlug] = useState<string | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pendingMemory, setPendingMemory] = useState<
    | {
        toolCallId: string;
        proposed: MemoryInput;
        source: string | null;
        resolve: (accepted: MemoryInput | null) => void;
      }
    | null
  >(null);
  const [pendingBase, setPendingBase] = useState<StoreBase | null>(null);
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [computerUseMode, setComputerUseMode] = useState<boolean>(false);
  const [permissionPreset, setPermissionPresetState] = useState<Preset>("read_only");
  const [workspace, setWorkspaceState] = useState<Workspace | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeChat = chats.find((c) => c.id === activeChatId)!;
  const messages = activeChat.messages;
  const baseLoaded = !!status?.base_model_id;
  const activeBase =
    bases.find((b) => b.hf_repo === status?.base_model_id) ?? null;
  const baseLabel = activeBase?.name ?? "no base";
  const isWelcome = messages.length === 0;

  // Back-of-envelope token tally for the upcoming turn. Includes the
  // history, the injected system block (prompt + date + memories), and the
  // text the user is currently typing. Output reservation (max_tokens)
  // isn't counted — it's what *remains* of the context budget.
  const tokenUsage = (() => {
    const systemBlock = buildSystemMessage(
      settings.systemPrompt,
      settings.useMemoryInContext ? memories : [],
    );
    const used =
      estimateTokens(systemBlock) +
      estimateMessageTokens(messages) +
      estimateTokens(input);
    return { used, limit: contextLimitFor(status?.base_model_id) };
  })();

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
    getPreset().then(setPermissionPresetState).catch(() => {});
    getWorkspace().then(setWorkspaceState).catch(() => {});
    listMemories().then(setMemories).catch(() => {});
  }, []);

  async function refreshMemories() {
    try {
      setMemories(await listMemories());
    } catch {
      // ignore — memory store absent is non-fatal
    }
  }

  async function handleMemoryToolCall(
    args: Record<string, unknown>,
    chatId: string,
  ): Promise<{ status: "success" | "error" | "denied"; output?: string; error?: string }> {
    const policy = settings.memoryWritePolicy;
    const proposed: MemoryInput = {
      name: String(args.name ?? "").slice(0, 80),
      content: String(args.content ?? ""),
      kind: (args.kind as string | undefined) ?? null,
    };
    if (policy === "off") {
      return { status: "denied", error: "memory writes are disabled in Settings" };
    }
    let approved: MemoryInput | null = proposed;
    if (policy === "ask") {
      approved = await new Promise<MemoryInput | null>((resolve) => {
        setPendingMemory({
          toolCallId: chatId,
          proposed,
          source: `agent:${chatId}`,
          resolve,
        });
      });
      if (!approved) {
        return { status: "denied", error: "user declined memory save" };
      }
    }
    try {
      const saved = await saveMemory({
        ...approved,
        source: `agent:${chatId}`,
      });
      return { status: "success", output: `saved memory "${saved.name}"` };
    } catch (e) {
      return { status: "error", error: String(e) };
    }
  }

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

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== "system") return;
    return watchSystemTheme(() => applyTheme(settings.theme));
  }, [settings.theme]);

  // Listen for files dragged onto the window. Tauri's native drag-drop
  // event fires with {type: "over"|"drop"|"leave", paths?}. For each
  // dropped path we call the Rust `read_attachment` command and append
  // the resulting payload to state — success and "unsupported" alike,
  // because the UI renders an error chip for the latter.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const mod = await import("@tauri-apps/api/webview");
        const webview = mod.getCurrentWebview();
        unlisten = await webview.onDragDropEvent(async (event) => {
          const kind = (event.payload as { type: string }).type;
          if (kind === "over") {
            setDragOver(true);
            return;
          }
          if (kind === "leave") {
            setDragOver(false);
            return;
          }
          if (kind === "drop") {
            setDragOver(false);
            const paths =
              (event.payload as { paths?: string[] }).paths ?? [];
            for (const p of paths) {
              try {
                const a = await readAttachment(p);
                setAttachments((prev) => [...prev, a]);
              } catch (e) {
                setAttachments((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    kind: "unsupported",
                    name: p.split("/").pop() ?? p,
                    size: 0,
                    mime: "",
                    reason: String(e),
                  },
                ]);
              }
            }
          }
        });
      } catch (e) {
        console.warn("drag-drop listener failed:", e);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  /** Open the OS file picker and funnel results through the same
   * read-attachment path as drag-drop, so every attachment — typed or
   * dropped — goes through one code path. */
  async function pickFiles() {
    try {
      const picked = await openDialog({ multiple: true });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      for (const p of paths) {
        try {
          const a = await readAttachment(p);
          setAttachments((prev) => [...prev, a]);
        } catch (e) {
          setAttachments((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              kind: "unsupported",
              name: p.split("/").pop() ?? p,
              size: 0,
              mime: "",
              reason: String(e),
            },
          ]);
        }
      }
    } catch (e) {
      pushSystem(`File picker failed: ${String(e)}`);
    }
  }

  // Global keyboard: Cmd+K (macOS) / Ctrl+K (cross-platform) toggles the
  // command palette. Allow it even when focused inside an input/textarea
  // so you never have to click out of the composer to switch chats.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // One-shot auto-load of the last-used base on app start when the user has
  // opted in. Guarded by a ref so toggling the setting mid-session doesn't
  // retrigger it; next launch picks up the new preference.
  const autoLoadAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoLoadAttemptedRef.current) return;
    if (!settings.autoLoadLastBase) return;
    if (!bases.length) return;
    if (status === null) return;
    if (status.base_model_id) {
      autoLoadAttemptedRef.current = true;
      return;
    }
    let lastBaseId: string | null = null;
    try {
      lastBaseId = localStorage.getItem(LAST_BASE_KEY);
    } catch {
      return;
    }
    if (!lastBaseId) {
      autoLoadAttemptedRef.current = true;
      return;
    }
    const target = bases.find((b) => b.base_id === lastBaseId);
    if (!target) {
      autoLoadAttemptedRef.current = true;
      return;
    }
    autoLoadAttemptedRef.current = true;
    void handleLoadBase(target);
  }, [bases, status, settings.autoLoadLastBase]);

  useEffect(() => {
    if (!status?.active_adapter && compareMode) setCompareMode(false);
  }, [status?.active_adapter, compareMode]);

  function toggleComputerUse() {
    setComputerUseMode((v) => {
      const next = !v;
      if (next) setCompareMode(false); // mutually exclusive
      return next;
    });
  }

  function toggleCompareMutex() {
    setCompareMode((v) => {
      const next = !v;
      if (next) setComputerUseMode(false); // mutually exclusive
      return next;
    });
  }

  async function handlePickPreset(p: Preset) {
    try {
      const saved = await setPreset(p);
      setPermissionPresetState(saved);
    } catch (e) {
      pushSystem(`Failed to save preset: ${String(e)}`);
    }
  }

  async function handlePickWorkspace() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Pick a workspace folder",
    });
    if (!picked || typeof picked !== "string") return;
    const warn = workspaceWarning(picked);
    if (warn) pushSystem(`Workspace: ${warn}`);
    try {
      const saved = await saveWorkspaceRoot(picked);
      setWorkspaceState(saved);
    } catch (e) {
      pushSystem(`Failed to set workspace: ${String(e)}`);
    }
  }

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
    setView("chat");
  }

  function togglePin(id: string) {
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
    );
  }

  async function handleUnloadAdapter(name: string) {
    const res = await sidecar.unloadAdapter(name);
    if (res.type === "error") {
      pushSystem(`Unload failed: ${res.error.message}`);
      return;
    }
    await refreshStatus();
    setStatus((s) =>
      s && s.active_adapter === name ? { ...s, active_adapter: null } : s,
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const meta = isMac ? e.metaKey : e.ctrlKey;
      if (meta && e.key.toLowerCase() === "n" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        newChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function requestLoadBase(base: StoreBase) {
    const current = status?.base_model_id;
    const switching = !!current && current !== base.hf_repo;
    const hasAdapters = (status?.adapters.length ?? 0) > 0;
    if (switching && hasAdapters) {
      setPendingBase(base);
      return;
    }
    void handleLoadBase(base);
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
      try {
        localStorage.setItem(LAST_BASE_KEY, base.base_id);
      } catch {
        // quota / privacy modes — auto-load simply won't trigger next time
      }
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

  async function handleInstallAdapter(
    adapter: StoreAdapter,
    afterInstallPrompt?: string,
  ) {
    if (!baseLoaded) {
      setView("chat");
      pushSystem("Load the base model first.");
      return;
    }
    if (status?.adapters.some((a) => a.name === adapter.slug)) {
      setView("chat");
      setStatus((s) => (s ? { ...s, active_adapter: adapter.slug } : s));
      if (afterInstallPrompt) {
        await runNormalTurn(afterInstallPrompt, adapter.slug);
      } else {
        pushSystem(`"${adapter.slug}" is already installed — set active.`);
      }
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
      if (afterInstallPrompt) {
        setBusy(false);
        await runNormalTurn(afterInstallPrompt, adapter.slug);
        return;
      }
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

  async function handleTryAdapter(adapter: StoreAdapter) {
    const prompt = adapter.demo_prompt?.trim();
    if (!prompt) {
      pushSystem(`No demo prompt available for "${adapter.name}".`);
      return;
    }
    await handleInstallAdapter(adapter, prompt);
  }

  async function handleInstallAdapterBySlug(slug: string) {
    try {
      const detail = await store.fetchAdapter(slug);
      await handleInstallAdapter(detail.adapter);
    } catch (e) {
      pushSystem(`Failed to load adapter "${slug}": ${String(e)}`);
    }
  }

  async function handleTryAdapterBySlug(slug: string) {
    try {
      const detail = await store.fetchAdapter(slug);
      await handleTryAdapter(detail.adapter);
    } catch (e) {
      pushSystem(`Failed to load adapter "${slug}": ${String(e)}`);
    }
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
    const typed = input.trim();
    // Attachments alone are a valid send (e.g. "here's a file, read it").
    if (!typed && attachments.length === 0) return;
    if (busy) return;
    if (!baseLoaded) {
      pushSystem("Load the base model first.");
      return;
    }
    const currentAttachments = attachments;
    setAttachments([]);
    if (compareMode && status?.active_adapter) {
      return handleSendCompare(typed, status.active_adapter, currentAttachments);
    }
    if (computerUseMode) {
      return runAgentTurn(typed, currentAttachments);
    }
    setInput("");
    await runNormalTurn(typed, status?.active_adapter ?? null, currentAttachments);
  }

  async function runNormalTurn(
    userText: string,
    adapter: string | null,
    attachments: Attachment[] = [],
  ) {
    setBusy(true);

    // The user-visible turn (stored text) is just what they typed.
    // The prompt the model sees also carries each attachment as a
    // fenced code block so it can reason over the file bodies.
    const promptForModel =
      userText + formatAttachmentsForPrompt(attachments);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: userText,
      attachments: attachments.length ? attachments : undefined,
    };
    patchActiveChat((c) => ({
      ...c,
      title: c.title || (userText || attachments[0]?.name || "").slice(0, 48),
      messages: [...c.messages, userMsg],
    }));

    // Normal chat can optionally expose a tightly-scoped tool set: save_memory
    // (renders as a chip) and/or the web tools fetch_page + web_search
    // (render as standard tool bubbles). Filesystem and shell tools remain
    // Computer-Use-only because they need a workspace pick.
    const memoryToolEnabled =
      settings.memoryInNormalChat && settings.memoryWritePolicy !== "off";
    const webToolsEnabled = settings.webToolsInNormalChat;
    const allowedToolNames = new Set<string>();
    if (memoryToolEnabled) allowedToolNames.add("save_memory");
    if (webToolsEnabled) {
      allowedToolNames.add("fetch_page");
      allowedToolNames.add("web_search");
    }
    const toolDefs =
      allowedToolNames.size > 0
        ? TOOL_DEFS.filter((t) => allowedToolNames.has(t.name))
        : undefined;

    let history: sidecar.ChatMessage[] = buildHistory(
      activeChat.messages,
      settings.systemPrompt,
      settings.useMemoryInContext ? memories : [],
    );
    let currentPrompt = promptForModel;
    const MAX_STEPS = allowedToolNames.size > 0 ? 4 : 1;

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const assistantId = crypto.randomUUID();
        patchActiveChat((c) => ({
          ...c,
          messages: [
            ...c.messages,
            { id: assistantId, role: "assistant", text: "", adapter, pending: true },
          ],
        }));

        let assistantAccum = "";
        let toolCall: sidecar.SidecarToolCall | null = null;

        const handle = sidecar.generate(currentPrompt, {
          adapter: adapter ?? undefined,
          messages: history,
          temperature: settings.temperature,
          topP: settings.topP,
          maxTokens: settings.maxTokens,
          tools: toolDefs,
          onToken: (text) => {
            assistantAccum += text;
            patchActiveChat((c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantId && m.role === "assistant"
                  ? { ...m, text: m.text + text }
                  : m,
              ),
            }));
          },
          onToolCall: (call) => {
            toolCall = call;
          },
        });
        setInflightGenId(handle.id);
        const res = await handle.result;
        setInflightGenId(null);

        // Finalize the current assistant message.
        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== assistantId || m.role !== "assistant") return m;
            if (res.type === "error") {
              return { ...m, text: `[error: ${res.error.message}]`, pending: false };
            }
            const r = res.result as { aborted?: boolean };
            const suffix = r.aborted ? " ⏹" : "";
            return { ...m, text: m.text + suffix, pending: false };
          }),
        }));

        if (res.type === "error") break;
        if (!toolCall) break;

        const call: sidecar.SidecarToolCall = toolCall;
        if (!allowedToolNames.has(call.name)) {
          // Model asked for a tool we didn't offer — dead end in this mode.
          break;
        }

        let result: Awaited<ReturnType<typeof runTool>>;
        if (call.name === "save_memory") {
          // Memory save renders as a compact chip, gated by the user's policy.
          const mResult = await handleMemoryToolCall(call.args, activeChatId);
          const chip: MemoryChipMessage = {
            id: crypto.randomUUID(),
            role: "memory_chip",
            name: String(call.args.name ?? "memory"),
            kind: (call.args.kind as string | undefined) ?? null,
            status:
              mResult.status === "success"
                ? "saved"
                : mResult.status === "denied"
                  ? "denied"
                  : "error",
            detail: mResult.error ?? mResult.output ?? undefined,
          };
          patchActiveChat((c) => ({ ...c, messages: [...c.messages, chip] }));
          if (mResult.status === "success") refreshMemories();
          result = mResult;
        } else {
          // Web tools: render as a normal tool bubble so the user can see
          // what was searched or fetched.
          const tcId = crypto.randomUUID();
          const tcMsg: ToolCallMessage = {
            id: tcId,
            role: "tool_call",
            callId: call.call_id,
            name: call.name,
            args: call.args,
            status: "pending",
          };
          patchActiveChat((c) => ({ ...c, messages: [...c.messages, tcMsg] }));
          result = await runTool(call.name, call.args);
          patchActiveChat((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === tcId && m.role === "tool_call"
                ? {
                    ...m,
                    status: result.status,
                    output: result.output,
                    error: result.error,
                    truncated: result.truncated,
                  }
                : m,
            ),
          }));
        }

        // Feed the tool exchange back into the next iteration's context so
        // the model can wrap its reply around the result.
        const assistantContent =
          assistantAccum +
          `\n<tool_call>${JSON.stringify({ name: call.name, args: call.args })}</tool_call>`;
        history = [...history, { role: "assistant", content: assistantContent }];
        const resultBody =
          result.status === "success"
            ? (result.output ?? "")
            : (result.error ?? "unknown error");
        currentPrompt = `[tool result: ${call.name}${
          result.status !== "success" ? " " + result.status : ""
        }]\n${resultBody}`;
      }
    } finally {
      setBusy(false);
    }
  }

  async function runAgentTurn(
    userText: string,
    attachments: Attachment[] = [],
  ) {
    if (!workspace) {
      pushSystem(
        "Pick a workspace before running Computer Use — use the footer bar under the composer.",
      );
      return;
    }

    setInput("");
    setBusy(true);

    const promptForModel =
      userText + formatAttachmentsForPrompt(attachments);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: userText,
      attachments: attachments.length ? attachments : undefined,
    };
    patchActiveChat((c) => ({
      ...c,
      title: c.title || (userText || attachments[0]?.name || "").slice(0, 48),
      messages: [...c.messages, userMsg],
    }));

    let history: sidecar.ChatMessage[] = buildHistory(activeChat.messages, settings.systemPrompt, settings.useMemoryInContext ? memories : []);
    let currentPrompt = promptForModel;
    const adapter = status?.active_adapter ?? null;
    const MAX_STEPS = 8;
    let stopped: "ok" | "error" | "aborted" | "maxsteps" = "ok";

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const assistantId = crypto.randomUUID();
        patchActiveChat((c) => ({
          ...c,
          messages: [
            ...c.messages,
            {
              id: assistantId,
              role: "assistant",
              text: "",
              adapter,
              pending: true,
            },
          ],
        }));

        let assistantAccum = "";
        let toolCall: sidecar.SidecarToolCall | null = null;
        let toolProtoErr: string | null = null;

        const handle = sidecar.generate(currentPrompt, {
          adapter: adapter ?? undefined,
          messages: history,
          temperature: settings.temperature,
          topP: settings.topP,
          maxTokens: settings.maxTokens,
          tools: TOOL_DEFS,
          onToken: (text) => {
            assistantAccum += text;
            patchActiveChat((c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantId && m.role === "assistant"
                  ? { ...m, text: m.text + text }
                  : m,
              ),
            }));
          },
          onToolCall: (call) => {
            toolCall = call;
          },
          onToolError: (err) => {
            toolProtoErr = err.error;
          },
        });
        setInflightGenId(handle.id);
        const res = await handle.result;
        setInflightGenId(null);

        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== assistantId || m.role !== "assistant") return m;
            if (res.type === "error") {
              return {
                ...m,
                text: m.text + `\n[error: ${res.error.message}]`,
                pending: false,
              };
            }
            const r = res.result as { aborted?: boolean };
            return {
              ...m,
              text: m.text + (r.aborted ? " ⏹" : ""),
              pending: false,
            };
          }),
        }));

        if (res.type === "error") {
          stopped = "error";
          break;
        }
        const r = res.result as { aborted?: boolean };
        if (r.aborted) {
          stopped = "aborted";
          break;
        }

        // Tool-call protocol failure: feed the error back so the model can
        // self-correct, then continue the loop.
        if (toolProtoErr && !toolCall) {
          history.push({ role: "assistant", content: assistantAccum });
          currentPrompt = `[tool_error] ${toolProtoErr}\nReformat your tool call using the exact <tool_call>{...}</tool_call> format on a single line, or answer the user in plain text if no tool is needed.`;
          continue;
        }

        if (!toolCall) {
          // Clean end — model finished without asking for a tool.
          break;
        }

        // Tool call received: render the pending bubble, run the tool,
        // update the bubble with the result.
        // TS gets stuck narrowing `toolCall` inside callbacks; materialize.
        const call: sidecar.SidecarToolCall = toolCall;
        const tcId = crypto.randomUUID();
        const tcMsg: ToolCallMessage = {
          id: tcId,
          role: "tool_call",
          callId: call.call_id,
          name: call.name,
          args: call.args,
          status: "pending",
        };
        patchActiveChat((c) => ({ ...c, messages: [...c.messages, tcMsg] }));

        let result: Awaited<ReturnType<typeof runTool>>;
        if (call.name === "save_memory") {
          result = await handleMemoryToolCall(call.args, activeChatId);
        } else {
          result = await runTool(call.name, call.args);
        }
        if (call.name === "save_memory" && result.status === "success") {
          refreshMemories();
        }
        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === tcId && m.role === "tool_call"
              ? {
                  ...m,
                  status: result.status,
                  output: result.output,
                  error: result.error,
                  truncated: result.truncated,
                }
              : m,
          ),
        }));

        // Build the next iteration's history: the assistant's text +
        // its emitted tool call, followed by the tool result as the
        // next user prompt.
        const assistantContent =
          assistantAccum +
          `\n<tool_call>${JSON.stringify({
            name: call.name,
            args: call.args,
          })}</tool_call>`;
        history = [...history, { role: "assistant", content: assistantContent }];
        const resultBody =
          result.status === "success"
            ? (result.output ?? "")
            : (result.error ?? "unknown error");
        currentPrompt = `[tool result: ${call.name}${
          result.status !== "success" ? " " + result.status : ""
        }]\n${resultBody}`;
      }

      if (stopped === "ok") {
        // Hit the max-steps cap without a clean finish.
        if (history.length && currentPrompt.startsWith("[tool result:")) {
          stopped = "maxsteps";
        }
      }
      if (stopped === "maxsteps") {
        pushSystem(
          `Stopped after ${MAX_STEPS} tool steps. Send another message to continue.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCompare(
    userText: string,
    adapter: string,
    attachments: Attachment[] = [],
  ) {
    setInput("");
    setBusy(true);

    const promptForModel =
      userText + formatAttachmentsForPrompt(attachments);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: userText,
      attachments: attachments.length ? attachments : undefined,
    };
    const compareId = crypto.randomUUID();
    const compareMsg: ComparisonMessage = {
      id: compareId,
      role: "comparison",
      prompt: userText,
      adapter,
      baseText: "",
      adapterText: "",
      pending: "base",
    };
    patchActiveChat((c) => ({
      ...c,
      title: c.title || (userText || attachments[0]?.name || "").slice(0, 48),
      messages: [...c.messages, userMsg, compareMsg],
    }));

    const history: sidecar.ChatMessage[] = buildHistory(activeChat.messages, settings.systemPrompt, settings.useMemoryInContext ? memories : []);

    function patchCompare(
      update: (m: ComparisonMessage) => ComparisonMessage,
    ) {
      patchActiveChat((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === compareId && m.role === "comparison" ? update(m) : m,
        ),
      }));
    }

    const baseHandle = sidecar.generate(promptForModel, {
      baseOnly: true,
      messages: history,
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: settings.maxTokens,
      onToken: (text) =>
        patchCompare((m) => ({ ...m, baseText: m.baseText + text })),
    });
    setInflightGenId(baseHandle.id);
    const baseRes = await baseHandle.result;
    setInflightGenId(null);

    if (baseRes.type === "error") {
      patchCompare((m) => ({
        ...m,
        baseText: `${m.baseText}\n\n[error: ${baseRes.error.message}]`,
        pending: null,
      }));
      setBusy(false);
      return;
    }
    const baseAborted = (baseRes.result as { aborted?: boolean }).aborted;
    if (baseAborted) {
      patchCompare((m) => ({ ...m, baseText: m.baseText + " ⏹", pending: null }));
      setBusy(false);
      return;
    }

    patchCompare((m) => ({ ...m, pending: "adapter" }));

    const adapterHandle = sidecar.generate(promptForModel, {
      adapter,
      messages: history,
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: settings.maxTokens,
      onToken: (text) =>
        patchCompare((m) => ({ ...m, adapterText: m.adapterText + text })),
    });
    setInflightGenId(adapterHandle.id);
    const adapterRes = await adapterHandle.result;
    setInflightGenId(null);

    patchCompare((m) => {
      if (adapterRes.type === "error") {
        return {
          ...m,
          adapterText: `${m.adapterText}\n\n[error: ${adapterRes.error.message}]`,
          pending: null,
        };
      }
      const r = adapterRes.result as { aborted?: boolean };
      return {
        ...m,
        adapterText: m.adapterText + (r.aborted ? " ⏹" : ""),
        pending: null,
      };
    });
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
    const userMessage = activeChat.messages[userIdx];
    if (userMessage.role !== "user") return;
    const userPrompt =
      userMessage.text +
      formatAttachmentsForPrompt(userMessage.attachments ?? []);

    // Truncate everything from the user message onward and re-add a fresh
    // user + pending assistant.
    const newAssistantId = crypto.randomUUID();
    const beforeUser = activeChat.messages.slice(0, userIdx);
    patchActiveChat((c) => ({
      ...c,
      messages: [
        ...beforeUser,
        { ...userMessage },
        {
          id: newAssistantId,
          role: "assistant",
          text: "",
          adapter: status?.active_adapter ?? null,
          pending: true,
        },
      ],
    }));

    const history: sidecar.ChatMessage[] = buildHistory(beforeUser, settings.systemPrompt, settings.useMemoryInContext ? memories : []);

    setBusy(true);
    const handle = sidecar.generate(userPrompt, {
      adapter: status?.active_adapter ?? undefined,
      messages: history,
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: settings.maxTokens,
      onToken: (text) => {
        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === newAssistantId && m.role === "assistant"
              ? { ...m, text: m.text + text }
              : m,
          ),
        }));
      },
    });
    setInflightGenId(handle.id);
    const res = await handle.result;
    setInflightGenId(null);

    patchActiveChat((c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== newAssistantId || m.role !== "assistant") return m;
        if (res.type === "error") {
          return { ...m, text: `[error: ${res.error.message}]`, pending: false };
        }
        const r = res.result as { aborted?: boolean };
        const suffix = r.aborted ? " ⏹" : "";
        return { ...m, text: m.text + suffix, pending: false };
      }),
    }));
    setBusy(false);
  }

  async function handleStop() {
    if (!inflightGenId) return;
    await sidecar.abortGeneration(inflightGenId);
  }

  function pickAdapter(name: string | null) {
    setStatus((s) => (s ? { ...s, active_adapter: name } : s));
  }

  const sidebarConversations: Conversation[] = chats
    .filter((c) => c.messages.length > 0)
    .map((c) => ({ id: c.id, title: c.title, pinned: !!c.pinned }));

  const installedSlugs = new Set(status?.adapters.map((a) => a.name) ?? []);

  const paletteActions: PaletteAction[] = [
    {
      kind: "action",
      id: "new-chat",
      label: "New chat",
      hint: "start a fresh conversation",
      shortcut: "⌘N",
      icon: PaletteIcons.New,
      run: () => newChat(),
    },
    {
      kind: "action",
      id: "view-chat",
      label: "Open chat view",
      hint: "return to the active conversation",
      icon: PaletteIcons.New,
      run: () => setView("chat"),
    },
    {
      kind: "action",
      id: "view-models",
      label: "Models",
      hint: "browse & load base models",
      icon: PaletteIcons.Models,
      run: () => setView("models"),
    },
    {
      kind: "action",
      id: "view-adapters",
      label: "Adapters",
      hint: "installed LoRA adapters",
      icon: PaletteIcons.Adapters,
      run: () => setView("adapters"),
    },
    {
      kind: "action",
      id: "view-store",
      label: "Store",
      hint: "find new adapters",
      icon: PaletteIcons.Store,
      run: () => setView("store"),
    },
    {
      kind: "action",
      id: "view-settings",
      label: "Settings",
      hint: "preferences, memory, integrations",
      icon: PaletteIcons.Settings,
      run: () => setView("settings"),
    },
    {
      kind: "action",
      id: "pick-workspace",
      label: "Pick workspace…",
      hint: "set the folder the agent can read/write",
      icon: PaletteIcons.Workspace,
      run: () => handlePickWorkspace(),
    },
    {
      kind: "action",
      id: "toggle-compare",
      label: "Toggle compare mode",
      hint: "base vs adapter side-by-side",
      icon: PaletteIcons.Compare,
      run: () => toggleCompareMutex(),
    },
    {
      kind: "action",
      id: "toggle-agent",
      label: "Toggle Computer Use",
      hint: "grant full tool access for this turn",
      icon: PaletteIcons.Agent,
      run: () => toggleComputerUse(),
    },
  ];

  const paletteChats: PaletteChat[] = chats.map((c) => {
    // Most recent text-bearing message makes a cleaner preview than the
    // oldest one.
    const recent = [...c.messages]
      .reverse()
      .find((m) => m.role === "user" || m.role === "assistant") as
      | Message
      | undefined;
    const preview = (recent?.text ?? "").replace(/\s+/g, " ").slice(0, 120);
    return {
      kind: "chat",
      id: c.id,
      title: c.title || "untitled",
      preview,
      run: () => {
        setActiveChatId(c.id);
        setView("chat");
      },
    };
  });

  return (
    <div className="relative flex h-full bg-app-bg text-app-text">
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
        chats={paletteChats}
      />
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-app-bg/80 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-dashed border-app-accent px-8 py-6 text-center">
            <div className="font-serif text-[22px] text-app-text">Drop to attach</div>
            <div className="mt-1 font-mono text-[11px] text-app-text-muted">
              text · pdf · image
            </div>
          </div>
        </div>
      )}
      <Sidebar
        conversations={sidebarConversations}
        activeId={activeChatId}
        activeView={view}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        onSelect={(id) => {
          setActiveChatId(id);
          setView("chat");
        }}
        onNewChat={newChat}
        onOpenStore={() => setView("store")}
        onOpenModels={() => setView("models")}
        onOpenAdapters={() => setView("adapters")}
        onOpenSettings={() => setView("settings")}
        onTogglePin={togglePin}
        userName={USER_NAME}
      />

      <main className="flex flex-1 flex-col">
        {statusError && (
          <div className="border-b border-app-border bg-app-surface px-4 py-2 text-xs text-app-accent">
            sidecar: {statusError}
          </div>
        )}

        {view === "chat" && status?.active_adapter && (
          <ActiveAdapterStrip name={status.active_adapter} />
        )}

        {view === "settings" ? (
          <SettingsPage
            settings={settings}
            onChange={setSettings}
            onBack={() => setView("chat")}
            memories={memories}
            onSaveMemory={async (m) => {
              await saveMemory(m);
              await refreshMemories();
            }}
            onDeleteMemory={async (id) => {
              await deleteMemory(id);
              await refreshMemories();
            }}
          />
        ) : view === "models" ? (
          <ModelsView
            bases={bases}
            activeBaseId={activeBase?.base_id ?? null}
            busy={busy}
            onLoad={requestLoadBase}
            onBack={() => setView("chat")}
          />
        ) : view === "adapters" ? (
          <AdaptersView
            adapters={status?.adapters ?? []}
            activeAdapter={status?.active_adapter ?? null}
            busy={busy}
            onUnload={handleUnloadAdapter}
            onPickActive={pickAdapter}
            onOpenStore={() => setView("store")}
            onBack={() => setView("chat")}
          />
        ) : view === "store" ? (
          storeSubView === "landing" ? (
            <StoreLanding
              baseSha={status?.base_sha ?? null}
              baseLabel={baseLabel}
              installedSlugs={installedSlugs}
              busy={busy}
              onInstall={handleInstallAdapter}
              onTry={handleTryAdapter}
              onOpenAdapter={(slug) => setAdapterDetailSlug(slug)}
              onOpenBrowse={(preset) => {
                setBrowsePreset(preset ?? null);
                setStoreSubView("browse");
              }}
            />
          ) : (
            <StoreBrowse
              key={browsePreset?.useCase ?? "__no_preset__"}
              baseSha={status?.base_sha ?? null}
              baseLabel={baseLabel}
              installedSlugs={installedSlugs}
              busy={busy}
              preset={browsePreset}
              onOpenAdapter={(slug) => setAdapterDetailSlug(slug)}
              onOpenLanding={() => {
                setBrowsePreset(null);
                setStoreSubView("landing");
              }}
            />
          )
        ) : adapterDetailSlug ? (
          <AdapterSpecSheet
            slug={adapterDetailSlug}
            baseSha={status?.base_sha ?? null}
            baseLabel={baseLabel}
            installed={installedSlugs.has(adapterDetailSlug)}
            busy={busy}
            onInstall={() => {
              void handleInstallAdapterBySlug(adapterDetailSlug);
            }}
            onTry={() => {
              void handleTryAdapterBySlug(adapterDetailSlug);
            }}
            onManage={() => {
              pickAdapter(adapterDetailSlug);
              setAdapterDetailSlug(null);
              setView("adapters");
            }}
            onBack={() => setAdapterDetailSlug(null)}
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
              if (b) requestLoadBase(b);
            }}
            adapters={status?.adapters ?? []}
            adapter={status?.active_adapter ?? null}
            onPickAdapter={pickAdapter}
            baseSha={status?.base_sha ?? null}
            installedSlugs={installedSlugs}
            onTryAdapter={handleTryAdapter}
            workspacePath={workspace?.root ?? null}
            tokenUsage={tokenUsage}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            onPickFiles={pickFiles}
            chips={defaultChips({
              baseLoaded,
              adaptersInstalled: status?.adapters.length ?? 0,
              bases,
              onLoadBase: (baseId) => {
                const b = bases.find((x) => x.base_id === baseId);
                if (b) requestLoadBase(b);
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
            baseSha={status?.base_sha ?? null}
            showThinkingInline={settings.showThinkingInline}
            baseId={activeBase?.base_id ?? null}
            bases={bases}
            onPickBase={(id) => {
              const b = bases.find((x) => x.base_id === id);
              if (b) requestLoadBase(b);
            }}
            adapters={status?.adapters ?? []}
            adapter={status?.active_adapter ?? null}
            onPickAdapter={pickAdapter}
            onRegenerate={handleRegenerate}
            onStop={handleStop}
            canStop={inflightGenId !== null}
            compareMode={compareMode}
            onToggleCompare={toggleCompareMutex}
            compareAvailable={!!status?.active_adapter}
            computerUseMode={computerUseMode}
            onToggleComputerUse={toggleComputerUse}
            permissionPreset={permissionPreset}
            onPickPreset={handlePickPreset}
            workspace={workspace}
            onPickWorkspace={handlePickWorkspace}
            tokenUsage={tokenUsage}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            onPickFiles={pickFiles}
          />
        )}
      </main>

      {pendingBase && (
        <ConfirmModal
          title="Switch base model?"
          confirmLabel={`Load ${pendingBase.name}`}
          body={
            <>
              <p>
                Loading <strong className="text-app-text">{pendingBase.name}</strong>{" "}
                will unload your {status?.adapters.length ?? 0} loaded adapter
                {status?.adapters.length === 1 ? "" : "s"} from memory.
              </p>
              <p className="mt-2 text-xs text-app-text-faint">
                You can reinstall them from the store, or reload from disk. Adapters
                that live locally are not deleted.
              </p>
            </>
          }
          onCancel={() => setPendingBase(null)}
          onConfirm={() => {
            const b = pendingBase;
            setPendingBase(null);
            void handleLoadBase(b);
          }}
        />
      )}

      {pendingMemory && (
        <MemoryApprovalModal
          initial={pendingMemory.proposed}
          onCancel={() => {
            pendingMemory.resolve(null);
            setPendingMemory(null);
          }}
          onConfirm={(edited) => {
            pendingMemory.resolve(edited);
            setPendingMemory(null);
          }}
        />
      )}
    </div>
  );
}

function MemoryApprovalModal({
  initial,
  onCancel,
  onConfirm,
}: {
  initial: MemoryInput;
  onCancel: () => void;
  onConfirm: (m: MemoryInput) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [content, setContent] = useState(initial.content);
  const [kind, setKind] = useState<string>(initial.kind ?? "");
  return (
    <ConfirmModal
      title="Save this memory?"
      confirmLabel="Save memory"
      body={
        <div className="space-y-3">
          <p className="text-xs text-app-text-faint">
            The assistant proposes saving a durable note. Edit or cancel before it
            becomes part of every future turn.
          </p>
          <label className="block">
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 font-mono text-[12.5px] text-app-text focus:border-app-border-strong focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">content</span>
            <textarea
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              className="mt-1 w-full resize-y rounded-md border border-app-border bg-app-surface px-3 py-2 font-mono text-[12.5px] leading-[1.5] text-app-text focus:border-app-border-strong focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 font-mono text-[12.5px] text-app-text focus:border-app-border-strong focus:outline-none"
            >
              <option value="">(none)</option>
              <option value="preference">preference</option>
              <option value="fact">fact</option>
              <option value="project">project</option>
              <option value="reference">reference</option>
            </select>
          </label>
        </div>
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm({ name, content, kind: kind || null })}
    />
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
  baseSha,
  installedSlugs,
  onTryAdapter,
  workspacePath,
  tokenUsage,
  attachments,
  onRemoveAttachment,
  onPickFiles,
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
}) {
  const ready = !!baseSha;
  const eyebrow = `${adapter ?? "no adapter"} · ${baseLabel} · ${
    ready ? "ready" : "load base to begin"
  }`;

  // Up to 4 colored suggestions — one per installed adapter, else fall back
  // to the curated starter prompts.
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
        />
      </div>
    </div>
  );
}

function starterPromptFor(adapterName: string): string {
  const s = adapterName.toLowerCase();
  if (s.includes("sql")) return "top 10 customers by revenue last quarter";
  if (s.includes("email") || s.includes("rewrite"))
    return "rewrite this email more formally";
  if (s.includes("grep") || s.includes("tool"))
    return "extract JSON from an nginx log line";
  if (s.includes("summar")) return "summarize this thread in three bullets";
  return `try ${adapterName} on a real task from your workspace`;
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
  computerUseMode,
  onToggleComputerUse,
  permissionPreset,
  onPickPreset,
  workspace,
  onPickWorkspace,
  tokenUsage,
  attachments,
  onRemoveAttachment,
  onPickFiles,
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
  computerUseMode: boolean;
  onToggleComputerUse: () => void;
  permissionPreset: Preset;
  onPickPreset: (p: Preset) => void;
  workspace: Workspace | null;
  onPickWorkspace: () => void;
  tokenUsage: { used: number; limit: number };
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onPickFiles: () => void;
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
  // Walk messages to detect adapter swaps between consecutive assistant turns.
  // We emit a SwapMarker row ahead of the new assistant turn when its adapter
  // differs from the most recent prior assistant adapter.
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
            computerUseMode
              ? "Describe a task — I'll use tools to do it"
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
          computerUseMode={computerUseMode}
          onToggleComputerUse={onToggleComputerUse}
          permissionPreset={permissionPreset}
          onPickPreset={onPickPreset}
          baseSha={baseSha}
          workspacePath={workspace?.root ?? null}
          tokenUsage={tokenUsage}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          onPickFiles={onPickFiles}
        />
        {computerUseMode && (
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

function MessageTurn({
  message,
  canRegenerate,
  onRegenerate,
  canStop,
  onStop,
  baseLabel,
  showThinkingInline,
}: {
  message: Message;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  canStop?: boolean;
  onStop?: () => void;
  baseLabel: string;
  showThinkingInline: boolean;
}) {
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
  // Assistant
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
  const tone =
    message.status === "saved"
      ? "border-app-accent/40 bg-app-accent/5 text-app-accent"
      : message.status === "denied"
        ? "border-app-border bg-app-surface text-app-text-faint"
        : "border-red-500/40 bg-red-500/5 text-red-400";
  const verb =
    message.status === "saved"
      ? "saved memory"
      : message.status === "denied"
        ? "memory not saved"
        : "memory error";
  return (
    <div className="px-[calc(var(--turn-gutter)+18px)] py-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] tracking-[0.02em] ${tone}`}
        title={message.detail ?? ""}
      >
        <span className="uppercase text-[9.5px] tracking-[0.12em] opacity-70">{verb}</span>
        <span className="truncate max-w-[40ch] text-app-text">{message.name}</span>
        {message.kind && (
          <span className="text-app-text-faint">· {message.kind}</span>
        )}
      </span>
    </div>
  );
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
