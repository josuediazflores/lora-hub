import { useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import type { MemoryInput } from "../lib/memory";

export function MemoryApprovalModal({
  initial,
  onCancel,
  onConfirm,
}: {
  initial: MemoryInput;
  onCancel: () => void;
  onConfirm: (m: MemoryInput) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [content, setContent] = useState(initial.content);
  const [kind, setKind] = useState<string>(initial.kind ?? "");
  return (
    <ConfirmModal
      title="Save this memory?"
      confirmLabel="Save memory"
      body={
        <div className="space-y-3">
          <p className="text-xs text-app-text-faint">
            The assistant proposes saving a durable note. Edit or cancel before it
            becomes part of every future turn.
          </p>
          <label className="block">
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 font-mono text-[12.5px] text-app-text focus:border-app-border-strong focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">content</span>
            <textarea
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              className="mt-1 w-full resize-y rounded-md border border-app-border bg-app-surface px-3 py-2 font-mono text-[12.5px] leading-[1.5] text-app-text focus:border-app-border-strong focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-app-text-muted">kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 font-mono text-[12.5px] text-app-text focus:border-app-border-strong focus:outline-none"
            >
              <option value="">(none)</option>
              <option value="preference">preference</option>
              <option value="fact">fact</option>
              <option value="project">project</option>
              <option value="reference">reference</option>
            </select>
          </label>
        </div>
      }
      onCancel={onCancel}
      onConfirm={() => onConfirm({ name, content, kind: kind || null })}
    />
  );
}
