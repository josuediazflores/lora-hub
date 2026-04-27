import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Chat, AnyMessage, Status } from "./message-types";
import type { Attachment } from "./attachments";
import type { Memory } from "./memory";
import type { Settings } from "../components/SettingsPanel";
import { loadSettings } from "../components/SettingsPanel";
import {
  loadPersistedChats,
  persistChats as persistChatsLegacy,
  cleanOnLoad,
  emptyChat,
} from "./persistence";

/**
 * Single Zustand store for chat-adjacent state. PR1.2 migrates the
 * persistence-critical state (chats, activeChatId, sidebarCollapsed).
 * The rest of App.tsx still uses useState; PR1.3 / PR1.4 will fold those
 * into here as turn-runner.ts and AppShell.tsx are extracted.
 */

const STORE_KEY = "lora-hub:chat-store:v1";

export type ChatStoreState = {
  // Persisted (storage middleware)
  chats: Chat[];
  activeChatId: string;
  sidebarCollapsed: boolean;
  settings: Settings;

  // Live sync (re-fetched on mount + after sidecar ops; not persisted)
  status: Status | null;
  memories: Memory[];
  downloadedAdapters: { slug: string; path: string }[];

  // Composer (not persisted — ephemeral)
  input: string;
  attachments: Attachment[];

  // Modes (not persisted — start each session in normal mode)
  computerUseMode: boolean;
  specialistMode: boolean;
  compareMode: boolean;

  // Orchestration (not persisted)
  busy: boolean;
  inflightGenId: string | null;

  // Setters
  setChats: (chats: Chat[]) => void;
  setActiveChatId: (id: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSettings: (s: Settings) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setStatus: (s: Status | null | ((prev: Status | null) => Status | null)) => void;
  setMemories: (m: Memory[]) => void;
  setDownloadedAdapters: (a: { slug: string; path: string }[]) => void;
  setInput: (v: string) => void;
  setAttachments: (a: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
  setComputerUseMode: (v: boolean) => void;
  setSpecialistMode: (v: boolean) => void;
  setCompareMode: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  setInflightGenId: (id: string | null) => void;

  // Higher-level chat ops (resolve activeChatId at call time, fixing the
  // closure bug noted in the App.tsx exploration where patchActiveChat
  // captured a stale activeChatId).
  patchActiveChat: (fn: (c: Chat) => Chat) => void;
  patchChat: (chatId: string, fn: (c: Chat) => Chat) => void;
  pushSystem: (text: string) => void;
  newChat: () => string;
};

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, get) => ({
      chats: [emptyChat()],
      activeChatId: "",
      sidebarCollapsed: false,
      settings: loadSettings(),
      status: null,
      memories: [],
      downloadedAdapters: [],
      input: "",
      attachments: [],
      computerUseMode: false,
      specialistMode: false,
      compareMode: false,
      busy: false,
      inflightGenId: null,

      setChats: (chats) => set({ chats }),
      setActiveChatId: (id) => set({ activeChatId: id }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setSettings: (s) => set({ settings: s }),
      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      setStatus: (s) =>
        set((state) => ({
          status: typeof s === "function" ? s(state.status) : s,
        })),
      setMemories: (memories) => set({ memories }),
      setDownloadedAdapters: (downloadedAdapters) => set({ downloadedAdapters }),
      setInput: (input) => set({ input }),
      setAttachments: (a) =>
        set((state) => ({
          attachments: typeof a === "function" ? a(state.attachments) : a,
        })),
      setComputerUseMode: (v) => set({ computerUseMode: v }),
      setSpecialistMode: (v) => set({ specialistMode: v }),
      setCompareMode: (v) => set({ compareMode: v }),
      setBusy: (busy) => set({ busy }),
      setInflightGenId: (inflightGenId) => set({ inflightGenId }),

      patchActiveChat: (fn) => {
        const { chats, activeChatId } = get();
        set({
          chats: chats.map((c) => (c.id === activeChatId ? fn(c) : c)),
        });
      },

      patchChat: (chatId, fn) => {
        const { chats } = get();
        set({ chats: chats.map((c) => (c.id === chatId ? fn(c) : c)) });
      },

      pushSystem: (text) => {
        const sysMsg: AnyMessage = {
          id: crypto.randomUUID(),
          role: "system",
          text,
        };
        get().patchActiveChat((c) => ({
          ...c,
          messages: [...c.messages, sysMsg],
        }));
      },

      newChat: () => {
        const c = emptyChat();
        set((s) => ({ chats: [c, ...s.chats], activeChatId: c.id }));
        return c.id;
      },
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        chats: s.chats,
        activeChatId: s.activeChatId,
        sidebarCollapsed: s.sidebarCollapsed,
        settings: s.settings,
      }),
      // One-shot migration from the legacy multi-key layout
      // (lora-hub:chats:v1, lora-hub:active-chat:v1, lora-hub:sidebar-collapsed)
      // when the consolidated key doesn't exist yet.
      merge: (persisted, current) => {
        const p = persisted as Partial<ChatStoreState> | undefined;
        if (p && Array.isArray(p.chats) && p.chats.length > 0) {
          return { ...current, ...p };
        }
        // Legacy fallback
        const legacy = loadPersistedChats();
        let collapsed = false;
        try {
          collapsed = localStorage.getItem("lora-hub:sidebar-collapsed") === "1";
        } catch {
          // ignore
        }
        return {
          ...current,
          chats: legacy.chats,
          activeChatId: legacy.activeId || legacy.chats[0]?.id || "",
          sidebarCollapsed: collapsed,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Re-apply cleanOnLoad to scrub transient fields from any messages
        // that survived the round-trip but were persisted before this
        // store landed (legacy key).
        const cleaned = state.chats.map((c) => ({
          ...c,
          messages: c.messages.map((m) => cleanOnLoad(m)),
        }));
        state.chats = cleaned;
        if (!state.activeChatId && cleaned.length > 0) {
          state.activeChatId = cleaned[0].id;
        }
      },
    },
  ),
);

/**
 * Bridge for non-React consumers (e.g. turn-runner.ts in PR1.3).
 * Equivalent to `useChatStore.getState()` / `useChatStore.setState()`.
 */
export const chatStore = useChatStore;

/**
 * Migration helper used by App.tsx's first-render initial state. Returns
 * the store's current chats + activeChatId synchronously so we can
 * preserve the existing `useRef(loadPersistedChats())` pattern during
 * the migration. After migration, this can go.
 */
export function bootstrapChatState(): { chats: Chat[]; activeChatId: string } {
  const s = useChatStore.getState();
  return { chats: s.chats, activeChatId: s.activeChatId };
}

// Re-export the legacy persistChats so callers that haven't migrated yet
// can keep working while the store rolls out incrementally.
export { persistChatsLegacy as persistChats };
