import { useState } from "react";
import {
  PanelLeft,
  Search,
  MessageSquare,
  Plus,
  FolderClosed,
  Sliders,
  Sparkles,
  Pin,
  PinOff,
  Settings,
} from "lucide-react";

export type Conversation = {
  id: string;
  title: string;
  pinned?: boolean;
};

export type SidebarView = "chat" | "store" | "models" | "adapters";

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  activeView: SidebarView;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onOpenStore: () => void;
  onOpenModels: () => void;
  onOpenAdapters: () => void;
  onOpenSettings: () => void;
  onTogglePin: (id: string) => void;
  userName: string;
};

export function Sidebar({
  conversations,
  activeId,
  activeView,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onNewChat,
  onOpenStore,
  onOpenModels,
  onOpenAdapters,
  onOpenSettings,
  onTogglePin,
  userName,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = search
    ? conversations.filter((c) =>
        (c.title || "New chat").toLowerCase().includes(search.toLowerCase()),
      )
    : conversations;
  const pinned = filtered.filter((c) => c.pinned);
  const others = filtered.filter((c) => !c.pinned);

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-app-border bg-app-sidebar py-3 text-sm text-app-text">
        <IconButton title="Expand sidebar" onClick={onToggleCollapsed}>
          <PanelLeft size={16} />
        </IconButton>
        <IconButton title="New chat (⌘N)" onClick={onNewChat}>
          <Plus size={16} />
        </IconButton>
        <div className="my-1 h-px w-6 bg-app-border" />
        <IconButton
          title="Models"
          active={activeView === "models"}
          onClick={onOpenModels}
        >
          <FolderClosed size={15} />
        </IconButton>
        <IconButton
          title="Adapters"
          active={activeView === "adapters"}
          onClick={onOpenAdapters}
        >
          <Sliders size={15} />
        </IconButton>
        <IconButton
          title="Store"
          active={activeView === "store"}
          onClick={onOpenStore}
        >
          <Sparkles size={15} />
        </IconButton>
        <div className="flex-1" />
        <IconButton title="Settings" onClick={onOpenSettings}>
          <Settings size={14} />
        </IconButton>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-app-border bg-app-sidebar text-sm text-app-text">
      <div className="flex items-center gap-2 px-3 pt-3">
        <IconButton title="Collapse sidebar" onClick={onToggleCollapsed}>
          <PanelLeft size={16} />
        </IconButton>
        <IconButton
          title="Search conversations"
          active={searchOpen}
          onClick={() => {
            setSearchOpen((v) => !v);
            if (searchOpen) setSearch("");
          }}
        >
          <Search size={16} />
        </IconButton>
      </div>

      <div className="mt-3 px-3">
        <Tab icon={<MessageSquare size={14} />} label="Chat" active />
      </div>

      <button
        onClick={onNewChat}
        className="mx-2 mt-3 flex items-center justify-between rounded-md px-2 py-1.5 text-left text-app-text hover:bg-app-surface-hover"
      >
        <span className="flex items-center gap-2">
          <Plus size={15} />
          New chat
        </span>
        <span className="text-xs text-app-text-faint">⌘N</span>
      </button>

      <nav className="mt-1 flex flex-col px-2">
        <NavItem
          icon={<FolderClosed size={15} />}
          label="Models"
          active={activeView === "models"}
          onClick={onOpenModels}
        />
        <NavItem
          icon={<Sliders size={15} />}
          label="Adapters"
          active={activeView === "adapters"}
          onClick={onOpenAdapters}
        />
        <NavItem
          icon={<Sparkles size={15} />}
          label="Store"
          active={activeView === "store"}
          onClick={onOpenStore}
        />
      </nav>

      {searchOpen && (
        <div className="mt-3 px-3">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text placeholder:text-app-text-faint focus:border-app-border-strong focus:outline-none"
          />
        </div>
      )}

      <div className="mt-5 flex-1 overflow-y-auto px-2">
        {pinned.length > 0 && (
          <Section label="Pinned">
            {pinned.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                onSelect={() => onSelect(c.id)}
                onTogglePin={() => onTogglePin(c.id)}
              />
            ))}
          </Section>
        )}

        <Section label="Recents">
          {others.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-app-text-faint">
              {search ? "No matches" : "No conversations yet"}
            </div>
          ) : (
            others.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                onSelect={() => onSelect(c.id)}
                onTogglePin={() => onTogglePin(c.id)}
              />
            ))
          )}
        </Section>
      </div>

      <div className="border-t border-app-border px-3 py-3">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center justify-between rounded-md px-1 py-1 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
        >
          <span className="truncate">{userName}</span>
          <Settings size={14} />
        </button>
      </div>
    </aside>
  );
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onTogglePin,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div
      className={`group flex w-full items-center gap-1 rounded-md pl-2 pr-1 hover:bg-app-surface-hover ${
        active ? "bg-app-surface text-app-text" : "text-app-text-muted"
      }`}
    >
      <button
        onClick={onSelect}
        className="min-w-0 flex-1 truncate py-1.5 text-left text-sm"
      >
        {conversation.title || "New chat"}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        className="rounded p-1 text-app-text-faint opacity-0 transition-opacity hover:text-app-text group-hover:opacity-100 data-[pinned=true]:opacity-100"
        data-pinned={conversation.pinned ? "true" : "false"}
        title={conversation.pinned ? "Unpin" : "Pin"}
      >
        {conversation.pinned ? <PinOff size={11} /> : <Pin size={11} />}
      </button>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-md p-1.5 hover:bg-app-surface-hover hover:text-app-text ${
        active ? "bg-app-surface text-app-text" : "text-app-text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Tab({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
        active
          ? "bg-app-surface text-app-text"
          : "text-app-text-muted"
      }`}
    >
      {icon}
      {label && <span>{label}</span>}
    </span>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-app-surface-hover hover:text-app-text ${
        active ? "bg-app-surface text-app-text" : "text-app-text-muted"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-app-text-faint">
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

