import {
  PanelLeft,
  Search,
  MessageSquare,
  ListChecks,
  Code2,
  Plus,
  FolderClosed,
  Sliders,
  Sparkles,
  Pin,
  Settings,
} from "lucide-react";

export type Conversation = {
  id: string;
  title: string;
};

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  activeView: "chat" | "store";
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onOpenStore: () => void;
  userName: string;
};

export function Sidebar({
  conversations,
  activeId,
  activeView,
  onSelect,
  onNewChat,
  onOpenStore,
  userName,
}: Props) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-app-border bg-app-sidebar text-sm text-app-text">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text">
          <PanelLeft size={16} />
        </button>
        <button className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text">
          <Search size={16} />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-1 px-3">
        <Tab icon={<MessageSquare size={14} />} label="Chat" active />
        <Tab icon={<ListChecks size={14} />} label="" />
        <Tab icon={<Code2 size={14} />} label="" />
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
        <NavItem icon={<FolderClosed size={15} />} label="Models" />
        <NavItem icon={<Sliders size={15} />} label="Adapters" />
        <NavItem
          icon={<Sparkles size={15} />}
          label="Store"
          active={activeView === "store"}
          onClick={onOpenStore}
        />
      </nav>

      <div className="mt-5 flex-1 overflow-y-auto px-2">
        <Section label="Pinned">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-app-text-faint">
            <Pin size={12} />
            Drag to pin
          </div>
        </Section>

        <Section label="Recents">
          {conversations.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-app-text-faint">
              No conversations yet
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-app-surface-hover ${
                  c.id === activeId ? "bg-app-surface text-app-text" : "text-app-text-muted"
                }`}
              >
                {c.title || "New chat"}
              </button>
            ))
          )}
        </Section>
      </div>

      <div className="border-t border-app-border px-3 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-app-text-muted">
            <Settings size={14} />
            <span className="truncate">{userName}</span>
          </div>
        </div>
      </div>
    </aside>
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
    <button
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
        active
          ? "bg-app-surface text-app-text"
          : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
      }`}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
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
        active
          ? "bg-app-surface text-app-text"
          : "text-app-text-muted"
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
      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-app-text-faint">
        {label}
      </div>
      {children}
    </div>
  );
}
