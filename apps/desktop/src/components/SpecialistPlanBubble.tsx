import { useState } from "react";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";

export type SpecialistPlanStepStatus = "pending" | "active" | "done" | "skipped";

export type SpecialistPlanStep = {
  slug: string | null;
  purpose: string;
  status: SpecialistPlanStepStatus;
};

export type SpecialistPlanMessage = {
  id: string;
  role: "specialist_plan";
  title: string;
  steps: SpecialistPlanStep[];
};

type Props = {
  message: SpecialistPlanMessage;
};

export function SpecialistPlanBubble({ message }: Props) {
  const [expanded, setExpanded] = useState(true);
  const done = message.steps.filter((s) => s.status === "done").length;
  const total = message.steps.length;
  return (
    <div className="grid grid-cols-[148px_1fr] gap-5 max-[1100px]:grid-cols-1">
      <div />
      <div className="my-1 max-w-[760px]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 rounded-t-md border border-app-border bg-app-surface px-3 py-1.5 text-left font-mono text-[11px] hover:bg-app-surface-hover"
        >
          {expanded ? (
            <ChevronDown size={12} strokeWidth={2} />
          ) : (
            <ChevronRight size={12} strokeWidth={2} />
          )}
          <ListChecks size={12} strokeWidth={2} className="text-app-accent" />
          <span className="text-app-text">plan</span>
          <span className="text-app-text-faint">· {message.title}</span>
          <span className="ml-auto text-app-text-faint">
            {done}/{total}
          </span>
        </button>
        {expanded && (
          <ol className="space-y-1.5 rounded-b-md border-x border-b border-app-border bg-app-surface/60 px-3 py-2">
            {message.steps.map((step, i) => {
              const dot =
                step.status === "done"
                  ? "●"
                  : step.status === "active"
                    ? "▸"
                    : step.status === "skipped"
                      ? "–"
                      : "○";
              const dotTone =
                step.status === "done"
                  ? "text-app-accent"
                  : step.status === "active"
                    ? "text-app-text"
                    : "text-app-text-faint";
              return (
                <li
                  key={i}
                  className="flex items-start gap-2 font-mono text-[11px] leading-[1.5]"
                >
                  <span className={`mt-[1px] ${dotTone}`}>{dot}</span>
                  <span className="w-5 shrink-0 text-app-text-faint">
                    {i + 1}.
                  </span>
                  <span
                    className={`inline-flex shrink-0 rounded-[3px] border border-app-border px-1.5 ${
                      step.slug ? "text-app-accent" : "text-app-text-faint"
                    }`}
                  >
                    {step.slug ?? "base"}
                  </span>
                  <span className="text-app-text">{step.purpose}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
