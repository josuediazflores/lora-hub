import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import type { AdapterAccent } from "../lib/adapter-accent";

export type CommandPickerItem = {
  id: string;
  label: string;
  description?: string;
  accent?: AdapterAccent;
};

type Props = {
  items: CommandPickerItem[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  triggerLabel: string;
  allowNone?: boolean;
  noneLabel?: string;
  placeholder?: string;
  emptyLabel?: string;
  /** Position the popover up (true) or down (default). Anchor in a narrow
   * footer — up avoids getting clipped. */
  popoverUp?: boolean;
};

const NONE_ID = "__none__";

export function CommandPicker({
  items,
  activeId,
  onSelect,
  triggerLabel,
  allowNone = false,
  noneLabel = "None",
  placeholder = "Search…",
  emptyLabel = "No matches",
  popoverUp = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const rows = useMemo<CommandPickerItem[]>(() => {
    const base = allowNone
      ? [{ id: NONE_ID, label: noneLabel }, ...items]
      : items;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q),
    );
  }, [items, search, allowNone, noneLabel]);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setHighlight(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(item: CommandPickerItem) {
    onSelect(item.id === NONE_ID ? null : item.id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[highlight];
      if (row) pick(row);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
      >
        {triggerLabel}
        <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-60">
          <path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" strokeWidth="1.3" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute right-0 z-40 w-72 overflow-hidden rounded-xl border border-app-border bg-app-bg shadow-2xl ${
            popoverUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-2 border-b border-app-border px-3 py-2">
            <Search size={12} className="text-app-text-faint" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlight(0);
              }}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-sm text-app-text placeholder:text-app-text-faint focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {rows.length === 0 ? (
              <li className="px-3 py-2 text-xs text-app-text-faint">
                {emptyLabel}
              </li>
            ) : (
              rows.map((r, i) => {
                const isActive =
                  (r.id === NONE_ID && activeId === null) || r.id === activeId;
                const isHighlighted = i === highlight;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pick(r)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                        isHighlighted
                          ? "bg-app-surface-hover text-app-text"
                          : "text-app-text-muted"
                      }`}
                    >
                      {r.accent ? (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: r.accent.text }}
                        />
                      ) : (
                        <span className="h-2.5 w-2.5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {r.label}
                        {r.description && (
                          <span className="ml-1 text-xs text-app-text-faint">
                            · {r.description}
                          </span>
                        )}
                      </span>
                      {isActive && <Check size={12} className="text-app-accent" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
