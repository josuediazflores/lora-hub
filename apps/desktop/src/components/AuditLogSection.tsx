import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, Trash2 } from "lucide-react";
import { ConfirmModal } from "./ConfirmModal";

export type AuditRow = {
  id: string;
  ts: number;
  tool: string;
  preset: string;
  workspace: string | null;
  args: string;
  status: string;
  bytes: number;
  duration_ms: number;
  approval: string | null;
};

const PAGE_SIZE = 200;

type DateRange = "today" | "7d" | "30d" | "all";

export function AuditLogSection() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [range, setRange] = useState<DateRange>("7d");

  async function refresh(append = false) {
    if (!append) setLoading(true);
    setError(null);
    try {
      const next = await invoke<AuditRow[]>("audit_log_read", {
        limit: PAGE_SIZE,
        offset: append ? rows.length : 0,
      });
      setRows((prev) => (append ? [...prev, ...next] : next));
      setHasMore(next.length === PAGE_SIZE);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(false);
  }, []);

  const knownTools = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.tool);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const cutoff = rangeCutoff(range);
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (cutoff > 0 && r.ts < cutoff) return false;
      if (toolFilter !== "all" && r.tool !== toolFilter) return false;
      if (needle) {
        const hay = `${r.tool} ${r.args} ${r.workspace ?? ""} ${r.status}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, toolFilter, range]);

  async function exportLog() {
    try {
      const dest = await saveDialog({
        defaultPath: defaultExportName(),
        filters: [{ name: "JSON Lines", extensions: ["jsonl"] }],
      });
      if (!dest) return;
      await invoke<number>("audit_log_export", { dest });
    } catch (e) {
      setError(`export failed: ${e}`);
    }
  }

  async function clearLog() {
    setConfirmClear(false);
    try {
      await invoke("audit_log_clear");
      setRows([]);
      setHasMore(false);
    } catch (e) {
      setError(`clear failed: ${e}`);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-3 rounded-md border border-app-accent/40 bg-app-accent/10 px-3 py-2 font-mono text-[11px] text-app-accent">
          {error}
        </div>
      )}

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search tool / args / workspace…"
          className="min-w-[220px] flex-1 rounded-md border border-app-border bg-app-surface px-2.5 py-1.5 font-mono text-[11.5px] text-app-text placeholder:text-app-text-faint focus:border-app-border-strong focus:outline-none"
        />
        <select
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          className="rounded-md border border-app-border bg-app-surface px-2 py-1.5 font-mono text-[11.5px] text-app-text"
        >
          <option value="all">all tools</option>
          {knownTools.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="inline-flex rounded-md border border-app-border bg-app-surface p-0.5 font-mono text-[11px]">
          {(["today", "7d", "30d", "all"] as DateRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-2 py-[3px] ${
                range === r
                  ? "bg-app-accent text-white"
                  : "text-app-text-muted hover:text-app-text"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="mt-3 max-h-[420px] overflow-y-auto rounded-md border border-app-border bg-app-bg">
        {loading ? (
          <div className="py-10 text-center font-mono text-[11px] text-app-text-muted">
            loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-app-text-faint">
            no entries match.
          </div>
        ) : (
          <ul className="divide-y divide-app-border">
            {filtered.map((r) => (
              <li key={r.id} className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2 font-mono text-[11.5px]">
                  <div className="flex items-baseline gap-2">
                    <span className="text-app-text">{r.tool}</span>
                    <span className="rounded-sm border border-app-border px-1 py-[1px] text-[9.5px] uppercase text-app-text-muted">
                      {r.preset}
                    </span>
                    <StatusBadge status={r.status} />
                    {r.approval && (
                      <span className="rounded-sm border border-app-accent/40 px-1 py-[1px] text-[9.5px] uppercase text-app-accent">
                        approved · {r.approval}
                      </span>
                    )}
                  </div>
                  <span className="text-app-text-faint">
                    {formatTs(r.ts)}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-[10.5px] text-app-text-muted">
                  {r.args}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-app-text-faint">
                  {r.duration_ms} ms · {formatBytes(r.bytes)}
                  {r.workspace && ` · ${r.workspace}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
        <div className="text-app-text-faint">
          {filtered.length} of {rows.length} entries
        </div>
        <div className="flex items-center gap-2">
          {hasMore && (
            <button
              onClick={() => refresh(true)}
              className="rounded-md border border-app-border px-2.5 py-1 text-app-text-muted hover:border-app-border-strong hover:text-app-text"
            >
              load older
            </button>
          )}
          <button
            onClick={() => refresh(false)}
            className="rounded-md border border-app-border px-2.5 py-1 text-app-text-muted hover:border-app-border-strong hover:text-app-text"
          >
            refresh
          </button>
          <button
            onClick={exportLog}
            className="inline-flex items-center gap-1 rounded-md border border-app-border px-2.5 py-1 text-app-text-muted hover:border-app-border-strong hover:text-app-text"
          >
            <Download size={11} strokeWidth={2} /> export
          </button>
          <button
            onClick={() => setConfirmClear(true)}
            className="inline-flex items-center gap-1 rounded-md border border-app-accent/40 px-2.5 py-1 text-app-accent hover:bg-app-accent/10"
          >
            <Trash2 size={11} strokeWidth={2} /> clear
          </button>
        </div>
      </div>

      {confirmClear && (
        <ConfirmModal
          title="Clear the audit log?"
          body={
            <div className="space-y-2 text-[12.5px] leading-[1.45] text-app-text-muted">
              <p>This deletes every recorded tool call on this device.</p>
              <p>
                Export first if you want a record — once cleared, the entries
                cannot be recovered.
              </p>
            </div>
          }
          confirmLabel="Clear log"
          cancelLabel="Cancel"
          onConfirm={clearLog}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "border-emerald-500/40 text-emerald-400"
      : status === "error"
        ? "border-app-accent/50 text-app-accent"
        : "border-app-border text-app-text-faint";
  return (
    <span
      className={`rounded-sm border px-1 py-[1px] text-[9.5px] uppercase ${tone}`}
    >
      {status}
    </span>
  );
}

function rangeCutoff(range: DateRange): number {
  if (range === "all") return 0;
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }
  return now - (range === "7d" ? 7 * day : 30 * day);
}

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultExportName(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `lora-hub-audit-${yyyy}${mm}${dd}.jsonl`;
}
