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
];

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
