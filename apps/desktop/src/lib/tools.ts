import { invoke } from "@tauri-apps/api/core";
import type { ToolDef } from "./sidecar";

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
