import type { ReactNode } from "react";

type Props = {
  label: string;
  brand?: string;
  icon?: ReactNode;
  tone?: "accent" | "purple";
};

export function ToolCallChip({ label, brand, icon, tone = "accent" }: Props) {
  const bg =
    tone === "purple"
      ? "var(--color-app-purple)"
      : "var(--color-app-accent)";

  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <span
        className="flex h-[22px] w-[22px] items-center justify-center rounded-md font-mono text-[10px] font-medium uppercase tracking-tight text-white"
        style={{ background: bg }}
        aria-hidden="true"
      >
        {icon ?? (brand ?? "•").slice(0, 2)}
      </span>
      <span className="text-[14px] leading-none text-app-text-muted">
        {label}
      </span>
      <span
        className="text-[14px] leading-none text-app-text-faint"
        aria-hidden="true"
      >
        ›
      </span>
    </span>
  );
}
