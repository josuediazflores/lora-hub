import type { ABPick } from "../components/ABComparePane";
import type { AnyMessage, Chat, PersistedChat } from "./message-types";

export const STORAGE_KEY = "lora-hub:chats:v1";
export const ACTIVE_KEY = "lora-hub:active-chat:v1";
export const LAST_BASE_KEY = "lora-hub:last-base-id:v1";

export function emptyChat(): Chat {
  return { id: crypto.randomUUID(), title: "", messages: [] };
}

/** Strip transient fields on (re)load/persist without clobbering the
 * discriminated-union shape for comparison / tool_call messages. */
export function cleanOnLoad(m: AnyMessage): AnyMessage {
  if (m.role === "comparison") {
    return { ...m, pending: null };
  }
  if (m.role === "memory_chip") {
    return m;
  }
  if (m.role === "tool_call") {
    const MAX = 2000;
    const output =
      m.output && m.output.length > MAX
        ? m.output.slice(0, MAX) + "\n…truncated for persistence…"
        : m.output;
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
    return m;
  }
  if (m.role === "ab_comparison") {
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
  const attachments = m.attachments?.map((a) => ({ ...a, data_url: undefined }));
  return { ...m, progress: null, pending: false, attachments };
}

export function loadPersistedChats(): { chats: Chat[]; activeId: string } {
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
    return {
      chats,
      activeId: chats.some((c) => c.id === activeId) ? activeId : chats[0].id,
    };
  } catch {
    return { chats: [emptyChat()], activeId: "" };
  }
}

export function persistChats(chats: Chat[]): void {
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
