import {
  Download,
  ShoppingBag,
  Pen,
  GraduationCap,
  Code2,
  Coffee,
  Lightbulb,
} from "lucide-react";

export type Chip = {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
};

export function QuickChips({ chips }: { chips: Chip[] }) {
  return (
    <div className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-2">
      {chips.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={c.onClick}
          className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors ${
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
  onLoadBase,
  onOpenStore,
}: {
  baseLoaded: boolean;
  adaptersInstalled: number;
  onLoadBase: () => void;
  onOpenStore: () => void;
}): Chip[] {
  if (!baseLoaded) {
    return [
      {
        label: "Load base model",
        icon: <Download size={14} />,
        primary: true,
        onClick: onLoadBase,
      },
    ];
  }
  if (adaptersInstalled === 0) {
    return [
      {
        label: "Browse adapter store",
        icon: <ShoppingBag size={14} />,
        primary: true,
        onClick: onOpenStore,
      },
      { label: "Write", icon: <Pen size={14} /> },
      { label: "Learn", icon: <GraduationCap size={14} /> },
      { label: "Code", icon: <Code2 size={14} /> },
      { label: "Life stuff", icon: <Coffee size={14} /> },
      { label: "Suggested", icon: <Lightbulb size={14} /> },
    ];
  }
  return [
    { label: "Write", icon: <Pen size={14} /> },
    { label: "Learn", icon: <GraduationCap size={14} /> },
    { label: "Code", icon: <Code2 size={14} /> },
    { label: "Life stuff", icon: <Coffee size={14} /> },
    { label: "Suggested", icon: <Lightbulb size={14} /> },
  ];
}
