import { invoke } from "@tauri-apps/api/core";
import type { ToolDef } from "./sidecar";
import { listMemories, type Memory } from "./memory";

/**
 * Tool registry passed to the sidecar so the model sees a compact spec of
 * what it can call. The runTool() dispatcher below maps each name to the
 * matching Tauri command. Keep this list and the Rust tools.rs commands in
 * sync.
 */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: "read_file",
    description: "Read text contents of a file in the workspace.",
    parameters: {
      path: {
        type: "string",
        required: true,
        description: "Workspace-relative path",
      },
    },
  },
  {
    name: "write_file",
    description: "Write text to a file in the workspace (creates or overwrites).",
    parameters: {
      path: { type: "string", required: true },
      content: { type: "string", required: true },
    },
  },
  {
    name: "edit_file",
    description:
      "Edit a file by replacing the first occurrence of old_string with new_string. " +
      "Provide enough surrounding context in old_string to make the match uniquely " +
      "identifying. Errors when the match count is 0 or >1 — re-read the file and " +
      "widen the context. Prefer this over write_file for any change smaller than a " +
      "full rewrite.",
    parameters: {
      path: {
        type: "string",
        required: true,
        description: "Workspace-relative path",
      },
      old_string: {
        type: "string",
        required: true,
        description: "Exact bytes to locate; must match exactly once in the file.",
      },
      new_string: {
        type: "string",
        required: true,
        description: "Replacement bytes.",
      },
    },
  },
  {
    name: "list_dir",
    description: "List the entries of a directory inside the workspace.",
    parameters: {
      path: {
        type: "string",
        required: false,
        description: "Directory to list (default: workspace root).",
      },
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern under the workspace.",
    parameters: {
      pattern: {
        type: "string",
        required: true,
        description: "Glob pattern, e.g. 'src/**/*.ts'",
      },
    },
  },
  {
    name: "grep",
    description: "Search file contents for a regex (uses ripgrep).",
    parameters: {
      pattern: { type: "string", required: true },
      path: {
        type: "string",
        required: false,
        description: "Where to search (default: whole workspace)",
      },
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command. Allowed commands depend on the permission preset.",
    parameters: {
      cmd: { type: "string", required: true },
      args: { type: "array", required: false, description: "string[]" },
      cwd: {
        type: "string",
        required: false,
        description: "Workspace-relative working directory",
      },
    },
  },
  {
    name: "http_fetch",
    description: "Make an HTTP request.",
    parameters: {
      url: { type: "string", required: true },
      method: {
        type: "string",
        required: false,
        description: "Default GET; non-GET requires Standard or higher",
      },
      headers: { type: "object", required: false },
      body: { type: "string", required: false },
    },
  },
  {
    name: "fetch_page",
    description:
      "Fetch a web page and return its main article as Markdown ({title, url, markdown}). " +
      "Pair with web_search — search first to find the right URL, then fetch_page to read it. " +
      "IF fetch_page RETURNS AN ERROR (403, 404, timeout, empty), DO NOT GIVE UP — call " +
      "fetch_page again with the next URL from your last web_search results. Some sites block " +
      "automated access; others are fine. Keep trying down the list until one succeeds, then " +
      "answer from that page. Markdown is truncated at ~30KB. http(s) only.",
    parameters: {
      url: { type: "string", required: true },
    },
  },
  {
    name: "web_search",
    description:
      "Search the web. Returns up to 10 hits as {title, url, snippet}. " +
      "SNIPPETS ARE PREVIEWS, NOT ANSWERS — after reviewing the results, call fetch_page on " +
      "the URL most likely to contain what the user asked for, then answer from that page's " +
      "content. Do not answer a factual question from snippets alone. Use when the user asks " +
      "about current events, weather, prices, docs, recent news — anything time-sensitive or " +
      "outside your training data.",
    parameters: {
      query: { type: "string", required: true },
      count: {
        type: "number",
        required: false,
        description: "Number of results (1–10, default 5).",
      },
    },
  },
  {
    name: "save_memory",
    description:
      "Record a short, durable note about the user (preference, environment, recurring need). " +
      "Only call when the user has revealed a stable fact about themselves — not transient chat " +
      "details, not secrets, and not information you could rederive next turn. Prefer one short, " +
      "clearly-titled memory over many overlapping ones.",
    parameters: {
      name: {
        type: "string",
        required: true,
        description: "Short title (≤80 chars)",
      },
      content: {
        type: "string",
        required: true,
        description: "Body of the note (≤2000 chars)",
      },
      kind: {
        type: "string",
        required: false,
        description: "preference | fact | project | reference",
      },
    },
  },
  {
    name: "list_memories",
    description:
      "List persisted memories from the local store. Memories are long-lived notes saved via save_memory. Read-only.",
    parameters: {
      kind: {
        type: "string",
        required: false,
        description: "Optional filter: preference | fact | project | reference",
      },
      limit: {
        type: "number",
        required: false,
        description: "Cap on returned entries (default 20, max 50).",
      },
    },
  },
  {
    name: "recall_memory",
    description:
      "Search persisted memories by substring (case-insensitive match against name + content). " +
      "Returns matching entries with name, kind, and content. Use before answering questions " +
      "that depend on anything the user previously asked you to remember.",
    parameters: {
      query: {
        type: "string",
        required: false,
        description: "Substring to match. Empty/omitted returns all entries (same as list_memories).",
      },
      kind: {
        type: "string",
        required: false,
        description: "Optional filter: preference | fact | project | reference",
      },
      limit: {
        type: "number",
        required: false,
        description: "Cap on returned entries (default 10, max 50).",
      },
    },
  },
  {
    name: "compare_outputs",
    description:
      "Run the same instruction through two lanes — each lane is either a specific adapter (by slug) " +
      "or the plain base model (slug = null). Returns both outputs side-by-side so you can pick one " +
      "or synthesize. Useful for A/B reasoning across LoRAs the user has installed. Each lane runs " +
      "without conversation history, so include any context directly in `instruction`.",
    parameters: {
      instruction: {
        type: "string",
        required: true,
        description: "Self-contained prompt sent to both lanes.",
      },
      slug_a: {
        type: "string",
        required: false,
        description: "Lane A adapter slug. Omit or null for the base model.",
      },
      slug_b: {
        type: "string",
        required: false,
        description: "Lane B adapter slug. Omit or null for the base model.",
      },
      max_tokens: {
        type: "number",
        required: false,
        description: "Per-lane token cap (default uses current settings).",
      },
    },
  },
  {
    name: "use_specialist",
    description:
      "Delegate a subtask to a specialist LoRA adapter. Pass a `slug` from the installed " +
      "adapter catalog the user provided, or leave slug empty / `null` to run on the " +
      "plain base model. `instruction` is the one-shot prompt the specialist receives — " +
      "keep it self-contained; the specialist does not see prior conversation context. " +
      "Returns the specialist's full response as a string. Use this to assemble " +
      "multi-step answers where each step benefits from a different fine-tuned specialist.",
    parameters: {
      slug: {
        type: "string",
        required: false,
        description: "Adapter slug from the installed catalog, or empty/null for the base model.",
      },
      instruction: {
        type: "string",
        required: true,
        description: "Self-contained prompt for the specialist (includes any context it needs).",
      },
    },
  },
];

/** Pulled at call-time so the running agent picks up a freshly-changed
 * provider / key without a restart. */
function readSearchConfig(): { provider: string; apiKey: string } {
  try {
    const raw = localStorage.getItem("lora-hub:settings:v1");
    if (!raw) return { provider: "duckduckgo", apiKey: "" };
    const parsed = JSON.parse(raw) as {
      searchProvider?: string;
      braveApiKey?: string;
    };
    return {
      provider: parsed.searchProvider ?? "duckduckgo",
      apiKey: (parsed.braveApiKey ?? "").trim(),
    };
  } catch {
    return { provider: "duckduckgo", apiKey: "" };
  }
}

export type ToolRunResult = {
  status: "success" | "error" | "denied";
  output?: string;
  error?: string;
  truncated?: boolean;
};

type DirEntry = { name: string; kind: string; size: number };
type GrepMatch = { file: string; line: number; text: string };
type CommandResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
  truncated: boolean;
};
type HttpResponseRaw = {
  status: number;
  body: string;
  headers: Record<string, string>;
  truncated: boolean;
};

/** Heuristic: does this error string look like a permission refusal from
 * our Rust tools module? We classify those as "denied" so the UI can
 * distinguish "model tried something it can't" from "tool broke." */
function looksDenied(msg: string): boolean {
  return (
    msg.includes("not allowed under") ||
    msg.includes("not in the Standard preset") ||
    msg.includes("deny list") ||
    msg.includes("outside workspace") ||
    msg.includes("must be relative")
  );
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolRunResult> {
  try {
    switch (name) {
      case "read_file": {
        const out = await invoke<string>("tool_read_file", { path: args.path });
        return { status: "success", output: out };
      }
      case "write_file": {
        const bytes = await invoke<number>("tool_write_file", {
          path: args.path,
          content: args.content,
        });
        return { status: "success", output: `wrote ${bytes} bytes to ${args.path}` };
      }
      case "edit_file": {
        const r = await invoke<{ bytes_written: number }>("tool_edit_file", {
          path: args.path,
          oldString: args.old_string,
          newString: args.new_string,
        });
        return {
          status: "success",
          output: `edited ${args.path} (${r.bytes_written} bytes)`,
        };
      }
      case "list_dir": {
        const entries = await invoke<DirEntry[]>("tool_list_dir", {
          path: args.path ?? null,
        });
        const lines = entries.map((e) => {
          const flag = e.kind === "dir" ? "d" : e.kind === "symlink" ? "l" : "-";
          const size = e.kind === "file" ? `  ${e.size}B` : "";
          return `${flag}  ${e.name}${size}`;
        });
        return {
          status: "success",
          output: lines.length > 0 ? lines.join("\n") : "(empty directory)",
        };
      }
      case "glob": {
        const paths = await invoke<string[]>("tool_glob", { pattern: args.pattern });
        return {
          status: "success",
          output: paths.length > 0 ? paths.join("\n") : "(no matches)",
        };
      }
      case "grep": {
        const matches = await invoke<GrepMatch[]>("tool_grep", {
          pattern: args.pattern,
          path: args.path ?? null,
        });
        return {
          status: "success",
          output:
            matches.length > 0
              ? matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n")
              : "(no matches)",
        };
      }
      case "run_command": {
        const result = await invoke<CommandResult>("tool_run_command", {
          cmd: args.cmd,
          args: (args.args as unknown[] | undefined) ?? [],
          cwd: args.cwd ?? null,
        });
        const parts = [`exit ${result.exit_code}`];
        if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
        if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
        return {
          status: "success",
          output: parts.join("\n\n"),
          truncated: result.truncated,
        };
      }
      case "http_fetch": {
        const response = await invoke<HttpResponseRaw>("tool_http_fetch", {
          url: args.url,
          method: args.method ?? "GET",
          headers: args.headers ?? null,
          body: args.body ?? null,
        });
        return {
          status: "success",
          output: `HTTP ${response.status}\n\n${response.body}`,
          truncated: response.truncated,
        };
      }
      case "fetch_page": {
        const r = await invoke<{
          url: string;
          title: string;
          markdown: string;
          truncated: boolean;
        }>("tool_fetch_page", { url: String(args.url ?? "") });
        const header = r.title ? `# ${r.title}\n${r.url}\n\n` : `${r.url}\n\n`;
        return {
          status: "success",
          output: header + r.markdown,
          truncated: r.truncated,
        };
      }
      case "web_search": {
        const { provider, apiKey } = readSearchConfig();
        if (provider === "brave" && !apiKey) {
          return {
            status: "denied",
            error:
              "web_search (brave): API key missing — set it in Settings → Integrations, or switch the provider to DuckDuckGo.",
          };
        }
        const hits = await invoke<
          { title: string; url: string; snippet: string }[]
        >("tool_web_search", {
          query: String(args.query ?? ""),
          count: typeof args.count === "number" ? args.count : null,
          provider,
          apiKey: apiKey || null,
        });
        const body =
          hits.length > 0
            ? hits
                .map(
                  (h, i) =>
                    `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`,
                )
                .join("\n\n")
            : "(no results)";
        return { status: "success", output: body };
      }
      case "save_memory": {
        const mem = await invoke<{ name: string }>("memory_tool_save", {
          name: String(args.name ?? ""),
          content: String(args.content ?? ""),
          kind: (args.kind as string | undefined) ?? null,
          source: (args.source as string | undefined) ?? null,
        });
        return {
          status: "success",
          output: `saved memory "${mem.name}"`,
        };
      }
      case "list_memories": {
        const kind = asOptionalString(args.kind);
        const limit = clampLimit(args.limit, 20, 50);
        const all = await listMemories();
        const filtered = kind
          ? all.filter((m) => (m.kind ?? "") === kind)
          : all;
        const out = formatMemoryList(filtered.slice(0, limit));
        return { status: "success", output: out };
      }
      case "recall_memory": {
        const query = asOptionalString(args.query)?.toLowerCase() ?? "";
        const kind = asOptionalString(args.kind);
        const limit = clampLimit(args.limit, 10, 50);
        const all = await listMemories();
        const filtered = all.filter((m) => {
          if (kind && (m.kind ?? "") !== kind) return false;
          if (!query) return true;
          return (
            m.name.toLowerCase().includes(query) ||
            m.content.toLowerCase().includes(query)
          );
        });
        const out = formatMemoryList(filtered.slice(0, limit));
        return { status: "success", output: out };
      }
      case "compare_outputs":
        // Intentional: this tool needs sidecar.generate + React state
        // (settings, downloadedAdapters, status). Handled inside the turn
        // runners that own that context. Reaching this branch = a config bug.
        return {
          status: "error",
          error:
            "compare_outputs must be handled by the calling turn runner, not runTool.",
        };
      case "use_specialist":
        // Intentional: this tool can't dispatch via the Tauri invoke path
        // because it needs to hot-swap the LoRA and call sidecar.generate
        // directly. Handle it inside runSpecialistTurn, which has access
        // to the sidecar client. Reaching this branch = a config bug.
        return {
          status: "error",
          error:
            "use_specialist must be handled by the specialist turn runner, not runTool.",
        };
      default:
        return { status: "error", error: `unknown tool: ${name}` };
    }
  } catch (e) {
    const msg = typeof e === "string" ? e : String(e);
    return {
      status: looksDenied(msg) ? "denied" : "error",
      error: msg,
    };
  }
}

function asOptionalString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function clampLimit(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  if (n <= 0) return fallback;
  return Math.min(n, max);
}

function formatMemoryList(mems: Memory[]): string {
  if (mems.length === 0) return "(no memories)";
  return mems
    .map((m) => {
      const label = m.kind ? `[${m.kind}]` : "[note]";
      const body =
        m.content.length > 240
          ? m.content.slice(0, 240) + "…"
          : m.content;
      return `- ${label} ${m.name} — ${body.replace(/\s+/g, " ")}`;
    })
    .join("\n");
}
