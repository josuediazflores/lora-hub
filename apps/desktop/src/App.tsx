import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { SettingsPage, type Settings } from "./components/SettingsPanel";
import { Sidebar, type Conversation, type SidebarView } from "./components/Sidebar";
import { defaultChips } from "./components/QuickChips";
import { StoreLanding } from "./components/StoreLanding";
import { StoreBrowse } from "./components/StoreBrowse";
import { AdapterSpecSheet } from "./components/AdapterSpecSheet";
import type { UseCase } from "./lib/editorial-data";
import { ModelsView } from "./components/ModelsView";
import { AdaptersView } from "./components/AdaptersView";
import { ConfirmModal } from "./components/ConfirmModal";
import { ActiveAdapterStrip } from "./components/ActiveAdapterStrip";
import { type SpecialistPlanStep } from "./components/SpecialistPlanBubble";
import { type ABPick } from "./components/ABComparePane";
import {
  type Message,
  type ComparisonMessage,
  type MemoryChipMessage,
  type AdapterEntryMerged,
  type Status,
  type Chat,
  type ToolCallMessage,
  type SpecialistStepMessage,
  type SpecialistPlanMessage,
  type ABComparisonMessage,
} from "./lib/message-types";
import { buildSystemMessage } from "./lib/system-prompt";
import { LAST_BASE_KEY } from "./lib/persistence";
import { useChatStore } from "./lib/chat-store";
import {
  buildHistory,
  estimateTokens,
  estimateMessageTokens,
  findPlannerAdapter,
  contextLimitFor,
} from "./lib/chat-helpers";
import { AB_DELTAS, selectNextDelta, type ABDelta } from "./lib/ab-deltas";
import type { ChatMode } from "./components/ModeChip";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import {
  listMemories,
  saveMemory,
  deleteMemory,
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
import { FALLBACK_BASES } from "./lib/fallback-bases";
import { ChatView } from "./components/ChatView";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { FirstRunWizard, FIRST_RUN_KEY, type DownloadProgress } from "./components/FirstRunWizard";
import { UpdateBanner } from "./components/UpdateBanner";
import { MemoryApprovalModal } from "./components/MemoryApprovalModal";
import { PermissionPrompt } from "./components/PermissionPrompt";
import {
  setCommandApprovalRequester,
  type CommandApprovalRequest,
} from "./lib/permission-bridge";

type View = SidebarView;

function App() {
  const status = useChatStore((s) => s.status);
  const setStatus = useChatStore((s) => s.setStatus);
  const [bases, setBases] = useState<StoreBase[]>(FALLBACK_BASES);
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const setChatsStore = useChatStore((s) => s.setChats);
  const setActiveChatIdStore = useChatStore((s) => s.setActiveChatId);
  const patchActiveChatStore = useChatStore((s) => s.patchActiveChat);
  const pushSystemStore = useChatStore((s) => s.pushSystem);
  const newChatStore = useChatStore((s) => s.newChat);
  // Local wrapper preserves the existing functional-update API (`setChats(prev => ...)`)
  // so the rest of App.tsx stays unchanged for now.
  const setChats: React.Dispatch<React.SetStateAction<Chat[]>> = (action) => {
    if (typeof action === "function") {
      setChatsStore((action as (prev: Chat[]) => Chat[])(useChatStore.getState().chats));
    } else {
      setChatsStore(action);
    }
  };
  const setActiveChatId = setActiveChatIdStore;

  // Composer state — store-backed so turn-runner.ts (PR1.3) can read it.
  const input = useChatStore((s) => s.input);
  const setInput = useChatStore((s) => s.setInput);
  const attachments = useChatStore((s) => s.attachments);
  const setAttachmentsStore = useChatStore((s) => s.setAttachments);
  const setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>> = (action) => {
    if (typeof action === "function") {
      setAttachmentsStore(action as (prev: Attachment[]) => Attachment[]);
    } else {
      setAttachmentsStore(action);
    }
  };

  // Which HF repos are materialized in ~/.cache/huggingface/hub. Used
  // to flag Models-view rows that won't trigger a multi-GB download on
  // click. Refetched on mount and after every successful base load.
  const [cachedRepos, setCachedRepos] = useState<Set<string>>(new Set());
  useEffect(() => {
    listCachedHfModels().then(setCachedRepos).catch(() => {});
  }, []);
  const [dragOver, setDragOver] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Settings now persist via the chat-store middleware. The legacy
  // saveSettings useEffect is removed below.
  const settings = useChatStore((s) => s.settings);
  const setSettingsStore = useChatStore((s) => s.setSettings);
  const setSettings: React.Dispatch<React.SetStateAction<Settings>> = (action) => {
    if (typeof action === "function") {
      setSettingsStore((action as (prev: Settings) => Settings)(useChatStore.getState().settings));
    } else {
      setSettingsStore(action);
    }
  };

  // Ephemeral A/B tuning bookkeeping — lost on reload, which is fine
  // because the feature is opportunistic (no harm in missing a turn).
  const abTurnCountRef = useRef(0);
  const abRecentDeltasRef = useRef<string[]>([]);

  // Orchestration state — store-backed so turn-runner.ts can drive it.
  const inflightGenId = useChatStore((s) => s.inflightGenId);
  const setInflightGenId = useChatStore((s) => s.setInflightGenId);
  const busy = useChatStore((s) => s.busy);
  const setBusy = useChatStore((s) => s.setBusy);

  const sidebarCollapsed = useChatStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useChatStore((s) => s.setSidebarCollapsed);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [storeSubView, setStoreSubView] = useState<"landing" | "browse">("landing");
  const [browsePreset, setBrowsePreset] = useState<{ useCase?: UseCase } | null>(null);
  const [adapterDetailSlug, setAdapterDetailSlug] = useState<string | null>(null);

  // Memories — store-backed (read by turn-runner for system message).
  const memories = useChatStore((s) => s.memories);
  const setMemories = useChatStore((s) => s.setMemories);
  const [pendingMemory, setPendingMemory] = useState<
    | {
        toolCallId: string;
        proposed: MemoryInput;
        source: string | null;
        resolve: (accepted: MemoryInput | null) => void;
      }
    | null
  >(null);
  const [pendingCommand, setPendingCommand] = useState<
    | {
        request: CommandApprovalRequest;
        resolve: (decision: "once" | "session" | "denied") => void;
      }
    | null
  >(null);
  // Per-session approvals — keyed by argv[0] (the bare command). Keeps a
  // second `curl` in the same chat from re-prompting the user. Cleared on
  // app reload, never persisted.
  const sessionApprovedCommandsRef = useRef<Set<string>>(new Set());
  const [pendingBase, setPendingBase] = useState<StoreBase | null>(null);
  const [pendingDeleteBase, setPendingDeleteBase] = useState<StoreBase | null>(null);
  const compareMode = useChatStore((s) => s.compareMode);
  const setCompareModeStore = useChatStore((s) => s.setCompareMode);
  const computerUseMode = useChatStore((s) => s.computerUseMode);
  const setComputerUseMode = useChatStore((s) => s.setComputerUseMode);
  const specialistMode = useChatStore((s) => s.specialistMode);
  const setSpecialistMode = useChatStore((s) => s.setSpecialistMode);
  // Wrapper preserves the functional-update form used by `toggleCompareMutex`.
  const setCompareMode: React.Dispatch<React.SetStateAction<boolean>> = (action) => {
    if (typeof action === "function") {
      setCompareModeStore((action as (prev: boolean) => boolean)(useChatStore.getState().compareMode));
    } else {
      setCompareModeStore(action);
    }
  };
  const [permissionPreset, setPermissionPresetState] = useState<Preset>("read_only");
  const [workspace, setWorkspaceState] = useState<Workspace | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // First-run gate. We render the wizard until either (a) the user finishes
  // the flow (we set the flag) or (b) they explicitly skip. After that the
  // regular UI renders forever — Models view handles changing the base later.
  const [firstRunComplete, setFirstRunComplete] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FIRST_RUN_KEY) === "1";
    } catch {
      return true; // private browsing / quota — don't trap users in onboarding
    }
  });
  const completeFirstRun = () => {
    try {
      localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch {
      // ignore
    }
    setFirstRunComplete(true);
  };

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId)!,
    [chats, activeChatId],
  );
  const messages = activeChat.messages;
  const baseLoaded = !!status?.base_model_id;
  const activeBase = useMemo(
    () => bases.find((b) => b.hf_repo === status?.base_model_id) ?? null,
    [bases, status?.base_model_id],
  );
  const baseLabel = activeBase?.name ?? "no base";
  const isWelcome = messages.length === 0;

  // Back-of-envelope token tally for the upcoming turn. Includes the
  // history, the injected system block (prompt + date + memories), and the
  // text the user is currently typing. Output reservation (max_tokens)
  // isn't counted — it's what *remains* of the context budget.
  const tokenUsage = useMemo(() => {
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
  }, [messages, input, settings, memories, status?.base_model_id]);

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

  // Register the command-approval bridge so lib/tools.ts's run_command
  // handler can pop the inline PermissionPrompt without importing App.
  // Session approvals (the `Set` in sessionApprovedCommandsRef) auto-resolve
  // here so the prompt only appears the first time per command per session.
  useEffect(() => {
    setCommandApprovalRequester(async (req) => {
      const bare = bareCommand(req.cmd);
      if (sessionApprovedCommandsRef.current.has(bare)) {
        return "session";
      }
      return new Promise<"once" | "session" | "denied">((resolve) => {
        setPendingCommand({
          request: req,
          resolve: (decision) => {
            if (decision === "session") {
              sessionApprovedCommandsRef.current.add(bare);
            }
            resolve(decision);
          },
        });
      });
    });
    return () => setCommandApprovalRequester(null);
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
    // chats + activeChatId now persist via useChatStore middleware. The
    // legacy localStorage write below is retained only for the active chat
    // ID since downstream tools may still read it directly.
    try {
      localStorage.setItem("lora-hub:active-chat:v1", activeChatId);
    } catch {
      // ignore
    }
  }, [activeChatId]);

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

  const chatMode: ChatMode = useMemo(
    () => (computerUseMode ? "cu" : specialistMode ? "specialist" : "normal"),
    [computerUseMode, specialistMode],
  );

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

  // Thin wrappers around the store actions so App.tsx's call sites don't change.
  // `patchActiveChat` and `pushSystem` resolve activeChatId at call time inside
  // the store, fixing the closure bug noted in the original implementation.
  const patchActiveChat = patchActiveChatStore;
  const pushSystem = pushSystemStore;

  function newChat() {
    newChatStore();
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
    // Adapter self-management: the model can inspect + swap its own LoRA
    // mid-turn. One-at-a-time is enforced because status.active_adapter is
    // a single slot; `currentAdapter` below is the in-flight mirror.
    allowedToolNames.add("list_adapters");
    allowedToolNames.add("activate_adapter");
    allowedToolNames.add("deactivate_adapter");
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
    // Headroom for: list_adapters → activate_adapter → answer → maybe fetch.
    const MAX_STEPS = allowedToolNames.size > 0 ? 6 : 1;

    // Adapter state mirror for this turn. Starts from what the caller passed,
    // mutates on every activate_adapter / deactivate_adapter tool call so the
    // very next generate step picks up the new adapter.
    let currentAdapter = adapter;

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
              adapter: currentAdapter,
              pending: true,
            },
          ],
        }));

        let assistantAccum = "";
        let toolCall: sidecar.SidecarToolCall | null = null;

        // If the sidecar was LoRA-wrapped earlier this session but no adapter
        // is active now, we must pass baseOnly so _lora_save_and_zero zeros
        // the weights for this call. Otherwise stale LoRA weights would bleed
        // in — op_generate only swaps when adapter is non-null.
        const wrapped = !!status?.lora_wrapped;
        const runBaseOnly = wrapped && !currentAdapter;

        const handle = sidecar.generate(currentPrompt, {
          adapter: currentAdapter ?? undefined,
          baseOnly: runBaseOnly,
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
        // Render a standard tool_call bubble for the adapter-control tools so
        // the user sees the swap. Mutate `currentAdapter` + status so the next
        // iteration's generate call actually uses the new adapter.
        const renderAdapterBubble = (): string => {
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
          return tcId;
        };
        const finalizeAdapterBubble = (
          tcId: string,
          r: Awaited<ReturnType<typeof runTool>>,
        ) => {
          patchActiveChat((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === tcId && m.role === "tool_call"
                ? {
                    ...m,
                    status: r.status,
                    output: r.output,
                    error: r.error,
                    truncated: r.truncated,
                  }
                : m,
            ),
          }));
        };

        if (call.name === "list_adapters") {
          const tcId = renderAdapterBubble();
          const installed = Array.from(
            new Set([
              ...(status?.adapters ?? []).map((a) => a.name),
              ...downloadedAdapters.map((d) => d.slug),
            ]),
          );
          const payload = installed.map((slug) => ({
            slug,
            active: slug === currentAdapter,
          }));
          result = { status: "success", output: JSON.stringify(payload) };
          finalizeAdapterBubble(tcId, result);
        } else if (call.name === "activate_adapter") {
          const tcId = renderAdapterBubble();
          const slug =
            typeof call.args.slug === "string" ? call.args.slug.trim() : "";
          if (!slug) {
            result = {
              status: "error",
              error: "activate_adapter requires `slug`",
            };
          } else if (slug === currentAdapter) {
            result = { status: "success", output: `already active: ${slug}` };
          } else {
            const attachErr = await ensureAdapterAttached(slug);
            if (attachErr) {
              result = { status: "error", error: attachErr };
            } else {
              setStatus((s) => (s ? { ...s, active_adapter: slug } : s));
              currentAdapter = slug;
              result = { status: "success", output: `activated ${slug}` };
            }
          }
          finalizeAdapterBubble(tcId, result);
        } else if (call.name === "deactivate_adapter") {
          const tcId = renderAdapterBubble();
          const doUnload = call.args.unload === true;
          if (!currentAdapter) {
            result = { status: "success", output: "no adapter was active" };
          } else {
            const prev = currentAdapter;
            if (doUnload) {
              try {
                await sidecar.unloadAdapter(prev);
              } catch {
                // non-fatal — we still want to detach frontend-side
              }
            }
            setStatus((s) => (s ? { ...s, active_adapter: null } : s));
            currentAdapter = null;
            result = {
              status: "success",
              output: `deactivated ${prev}${doUnload ? " (unloaded)" : ""}`,
            };
          }
          finalizeAdapterBubble(tcId, result);
        } else if (call.name === "save_memory") {
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

  const sidebarConversations: Conversation[] = useMemo(
    () =>
      chats
        .filter((c) => c.messages.length > 0)
        .map((c) => ({ id: c.id, title: c.title, pinned: !!c.pinned })),
    [chats],
  );

  const downloadedAdapters = useChatStore((s) => s.downloadedAdapters);
  const setDownloadedAdapters = useChatStore((s) => s.setDownloadedAdapters);
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
  const loadedAdapterNames = useMemo(
    () => new Set(status?.adapters.map((a) => a.name) ?? []),
    [status?.adapters],
  );
  const installedSlugs = useMemo(
    () =>
      new Set<string>([
        ...loadedAdapterNames,
        ...downloadedAdapters.map((d) => d.slug),
      ]),
    [loadedAdapterNames, downloadedAdapters],
  );
  const mergedAdapters: AdapterEntryMerged[] = useMemo(
    () => [
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
    ],
    [status?.adapters, downloadedAdapters, loadedAdapterNames],
  );

  const paletteActions: PaletteAction[] = useMemo(() => [
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
  ], [chatMode]);

  const paletteChats: PaletteChat[] = useMemo(() => chats.map((c) => {
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
  }), [chats]);

  if (!firstRunComplete) {
    return (
      <FirstRunWizard
        bases={bases}
        onLoadBase={async (base, onProgress) => {
          const res = await sidecar.loadBase(base.hf_repo, {
            onProgress: (p) =>
              onProgress({
                desc: p.desc ?? "",
                n: p.n ?? 0,
                total: p.total ?? 0,
                percent: p.percent ?? 0,
              } satisfies DownloadProgress),
          });
          if (res.type === "error") {
            return { ok: false, message: res.error.message };
          }
          try {
            localStorage.setItem(LAST_BASE_KEY, base.base_id);
          } catch {
            // ignore
          }
          await refreshStatus();
          listCachedHfModels().then(setCachedRepos).catch(() => {});
          return { ok: true };
        }}
        onComplete={completeFirstRun}
        onSkip={completeFirstRun}
      />
    );
  }

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
        onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
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
        userName="You"
      />

      <main className="flex flex-1 flex-col">
        <UpdateBanner />
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

      {pendingCommand && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-app-bg/70 px-6 backdrop-blur-sm">
          <div className="w-full max-w-[520px]">
            <PermissionPrompt
              title="Approve shell command?"
              details={renderCommandDetails(pendingCommand.request)}
              onAllowOnce={() => {
                pendingCommand.resolve("once");
                setPendingCommand(null);
              }}
              onAllowSession={() => {
                pendingCommand.resolve("session");
                setPendingCommand(null);
              }}
              onDeny={() => {
                pendingCommand.resolve("denied");
                setPendingCommand(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function bareCommand(cmd: string): string {
  const slash = cmd.lastIndexOf("/");
  return slash >= 0 ? cmd.slice(slash + 1) : cmd;
}

function renderCommandDetails(req: CommandApprovalRequest): string {
  const argv = [req.cmd, ...req.args].map(quoteArg).join(" ");
  const lines = [argv];
  if (req.cwd) lines.push(`cwd: ${req.cwd}`);
  lines.push("", req.reason);
  return lines.join("\n");
}

function quoteArg(s: string): string {
  return /[\s"'`$()<>|&;*?]/.test(s) ? `'${s.replace(/'/g, "'\\''")}'` : s;
}



function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default App;
