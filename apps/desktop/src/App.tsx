import { useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { BookOpen, RefreshCw, Square } from "lucide-react";
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
import {
  SpecialistStepBubble,
  type SpecialistStepMessage,
} from "./components/SpecialistStepBubble";
import {
  SpecialistPlanBubble,
  type SpecialistPlanMessage,
  type SpecialistPlanStep,
} from "./components/SpecialistPlanBubble";
import {
  ABComparePane,
  type ABComparisonMessage,
  type ABPick,
} from "./components/ABComparePane";
import { AB_DELTAS, selectNextDelta, type ABDelta } from "./lib/ab-deltas";
import type { ChatMode } from "./components/ModeChip";
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
import { listCachedHfModels } from "./lib/cache";
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

type AnyMessage =
  | Message
  | ComparisonMessage
  | ToolCallMessage
  | MemoryChipMessage
  | SpecialistStepMessage
  | SpecialistPlanMessage
  | ABComparisonMessage;

type AdapterEntryMerged = {
  name: string;
  path: string;
  base_sha: string | null;
  downloaded_only: boolean;
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
  if (m.role === "specialist_step") {
    const MAX = 2000;
    const output =
      m.output && m.output.length > MAX
        ? m.output.slice(0, MAX) + "\n…truncated for persistence…"
        : m.output;
    if (m.status === "pending") {
      return { ...m, output, status: "error", error: m.error ?? "session ended" };
    }
    return { ...m, output };
  }
  if (m.role === "specialist_plan") {
    // Plan messages don't accumulate stream state — they're fully formed
    // by the time the first planner step finishes. Safe to persist as-is.
    return m;
  }
  if (m.role === "ab_comparison") {
    // Trim both lanes on persist. A pending A/B turn from a prior session
    // is dead — if we never streamed a result in the old process we can't
    // resurrect it, so just mark the turn as dismissed.
    const MAX = 2000;
    const trim = (s: string) =>
      s.length > MAX ? s.slice(0, MAX) + "\n…truncated for persistence…" : s;
    const pick: ABPick | null =
      m.pending !== null && !m.pick ? "dismissed" : m.pick;
    return {
      ...m,
      baselineText: trim(m.baselineText),
      variationText: trim(m.variationText),
      pending: null,
      pick,
    };
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
  learnedRules: string[] = [],
): sidecar.ChatMessage[] {
  const out: sidecar.ChatMessage[] = [];
  const sys = buildSystemMessage(systemPrompt, memories, learnedRules);
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
    } else if (m.role === "ab_comparison") {
      // The user prompt for this turn lives on a separate `user`-role
      // Message (runABTurn pushes it first), so don't duplicate. Emit
      // only the picked lane's output as the assistant turn. Default to
      // baseline if the user never clicked (silence ≠ accept).
      const pickedText =
        m.pick === "variation" ? m.variationText : m.baselineText;
      const assistantContent = pickedText.trim();
      if (assistantContent)
        out.push({ role: "assistant", content: assistantContent });
    } else if (m.role === "specialist_plan") {
      // UI-only record; the planner's own output already contained the
      // <plan>…</plan> block inline, so don't re-add it to history.
      continue;
    } else if (m.role === "specialist_step") {
      const slugLabel = m.slug ?? "base";
      out.push({
        role: "assistant",
        content: `<tool_call>${JSON.stringify({
          name: "use_specialist",
          args: { slug: m.slug, instruction: m.instruction },
        })}</tool_call>`,
      });
      // Specialist outputs can be verbose. Tail-trim on follow-up turns to
      // keep the planner's context manageable — the user still sees the
      // full output in the transcript.
      const TAIL = 3200;
      const raw =
        m.status === "success"
          ? m.output
          : m.error ?? m.output ?? `[${m.status}]`;
      const resultText =
        raw.length > TAIL ? raw.slice(0, TAIL) + "\n…truncated…" : raw;
      out.push({
        role: "user",
        content: `[tool result: use_specialist ${slugLabel}${
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
    } else if (m.role === "specialist_step") {
      sum +=
        estimateTokens(m.instruction) +
        estimateTokens(m.output) +
        estimateTokens(m.slug ?? "") +
        16;
    } else if (m.role === "specialist_plan") {
      // Not sent to the model — see buildHistory.
      continue;
    } else if (m.role === "ab_comparison") {
      // Only the picked (or baseline) lane is in the prompt — don't
      // double-count the losing lane.
      const picked =
        m.pick === "variation" ? m.variationText : m.baselineText;
      sum += estimateTokens(picked) + 8;
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

/** Planner adapter slug lookup for Specialist mode. Matches the plan's
 * exact slugs (`opus-reasoning-e2b` / `-e4b`) first, then falls back to any
 * installed adapter whose name contains `opus-reasoning` and the base's
 * size tag. Returns null when no suitable planner is installed. */
function findPlannerAdapter(
  adapters: { name: string }[],
  baseParams: string | null,
): string | null {
  const size = (baseParams ?? "").toLowerCase();
  const exact =
    size === "e2b" ? "opus-reasoning-e2b" : size === "e4b" ? "opus-reasoning-e4b" : null;
  if (exact && adapters.some((a) => a.name === exact)) return exact;
  for (const a of adapters) {
    const n = a.name.toLowerCase();
    if (!n.includes("opus-reasoning")) continue;
    if (size && !n.includes(size)) continue;
    return a.name;
  }
  return null;
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

function buildSystemMessage(
  systemPrompt: string,
  memories: Memory[],
  learnedRules: string[] = [],
): string {
  const prompt = systemPrompt.trim();
  const dateLine = currentDateContext();
  // Learned rules are rendered as a small bulleted block the model can
  // scan. We dedupe on the fly in case the user manually re-added a rule
  // that a past A/B already picked.
  const cleanedRules = Array.from(
    new Set(learnedRules.map((r) => r.trim()).filter((r) => r.length > 0)),
  );
  const learnedBlock =
    cleanedRules.length > 0
      ? [
          "Style preferences (learned from your past A/B picks — treat each as a soft rule):",
          ...cleanedRules.map((r) => `- ${r}`),
        ].join("\n")
      : "";

  if (!memories.length) {
    const parts = [prompt, dateLine, learnedBlock].filter(
      (s) => s.length > 0,
    );
    return parts.join("\n\n");
  }

  // Greedy fit: include memories oldest-updated-first until the block would
  // overflow. Tail memories (newest) are the ones that get dropped — the
  // rationale is that a fresh, un-curated memory is more likely to be noise
  // than something you've had pinned for weeks.
  const lines = ["The user has recorded the following durable notes about themselves. Use them to personalize responses; don't repeat them back verbatim unless asked."];
  const baseBytes =
    (prompt ? prompt.length + 2 : 0) +
    dateLine.length +
    2 +
    (learnedBlock.length ? learnedBlock.length + 2 : 0);
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
  const parts = [prompt, dateLine, learnedBlock, memoryBlock].filter(
    (s) => s.length > 0,
  );
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
  // Which HF repos are materialized in ~/.cache/huggingface/hub. Used
  // to flag Models-view rows that won't trigger a multi-GB download on
  // click. Refetched on mount and after every successful base load.
  const [cachedRepos, setCachedRepos] = useState<Set<string>>(new Set());
  useEffect(() => {
    listCachedHfModels().then(setCachedRepos).catch(() => {});
  }, []);
  const [dragOver, setDragOver] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // Ephemeral A/B tuning bookkeeping — lost on reload, which is fine
  // because the feature is opportunistic (no harm in missing a turn).
  const abTurnCountRef = useRef(0);
  const abRecentDeltasRef = useRef<string[]>([]);
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
  const [pendingDeleteBase, setPendingDeleteBase] = useState<StoreBase | null>(null);
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [computerUseMode, setComputerUseMode] = useState<boolean>(false);
  const [specialistMode, setSpecialistMode] = useState<boolean>(false);
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
      settings.learnedRules,
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

  const chatMode: ChatMode = computerUseMode
    ? "cu"
    : specialistMode
      ? "specialist"
      : "normal";

  /** Mutex-enforced mode setter used by the composer chip + palette. */
  function setChatMode(m: ChatMode) {
    if (m === "cu") {
      setCompareMode(false);
      setSpecialistMode(false);
      setComputerUseMode(true);
    } else if (m === "specialist") {
      setCompareMode(false);
      setComputerUseMode(false);
      setSpecialistMode(true);
      // Auto-equip the planner adapter when entering specialist mode, so
      // subsequent generations run through it without the user hunting
      // through the adapter picker. A missing planner is surfaced in the
      // composer placeholder + in runSpecialistTurn's pre-flight check.
      const planner = findPlannerAdapter(
        status?.adapters ?? [],
        activeBase?.parameters ?? null,
      );
      if (planner) {
        setStatus((s) => (s ? { ...s, active_adapter: planner } : s));
      }
    } else {
      setComputerUseMode(false);
      setSpecialistMode(false);
    }
  }

  function toggleCompareMutex() {
    setCompareMode((v) => {
      const next = !v;
      if (next) {
        setComputerUseMode(false); // mutually exclusive
        setSpecialistMode(false);
      }
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

  async function handleDeleteBase(base: StoreBase) {
    try {
      await invoke("delete_cached_hf_model", { hfRepo: base.hf_repo });
      const refreshed = await listCachedHfModels();
      setCachedRepos(refreshed);
      pushSystem(`Deleted cached files for ${base.name}.`);
    } catch (e) {
      pushSystem(`Failed to delete ${base.name}: ${String(e)}`);
    }
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
    // A fresh download just landed in the HF cache; refresh the set so
    // the Models view can flip its badge from "will download" → "downloaded".
    listCachedHfModels().then(setCachedRepos).catch(() => {});
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
    if (!baseLoaded && afterInstallPrompt) {
      setView("chat");
      pushSystem("Load the base model first to try this adapter.");
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

      if (!baseLoaded) {
        void store.markInstalled(adapter.slug);
        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === progressId
              ? {
                  ...m,
                  text: `Downloaded "${adapter.name}" to disk. Load the base model to activate.`,
                  progress: null,
                }
              : m,
          ),
        }));
        setBusy(false);
        return;
      }

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

  /** Ensure `slug` is attached to the sidecar. Auto-attaches from disk if
   * downloaded but not yet loaded. Returns `null` on success, otherwise an
   * error string. */
  async function ensureAdapterAttached(slug: string): Promise<string | null> {
    if ((status?.adapters ?? []).some((a) => a.name === slug)) return null;
    const diskRow = downloadedAdapters.find((d) => d.slug === slug);
    if (!diskRow) {
      const known = [
        ...(status?.adapters ?? []).map((a) => a.name),
        ...downloadedAdapters.map((d) => d.slug),
      ]
        .slice(0, 12)
        .join(", ");
      return (
        `unknown adapter "${slug}" — not attached or downloaded.` +
        (known ? ` Available: ${known}.` : "")
      );
    }
    try {
      const ld = await sidecar.loadAdapter(diskRow.slug, diskRow.path);
      if (ld.type === "error") return `failed to attach "${slug}": ${ld.error.message}`;
      await refreshStatus();
      return null;
    } catch (e) {
      return `failed to attach "${slug}": ${String(e)}`;
    }
  }

  /** Tool-handler for compare_outputs. Runs the same instruction through
   * two lanes (slug_a, slug_b) and returns both outputs side-by-side as a
   * single string result that fits into the existing tool_call UI. */
  async function runCompareOutputs(
    args: Record<string, unknown>,
  ): Promise<{ status: "success" | "error"; output?: string; error?: string }> {
    const instruction = String(args.instruction ?? "").trim();
    if (!instruction) {
      return { status: "error", error: "compare_outputs requires `instruction`" };
    }
    const rawA = args.slug_a;
    const rawB = args.slug_b;
    const slugA =
      typeof rawA === "string" && rawA.trim() ? rawA.trim() : null;
    const slugB =
      typeof rawB === "string" && rawB.trim() ? rawB.trim() : null;
    const maxTokens =
      typeof args.max_tokens === "number" && Number.isFinite(args.max_tokens)
        ? Math.max(32, Math.floor(args.max_tokens))
        : settings.maxTokens;

    const runLane = async (
      slug: string | null,
    ): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
      if (slug) {
        const attachErr = await ensureAdapterAttached(slug);
        if (attachErr) return { ok: false, error: attachErr };
      }
      let accum = "";
      const handle = sidecar.generate(instruction, {
        adapter: slug ?? undefined,
        baseOnly: slug === null,
        messages: [],
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens,
        onToken: (t) => {
          accum += t;
        },
      });
      const res = await handle.result;
      if (res.type === "error") return { ok: false, error: res.error.message };
      const r = res.result as { aborted?: boolean };
      if (r.aborted) return { ok: false, error: "aborted" };
      return { ok: true, text: accum };
    };

    const a = await runLane(slugA);
    const b = await runLane(slugB);
    const labelA = slugA ?? "base";
    const labelB = slugB ?? "base";
    if (!a.ok && !b.ok) {
      return {
        status: "error",
        error: `both lanes failed — A (${labelA}): ${a.error}; B (${labelB}): ${b.error}`,
      };
    }
    const rendered =
      `[A · ${labelA}]\n${a.ok ? a.text : `ERROR: ${a.error}`}\n\n` +
      `[B · ${labelB}]\n${b.ok ? b.text : `ERROR: ${b.error}`}`;
    return { status: "success", output: rendered };
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
    if (specialistMode) {
      return runSpecialistTurn(typed, currentAttachments);
    }
    // Opportunistic A/B tuning: fire a 2-lane compare every Nth turn
    // when running on the plain base model. Gated hard so it never
    // surprises users who haven't opted in.
    if (shouldFireAB(typed)) {
      return runABTurn(typed, currentAttachments);
    }
    abTurnCountRef.current += 1;
    setInput("");
    await runNormalTurn(typed, status?.active_adapter ?? null, currentAttachments);
  }

  /** Gate for opportunistic A/B firing. Encodes every condition from the
   * plan so the decision site in `handleSend` stays a single boolean. */
  function shouldFireAB(typed: string): boolean {
    if (!settings.abTuning.enabled) return false;
    if (status?.active_adapter) return false;                 // base only
    if (computerUseMode || specialistMode || compareMode) return false;
    if (activeChat.messages.length === 0) return false;       // not first turn
    if (typed.trim().length < 12) return false;               // non-trivial
    const freq = Math.max(2, settings.abTuning.frequency);
    if (abTurnCountRef.current < freq) return false;
    // Cooldown: if any of the last 3 messages is already an A/B turn, skip.
    const tail = activeChat.messages.slice(-3);
    if (tail.some((m) => m.role === "ab_comparison")) return false;
    return true;
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
    const memoryReadEnabled = settings.memoryInNormalChat;
    const memoryToolEnabled =
      settings.memoryInNormalChat && settings.memoryWritePolicy !== "off";
    const webToolsEnabled = settings.webToolsInNormalChat;
    const allowedToolNames = new Set<string>();
    if (memoryToolEnabled) allowedToolNames.add("save_memory");
    if (memoryReadEnabled) {
      allowedToolNames.add("recall_memory");
      allowedToolNames.add("list_memories");
    }
    if (webToolsEnabled) {
      allowedToolNames.add("fetch_page");
      allowedToolNames.add("web_search");
      allowedToolNames.add("search_flights");
      allowedToolNames.add("search_dates");
    }
    const toolDefs =
      allowedToolNames.size > 0
        ? TOOL_DEFS.filter((t) => allowedToolNames.has(t.name))
        : undefined;

    let history: sidecar.ChatMessage[] = buildHistory(
      activeChat.messages,
      settings.systemPrompt,
      settings.useMemoryInContext ? memories : [],
      settings.learnedRules,
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

    let history: sidecar.ChatMessage[] = buildHistory(activeChat.messages, settings.systemPrompt, settings.useMemoryInContext ? memories : [], settings.learnedRules);
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
        } else if (call.name === "compare_outputs") {
          result = await runCompareOutputs(call.args);
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

  async function runSpecialistTurn(
    userText: string,
    attachments: Attachment[] = [],
  ) {
    let plannerSlug = findPlannerAdapter(
      status?.adapters ?? [],
      activeBase?.parameters ?? null,
    );
    if (!plannerSlug) {
      const downloadedPlanner = findPlannerAdapter(
        downloadedAdapters.map((d) => ({ name: d.slug })),
        activeBase?.parameters ?? null,
      );
      const diskRow = downloadedPlanner
        ? downloadedAdapters.find((d) => d.slug === downloadedPlanner)
        : null;
      if (diskRow && baseLoaded) {
        pushSystem(`Attaching planner "${diskRow.slug}"…`);
        const ld = await sidecar.loadAdapter(diskRow.slug, diskRow.path);
        if (ld.type === "error") {
          pushSystem(`Failed to attach planner: ${ld.error.message}`);
          return;
        }
        await refreshStatus();
        setStatus((s) => (s ? { ...s, active_adapter: diskRow.slug } : s));
        plannerSlug = diskRow.slug;
      } else {
        pushSystem(
          "Specialist mode needs an Opus-reasoning planner adapter installed for this base. Install `opus-reasoning-e2b` or `opus-reasoning-e4b` from the Store.",
        );
        return;
      }
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

    // Build the specialist catalog. Merges sidecar-attached adapters with
    // on-disk downloaded adapters so the planner can decide whether any
    // available LoRA fits a step — not just ones already attached. Each
    // adapter's description/tags come from the storefront metadata so the
    // planner has something meaningful to route on.
    const attachedNames = new Set(
      (status?.adapters ?? []).map((a) => a.name),
    );
    const availableSlugs = new Set<string>([
      ...attachedNames,
      ...downloadedAdapters.map((d) => d.slug),
    ]);
    availableSlugs.delete(plannerSlug);

    const metadataBySlug = new Map<string, StoreAdapter>();
    try {
      const storeList = await store.fetchAdapters({ limit: 200 });
      for (const a of storeList) metadataBySlug.set(a.slug, a);
    } catch {
      // Storefront unreachable → fall back to slug-only catalog below.
    }

    const catalogRows = Array.from(availableSlugs).map((slug) => {
      const meta = metadataBySlug.get(slug);
      const human = meta?.name ?? slug;
      const desc = (meta?.description ?? "(no description)")
        .replace(/\s+/g, " ")
        .slice(0, 180);
      const tags = (meta?.tags ?? []).slice(0, 4).join(",") || "—";
      const availability = attachedNames.has(slug)
        ? "attached"
        : "on-disk (auto-attach)";
      return `| ${slug} | ${human} | ${desc} | ${tags} | ${availability} |`;
    });
    const catalogTable = catalogRows.length > 0
      ? `| slug | human name | description | tags | availability |\n` +
        `|---|---|---|---|---|\n` +
        catalogRows.join("\n")
      : "No additional specialists available — every step will run on the plain base model.";

    const plannerPreamble =
      `You are the PLANNER adapter (${plannerSlug}). Your job is to design a ` +
      `fully-fleshed-out plan, THEN execute it step-by-step by delegating each step ` +
      `through the use_specialist tool.\n\n` +
      `### Adapters available for this base\n\n` +
      catalogTable +
      `\n\n` +
      `### How to pick an adapter for a step\n` +
      `- Use \`slug: null\` when the plain base model is sufficient (general knowledge, ` +
      `fluent writing, simple transformations).\n` +
      `- Use a specific \`slug\` only when that adapter's description/tags clearly match ` +
      `the step's intent — don't force-fit a LoRA.\n` +
      `- "on-disk (auto-attach)" adapters are lazily loaded on first use; prefer them ` +
      `when they fit, but there's no cost penalty if you stick to the base.\n\n` +
      `### Output contract\n` +
      `Your very first output this turn must be a single fenced plan block:\n\n` +
      `<plan>\n` +
      `{"title": "one-line summary of the overall goal",\n` +
      ` "steps": [\n` +
      `   {"slug": "some-adapter" | null, "purpose": "self-contained description of this step"}\n` +
      ` ]}\n` +
      `</plan>\n\n` +
      `After the plan block, execute each step in order by emitting one use_specialist ` +
      `tool call per step, matching the \`slug\` and filling \`instruction\` with a ` +
      `self-contained prompt (the specialist sees no prior conversation). The specialist ` +
      `itself has access to tools (read_file, write_file, edit_file, list_dir, glob, grep, ` +
      `run_command, http_fetch, fetch_page, web_search) — if a step needs filesystem, shell, ` +
      `or web access, say so in \`instruction\` and the specialist will call the right tool. ` +
      `Between calls, keep your own reasoning inside <think>…</think>. When all steps are ` +
      `done, emit a final consolidated answer to the user in plain text.`;

    const combinedSystemPrompt = settings.systemPrompt
      ? `${settings.systemPrompt}\n\n${plannerPreamble}`
      : plannerPreamble;

    let history: sidecar.ChatMessage[] = buildHistory(
      activeChat.messages,
      combinedSystemPrompt,
      settings.useMemoryInContext ? memories : [],
      settings.learnedRules,
    );
    let currentPrompt = promptForModel;
    const specialistTools = TOOL_DEFS.filter((t) => t.name === "use_specialist");
    const MAX_STEPS = 10;
    let stopped: "ok" | "error" | "aborted" | "maxsteps" = "ok";

    // Plan bookkeeping. The planner is asked to emit a <plan>…</plan> JSON
    // block as its very first output. We parse it the moment we see the
    // closing tag, insert a SpecialistPlanMessage into the transcript, and
    // then tick step statuses as use_specialist calls land.
    let planMsgId: string | null = null;
    let planSteps: SpecialistPlanStep[] = [];
    let planParsed = false;
    const patchPlanMsg = (
      mutator: (steps: SpecialistPlanStep[]) => SpecialistPlanStep[],
    ) => {
      if (!planMsgId) return;
      patchActiveChat((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === planMsgId && m.role === "specialist_plan"
            ? { ...m, steps: mutator(m.steps) }
            : m,
        ),
      }));
      planSteps = mutator(planSteps);
    };

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
              adapter: plannerSlug,
              pending: true,
            },
          ],
        }));

        let assistantAccum = "";
        let toolCall: sidecar.SidecarToolCall | null = null;
        let toolProtoErr: string | null = null;

        const handle = sidecar.generate(currentPrompt, {
          adapter: plannerSlug,
          messages: history,
          temperature: settings.temperature,
          topP: settings.topP,
          maxTokens: settings.maxTokens,
          tools: specialistTools,
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
            if (!planParsed && step === 0) {
              const closeIdx = assistantAccum.indexOf("</plan>");
              if (closeIdx >= 0) {
                planParsed = true;
                const openIdx = assistantAccum.indexOf("<plan>");
                const body = openIdx >= 0
                  ? assistantAccum.slice(openIdx + "<plan>".length, closeIdx).trim()
                  : "";
                try {
                  const parsed = JSON.parse(body) as {
                    title?: unknown;
                    steps?: unknown;
                  };
                  const title =
                    typeof parsed.title === "string"
                      ? parsed.title
                      : "specialist plan";
                  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
                  const steps: SpecialistPlanStep[] = rawSteps
                    .map((s: unknown): SpecialistPlanStep | null => {
                      if (!s || typeof s !== "object") return null;
                      const rec = s as Record<string, unknown>;
                      const slugRaw = rec.slug;
                      const purposeRaw = rec.purpose;
                      if (typeof purposeRaw !== "string" || !purposeRaw.trim()) {
                        return null;
                      }
                      const slug =
                        typeof slugRaw === "string" && slugRaw.trim()
                          ? slugRaw.trim()
                          : null;
                      return {
                        slug,
                        purpose: purposeRaw.trim(),
                        status: "pending",
                      };
                    })
                    .filter((s): s is SpecialistPlanStep => s !== null);
                  if (steps.length > 0) {
                    const id = crypto.randomUUID();
                    planMsgId = id;
                    planSteps = steps;
                    const planMsg: SpecialistPlanMessage = {
                      id,
                      role: "specialist_plan",
                      title,
                      steps,
                    };
                    patchActiveChat((c) => {
                      // Insert the plan right above the current assistant bubble.
                      const idx = c.messages.findIndex(
                        (m) => m.id === assistantId,
                      );
                      if (idx < 0) {
                        return { ...c, messages: [...c.messages, planMsg] };
                      }
                      return {
                        ...c,
                        messages: [
                          ...c.messages.slice(0, idx),
                          planMsg,
                          ...c.messages.slice(idx),
                        ],
                      };
                    });
                  }
                } catch {
                  pushSystem(
                    "Couldn't parse the planner's <plan> block as JSON — continuing without a plan overlay.",
                  );
                }
              }
            }
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

        if (toolProtoErr && !toolCall) {
          history.push({ role: "assistant", content: assistantAccum });
          currentPrompt = `[tool_error] ${toolProtoErr}\nReformat your tool call using the exact <tool_call>{...}</tool_call> format on a single line, or finish with a plain-text answer.`;
          continue;
        }

        if (!toolCall) {
          break;
        }

        const call: sidecar.SidecarToolCall = toolCall;
        if (call.name !== "use_specialist") {
          pushSystem(
            `Planner emitted unsupported tool "${call.name}" — only use_specialist is available in this mode.`,
          );
          stopped = "error";
          break;
        }

        const rawSlug = call.args.slug;
        const slug =
          typeof rawSlug === "string" && rawSlug.trim()
            ? rawSlug.trim()
            : null;
        const instruction = String(call.args.instruction ?? "").trim();

        const stepId = crypto.randomUUID();
        const stepMsg: SpecialistStepMessage = {
          id: stepId,
          role: "specialist_step",
          slug,
          instruction,
          output: "",
          status: "pending",
        };
        patchActiveChat((c) => ({
          ...c,
          messages: [...c.messages, stepMsg],
        }));

        // Feed the planner's tool call into history for the next iteration
        // regardless of whether the step itself succeeds.
        const assistantContent =
          assistantAccum +
          `\n<tool_call>${JSON.stringify({
            name: call.name,
            args: call.args,
          })}</tool_call>`;
        history = [
          ...history,
          { role: "assistant", content: assistantContent },
        ];

        const failStep = (errText: string) => {
          patchActiveChat((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === stepId && m.role === "specialist_step"
                ? { ...m, status: "error", error: errText }
                : m,
            ),
          }));
          currentPrompt = `[tool result: use_specialist ${slug ?? "base"} error]\n${errText}`;
        };

        if (!instruction) {
          failStep("use_specialist called with empty instruction");
          continue;
        }
        if (slug) {
          const attached = (status?.adapters ?? []).some((a) => a.name === slug);
          if (!attached) {
            const diskRow = downloadedAdapters.find((d) => d.slug === slug);
            if (!diskRow) {
              const known = [
                ...(status?.adapters ?? []).map((a) => a.name),
                ...downloadedAdapters.map((d) => d.slug),
              ]
                .filter((n) => n !== plannerSlug)
                .slice(0, 12)
                .join(", ");
              failStep(
                `unknown specialist slug "${slug}" — not installed on this base.` +
                  (known ? ` Available: ${known}.` : ""),
              );
              continue;
            }
            try {
              const ld = await sidecar.loadAdapter(diskRow.slug, diskRow.path);
              if (ld.type === "error") {
                failStep(`failed to attach "${slug}": ${ld.error.message}`);
                continue;
              }
              await refreshStatus();
            } catch (e) {
              failStep(`failed to attach "${slug}": ${String(e)}`);
              continue;
            }
          }
        }

        // Flip the next matching plan step to active.
        if (planMsgId && planSteps.length > 0) {
          patchPlanMsg((steps) => {
            const idx = steps.findIndex(
              (s) => s.status === "pending" && s.slug === slug,
            );
            if (idx < 0) return steps;
            const next = steps.slice();
            next[idx] = { ...next[idx], status: "active" };
            return next;
          });
        }

        // Specialists get a filtered tool set so they can actually act on
        // their step (grep, read, run commands, fetch pages). `use_specialist`
        // is stripped to prevent recursion; `save_memory` is stripped because
        // memory writes belong to the top-level chat, not isolated sub-calls.
        const innerTools = TOOL_DEFS.filter(
          (t) => t.name !== "use_specialist" && t.name !== "save_memory",
        );
        const MAX_INNER_STEPS = 4;
        let specOutputAccum = "";
        let innerPrompt = instruction;
        let innerHistory: sidecar.ChatMessage[] = [];
        let specError: string | null = null;
        const appendToOutput = (chunk: string) => {
          specOutputAccum += chunk;
          patchActiveChat((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === stepId && m.role === "specialist_step"
                ? { ...m, output: m.output + chunk }
                : m,
            ),
          }));
        };

        for (let inner = 0; inner < MAX_INNER_STEPS; inner++) {
          let innerAccum = "";
          let innerToolCall: sidecar.SidecarToolCall | null = null;

          const specHandle = sidecar.generate(innerPrompt, {
            adapter: slug ?? undefined,
            baseOnly: slug === null,
            messages: innerHistory,
            temperature: settings.temperature,
            topP: settings.topP,
            maxTokens: settings.maxTokens,
            tools: innerTools,
            onToken: (text) => {
              innerAccum += text;
              appendToOutput(text);
            },
            onToolCall: (call) => {
              innerToolCall = call;
            },
          });
          setInflightGenId(specHandle.id);
          const specRes = await specHandle.result;
          setInflightGenId(null);

          if (specRes.type === "error") {
            specError = specRes.error.message;
            break;
          }
          const rSpec = specRes.result as { aborted?: boolean };
          if (rSpec.aborted) {
            specError = "aborted";
            break;
          }

          if (!innerToolCall) {
            break;
          }

          const ic: sidecar.SidecarToolCall = innerToolCall;
          const toolRes =
            ic.name === "compare_outputs"
              ? await runCompareOutputs(ic.args)
              : await runTool(ic.name, ic.args);
          const argsPreview = JSON.stringify(ic.args).slice(0, 220);
          const bodyPreview = (
            toolRes.status === "success"
              ? toolRes.output ?? ""
              : toolRes.error ?? "unknown error"
          ).slice(0, 1200);
          appendToOutput(
            `\n\n[tool: ${ic.name} ${argsPreview}${toolRes.status !== "success" ? ` — ${toolRes.status}` : ""}]\n${bodyPreview}\n`,
          );

          innerHistory = [
            ...innerHistory,
            {
              role: "assistant",
              content:
                innerAccum +
                `\n<tool_call>${JSON.stringify({
                  name: ic.name,
                  args: ic.args,
                })}</tool_call>`,
            },
          ];
          const resultBody =
            toolRes.status === "success"
              ? toolRes.output ?? ""
              : toolRes.error ?? "unknown error";
          innerPrompt = `[tool result: ${ic.name}${
            toolRes.status !== "success" ? " " + toolRes.status : ""
          }]\n${resultBody}`;
        }

        patchActiveChat((c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== stepId || m.role !== "specialist_step") return m;
            if (specError) {
              return { ...m, status: "error", error: specError };
            }
            return { ...m, status: "success" };
          }),
        }));

        // Tick the plan step bookkeeping to match the spec result.
        if (planMsgId && planSteps.length > 0) {
          patchPlanMsg((steps) => {
            const idx = steps.findIndex((s) => s.status === "active");
            if (idx < 0) return steps;
            const next = steps.slice();
            next[idx] = {
              ...next[idx],
              status: specError ? "skipped" : "done",
            };
            return next;
          });
        }

        const slugLabel = slug ?? "base";
        currentPrompt = specError
          ? `[tool result: use_specialist ${slugLabel} error]\n${specError}`
          : `[tool result: use_specialist ${slugLabel}]\n${specOutputAccum}`;

        if (specError === "aborted") {
          stopped = "aborted";
          break;
        }
      }

      if (stopped === "ok" && currentPrompt.startsWith("[tool result:")) {
        stopped = "maxsteps";
      }
      if (stopped === "maxsteps") {
        pushSystem(
          `Specialist mode stopped after ${MAX_STEPS} steps. Send another message to continue.`,
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

    const history: sidecar.ChatMessage[] = buildHistory(activeChat.messages, settings.systemPrompt, settings.useMemoryInContext ? memories : [], settings.learnedRules);

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

  /**
   * Opportunistic A/B turn: run the prompt twice on the base model with
   * two different system prompts, render both lanes, and let the user
   * pick the one they preferred. A "variation" pick appends the delta's
   * rule to `settings.learnedRules` for every future turn.
   */
  async function runABTurn(
    userText: string,
    attachments: Attachment[] = [],
  ) {
    setInput("");
    setBusy(true);
    abTurnCountRef.current = 0;

    const delta = selectNextDelta(abRecentDeltasRef.current, AB_DELTAS);

    const promptForModel =
      userText + formatAttachmentsForPrompt(attachments);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: userText,
      attachments: attachments.length ? attachments : undefined,
    };
    const abId = crypto.randomUUID();
    const abMsg: ABComparisonMessage = {
      id: abId,
      role: "ab_comparison",
      prompt: userText,
      delta,
      baselineText: "",
      variationText: "",
      pending: "baseline",
      pick: null,
    };
    patchActiveChat((c) => ({
      ...c,
      title: c.title || (userText || attachments[0]?.name || "").slice(0, 48),
      messages: [...c.messages, userMsg, abMsg],
    }));

    // Pre-A/B history (everything before this turn). We'll append the
    // user prompt as the final user turn in each generate() call; the
    // history itself doesn't include the current user message yet.
    const priorMessages = activeChat.messages;
    const baselineRules = settings.learnedRules;
    const variationRules = [...settings.learnedRules, delta.rule];
    const baselineHistory = buildHistory(
      priorMessages,
      settings.systemPrompt,
      settings.useMemoryInContext ? memories : [],
      baselineRules,
    );
    const variationHistory = buildHistory(
      priorMessages,
      settings.systemPrompt,
      settings.useMemoryInContext ? memories : [],
      variationRules,
    );

    function patchAB(update: (m: ABComparisonMessage) => ABComparisonMessage) {
      patchActiveChat((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === abId && m.role === "ab_comparison" ? update(m) : m,
        ),
      }));
    }

    // Lane 1 — baseline.
    const baselineHandle = sidecar.generate(promptForModel, {
      messages: baselineHistory,
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: settings.maxTokens,
      onToken: (text) =>
        patchAB((m) => ({ ...m, baselineText: m.baselineText + text })),
    });
    setInflightGenId(baselineHandle.id);
    const baselineRes = await baselineHandle.result;
    setInflightGenId(null);

    if (baselineRes.type === "error") {
      patchAB((m) => ({
        ...m,
        baselineText:
          m.baselineText + `\n\n[error: ${baselineRes.error.message}]`,
        pending: null,
        pick: "dismissed",
      }));
      setBusy(false);
      return;
    }
    if ((baselineRes.result as { aborted?: boolean }).aborted) {
      patchAB((m) => ({
        ...m,
        baselineText: m.baselineText + " ⏹",
        pending: null,
        pick: "dismissed",
      }));
      setBusy(false);
      return;
    }

    // Lane 2 — variation.
    patchAB((m) => ({ ...m, pending: "variation" }));
    const variationHandle = sidecar.generate(promptForModel, {
      messages: variationHistory,
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: settings.maxTokens,
      onToken: (text) =>
        patchAB((m) => ({ ...m, variationText: m.variationText + text })),
    });
    setInflightGenId(variationHandle.id);
    const variationRes = await variationHandle.result;
    setInflightGenId(null);

    patchAB((m) => {
      if (variationRes.type === "error") {
        return {
          ...m,
          variationText:
            m.variationText + `\n\n[error: ${variationRes.error.message}]`,
          pending: null,
        };
      }
      const r = variationRes.result as { aborted?: boolean };
      return {
        ...m,
        variationText: m.variationText + (r.aborted ? " ⏹" : ""),
        pending: null,
      };
    });
    setBusy(false);
  }

  /** Commit a user's A/B pick. On "variation" we append the delta's rule
   * to `settings.learnedRules` so it influences every future turn. */
  function handleABPick(messageId: string, choice: ABPick) {
    let pickedDelta: ABDelta | null = null;
    patchActiveChat((c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== messageId || m.role !== "ab_comparison") return m;
        if (m.pick) return m; // idempotent — transcript re-renders shouldn't double-apply
        pickedDelta = m.delta;
        return { ...m, pick: choice };
      }),
    }));
    if (choice === "variation" && pickedDelta) {
      const rule = (pickedDelta as ABDelta).rule;
      setSettings((prev) => {
        if (prev.learnedRules.includes(rule)) return prev;
        return { ...prev, learnedRules: [...prev.learnedRules, rule] };
      });
    }
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

    const history: sidecar.ChatMessage[] = buildHistory(beforeUser, settings.systemPrompt, settings.useMemoryInContext ? memories : [], settings.learnedRules);

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

  async function pickAdapter(name: string | null) {
    if (name === null) {
      setStatus((s) => (s ? { ...s, active_adapter: null } : s));
      return;
    }
    const err = await ensureAdapterAttached(name);
    if (err) {
      pushSystem(err);
      return;
    }
    setStatus((s) => (s ? { ...s, active_adapter: name } : s));
  }

  const sidebarConversations: Conversation[] = chats
    .filter((c) => c.messages.length > 0)
    .map((c) => ({ id: c.id, title: c.title, pinned: !!c.pinned }));

  const [downloadedAdapters, setDownloadedAdapters] = useState<
    { slug: string; path: string }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      invoke<{ slug: string; path: string }[]>("list_downloaded_adapters")
        .then((rows) => {
          if (!cancelled) setDownloadedAdapters(rows);
        })
        .catch(() => {});
    };
    refresh();
    const id = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  const loadedAdapterNames = new Set(status?.adapters.map((a) => a.name) ?? []);
  const installedSlugs = new Set<string>([
    ...loadedAdapterNames,
    ...downloadedAdapters.map((d) => d.slug),
  ]);
  const mergedAdapters: AdapterEntryMerged[] = [
    ...(status?.adapters ?? []).map((a) => ({
      name: a.name,
      path: a.path,
      base_sha: a.base_sha,
      downloaded_only: false,
    })),
    ...downloadedAdapters
      .filter((d) => !loadedAdapterNames.has(d.slug))
      .map((d) => ({
        name: d.slug,
        path: d.path,
        base_sha: null as string | null,
        downloaded_only: true,
      })),
  ];

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
      run: () => setChatMode(chatMode === "cu" ? "normal" : "cu"),
    },
    {
      kind: "action",
      id: "toggle-specialist",
      label: "Toggle Specialist mode",
      hint: "planner LoRA delegates subtasks to other adapters",
      icon: PaletteIcons.Agent,
      run: () => setChatMode(chatMode === "specialist" ? "normal" : "specialist"),
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
            cachedRepos={cachedRepos}
            onLoad={requestLoadBase}
            onDelete={(b) => setPendingDeleteBase(b)}
            onBack={() => setView("chat")}
          />
        ) : view === "adapters" ? (
          <AdaptersView
            adapters={mergedAdapters}
            activeAdapter={status?.active_adapter ?? null}
            busy={busy}
            baseLoaded={baseLoaded}
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
              onInstallAdapter={(slug) => {
                void handleInstallAdapterBySlug(slug);
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
            adapters={mergedAdapters}
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
            mode={chatMode}
            onSetMode={setChatMode}
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
            adapters={mergedAdapters}
            adapter={status?.active_adapter ?? null}
            onPickAdapter={pickAdapter}
            onRegenerate={handleRegenerate}
            onStop={handleStop}
            canStop={inflightGenId !== null}
            compareMode={compareMode}
            onToggleCompare={toggleCompareMutex}
            compareAvailable={!!status?.active_adapter}
            mode={chatMode}
            onSetMode={setChatMode}
            permissionPreset={permissionPreset}
            onPickPreset={handlePickPreset}
            workspace={workspace}
            onPickWorkspace={handlePickWorkspace}
            tokenUsage={tokenUsage}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            onPickFiles={pickFiles}
            onPickAB={handleABPick}
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

      {pendingDeleteBase && (
        <ConfirmModal
          title="Delete cached model?"
          confirmLabel={`Delete ${pendingDeleteBase.name}`}
          body={
            <>
              <p>
                This removes{" "}
                <strong className="text-app-text">{pendingDeleteBase.name}</strong>{" "}
                from <code className="text-app-text-muted">~/.cache/huggingface/hub/</code>,
                reclaiming {(pendingDeleteBase.size_bytes / 1e9).toFixed(1)} GB of disk.
              </p>
              <p className="mt-2 text-xs text-app-text-faint">
                Re-loading this model later will re-download it from HuggingFace.
                Your adapters are stored separately and are not affected.
              </p>
            </>
          }
          onCancel={() => setPendingDeleteBase(null)}
          onConfirm={() => {
            const b = pendingDeleteBase;
            setPendingDeleteBase(null);
            void handleDeleteBase(b);
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
          mode={mode}
          onSetMode={onSetMode}
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
      <div
        className="flex items-center gap-3"
        title={message.detail ?? ""}
      >
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
