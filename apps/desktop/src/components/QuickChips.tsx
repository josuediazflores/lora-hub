import {
  Download,
  ShoppingBag,
  Pen,
  GraduationCap,
  Code2,
  Coffee,
  Lightbulb,
  FolderOpen,
  FlaskConical,
} from "lucide-react";

export type Chip = {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
};

export function QuickChips({ chips }: { chips: Chip[] }) {
  return (
    <div className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-1.5">
      {chips.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={c.onClick}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
            c.primary
              ? "border-app-accent bg-app-accent/10 text-app-accent hover:bg-app-accent/20"
              : "border-app-border bg-transparent text-app-text-muted hover:border-app-border-strong hover:bg-app-surface hover:text-app-text"
          }`}
        >
          {c.icon}
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function defaultChips({
  baseLoaded,
  adaptersInstalled,
  bases,
  onLoadBase,
  onOpenStore,
  onLoadLocalAdapter,
  onCreateTestAdapters,
}: {
  baseLoaded: boolean;
  adaptersInstalled: number;
  bases: { base_id: string; name: string }[];
  onLoadBase: (baseId: string) => void;
  onOpenStore: () => void;
  onLoadLocalAdapter: () => void;
  onCreateTestAdapters: () => void;
}): Chip[] {
  if (!baseLoaded) {
    return bases.map((b, i) => ({
      label: `Load ${b.name}`,
      icon: <Download size={14} />,
      primary: i === 0,
      onClick: () => onLoadBase(b.base_id),
    }));
  }
  if (adaptersInstalled === 0) {
    return [
      {
        label: "Browse store",
        icon: <ShoppingBag size={14} />,
        primary: true,
        onClick: onOpenStore,
      },
      {
        label: "Load from disk",
        icon: <FolderOpen size={14} />,
        onClick: onLoadLocalAdapter,
      },
      {
        label: "Create test adapters",
        icon: <FlaskConical size={14} />,
        onClick: onCreateTestAdapters,
      },
    ];
  }
  return [
    { label: "Write", icon: <Pen size={14} /> },
    { label: "Learn", icon: <GraduationCap size={14} /> },
    { label: "Code", icon: <Code2 size={14} /> },
    { label: "Life stuff", icon: <Coffee size={14} /> },
    { label: "Suggested", icon: <Lightbulb size={14} /> },
    {
      label: "Load from disk",
      icon: <FolderOpen size={14} />,
      onClick: onLoadLocalAdapter,
    },
  ];
}
