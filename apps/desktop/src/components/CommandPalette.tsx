import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  Plus,
  Settings,
  Store,
  Layers,
  Box,
  Folder,
  Columns2,
  Terminal,
} from "lucide-react";

/** Item types the palette can render. Chats and actions share one list so
 * arrow-key navigation is linear; grouping is purely presentational. */
export type PaletteAction = {
  kind: "action";
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  run: () => void;
};

export type PaletteChat = {
  kind: "chat";
  id: string;
  title: string;
  preview: string;
  run: () => void;
};

export type PaletteItem = PaletteAction | PaletteChat;

type Props = {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
  chats: PaletteChat[];
};

export function CommandPalette({ open, onClose, actions, chats }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset on open: clear previous query, re-focus the input, put the
  // selection back on the first item. Closing doesn't need cleanup —
  // state just resets next time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo<{
    actions: PaletteAction[];
    chats: PaletteChat[];
    flat: PaletteItem[];
  }>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return {
        actions,
        chats: chats.slice(0, 8),
        flat: [...actions, ...chats.slice(0, 8)],
      };
    }
    const matchedActions = actions.filter((a) =>
      (a.label + " " + (a.hint ?? "")).toLowerCase().includes(q),
    );
    // Score chats: title hit beats preview hit; prefix-of-title beats substring.
    const scoredChats = chats
      .map((c) => {
        const t = c.title.toLowerCase();
        const p = c.preview.toLowerCase();
        let score = 0;
        if (t.startsWith(q)) score = 100;
        else if (t.includes(q)) score = 60;
        else if (p.includes(q)) score = 20;
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map((x) => x.c);
    return {
      actions: matchedActions,
      chats: scoredChats,
      flat: [...matchedActions, ...scoredChats],
    };
  }, [query, actions, chats]);

  // Clamp selection into bounds whenever the filter list shrinks.
  useEffect(() => {
    if (activeIndex >= filtered.flat.length) {
      setActiveIndex(Math.max(0, filtered.flat.length - 1));
    }
  }, [filtered.flat.length, activeIndex]);

  // Scroll the active row into view as you arrow through.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-idx="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.flat.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered.flat[activeIndex];
      if (item) {
        item.run();
        onClose();
      }
    }
  }

  // Map item → its flat-list index so clicks set the right active row.
  const indexOf = new Map<PaletteItem, number>();
  filtered.flat.forEach((it, i) => indexOf.set(it, i));

  function indexFor(it: PaletteItem) {
    return indexOf.get(it) ?? 0;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="mt-[14vh] w-[640px] max-w-[92vw] overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      >
        <div className="border-b border-app-border px-4 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats, jump to a view, run an action…"
            className="w-full bg-transparent font-sans text-[15px] text-app-text placeholder:text-app-text-faint focus:outline-none"
          />
        </div>

        <div
          ref={listRef}
          className="max-h-[55vh] overflow-y-auto py-1"
        >
          {filtered.actions.length > 0 && (
            <Group title="actions">
              {filtered.actions.map((a) => (
                <Row
                  key={a.id}
                  index={indexFor(a)}
                  active={indexFor(a) === activeIndex}
                  onMouseEnter={() => setActiveIndex(indexFor(a))}
                  onClick={() => {
                    a.run();
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {a.icon ? (
                      <a.icon size={14} strokeWidth={1.8} />
                    ) : (
                      <span className="w-[14px]" />
                    )}
                    <span className="truncate font-sans text-[13.5px] text-app-text">
                      {a.label}
                    </span>
                    {a.hint && (
                      <span className="truncate font-mono text-[11px] text-app-text-faint">
                        {a.hint}
                      </span>
                    )}
                  </div>
                  {a.shortcut && (
                    <span className="font-mono text-[10.5px] text-app-text-faint">
                      {a.shortcut}
                    </span>
                  )}
                </Row>
              ))}
            </Group>
          )}

          {filtered.chats.length > 0 && (
            <Group title="chats">
              {filtered.chats.map((c) => (
                <Row
                  key={c.id}
                  index={indexFor(c)}
                  active={indexFor(c) === activeIndex}
                  onMouseEnter={() => setActiveIndex(indexFor(c))}
                  onClick={() => {
                    c.run();
                    onClose();
                  }}
                >
                  <div className="min-w-0 flex items-center gap-2.5 flex-1">
                    <MessageSquare size={13} strokeWidth={1.8} />
                    <div className="min-w-0">
                      <div className="truncate font-sans text-[13.5px] text-app-text">
                        {c.title || "untitled"}
                      </div>
                      {c.preview && (
                        <div className="truncate font-sans text-[12px] text-app-text-faint">
                          {c.preview}
                        </div>
                      )}
                    </div>
                  </div>
                </Row>
              ))}
            </Group>
          )}

          {filtered.flat.length === 0 && (
            <div className="px-4 py-8 text-center font-sans text-[13px] text-app-text-faint">
              No matches.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-app-border px-3 py-2 font-mono text-[10.5px] text-app-text-faint">
          <div className="flex items-center gap-3">
            <span>
              <Kbd>↑↓</Kbd> navigate
            </span>
            <span>
              <Kbd>⏎</Kbd> open
            </span>
            <span>
              <Kbd>esc</Kbd> close
            </span>
          </div>
          <span>{filtered.flat.length} results</span>
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-4 pt-3 pb-1 font-mono text-[10px] tracking-[0.12em] uppercase text-app-text-faint">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  index,
  active,
  onMouseEnter,
  onClick,
  children,
}: {
  index: number;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-palette-idx={index}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 px-4 py-1.5 text-left ${
        active ? "bg-app-accent/10 text-app-text" : "text-app-text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[3px] border border-app-border border-b-[1.6px] px-[5px] py-[1px] font-mono text-[10px] text-app-text-muted">
      {children}
    </span>
  );
}

// Icon exports used by the App when composing the action list — keeps
// icon imports local to this file so action sources don't each re-import.
export const PaletteIcons = {
  New: Plus,
  Settings,
  Store,
  Models: Layers,
  Adapters: Box,
  Workspace: Folder,
  Compare: Columns2,
  Agent: Terminal,
};
