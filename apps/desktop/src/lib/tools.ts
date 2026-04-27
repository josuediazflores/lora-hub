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
    name: "search_flights",
    description:
      "PRIMARY TOOL for any flight query. ALWAYS use this — not web_search, not fetch_page — when " +
      "the user asks to find, book, price, or compare flights between airports. Returns structured, " +
      "live flight data: airline, times, stops, duration, price. The chat UI renders results as a " +
      "rich card, so this is much better than dumping search links. " +
      "Relative dates are fine: if the user says 'in 3 weeks' or 'next Friday', compute the concrete " +
      "YYYY-MM-DD date yourself (today's date is in the system prompt) and pass it as departure_date. " +
      "If the user gives a city name instead of an airport code (e.g. 'London'), pick the primary IATA " +
      "code ('LHR' for London, 'JFK' for New York, 'LAX' for Los Angeles, etc.) and proceed — do not " +
      "ask for clarification. For one-way, omit return_date. For round-trip with a duration like " +
      "'week-long', set return_date = departure_date + duration. " +
      "If the user omits details (no origin, no destination, no date), DO NOT ask for clarification — " +
      "fill in plausible defaults (origin 'SJC' unless memory overrides; a popular destination matching " +
      "the user's vibe; a departure ~30 days from today) and state your assumptions in one short " +
      "sentence alongside the call so the user can correct them.",
    parameters: {
      origin: {
        type: "string",
        required: true,
        description: "Departure airport IATA code, e.g. 'JFK'.",
      },
      destination: {
        type: "string",
        required: true,
        description: "Arrival airport IATA code, e.g. 'LHR'.",
      },
      departure_date: {
        type: "string",
        required: true,
        description: "Outbound date in YYYY-MM-DD format.",
      },
      return_date: {
        type: "string",
        required: false,
        description: "Return date in YYYY-MM-DD format. Omit for one-way.",
      },
      cabin_class: {
        type: "string",
        required: false,
        description: "ECONOMY | PREMIUM_ECONOMY | BUSINESS | FIRST.",
      },
      max_stops: {
        type: "string",
        required: false,
        description: "ANY | NON_STOP | ONE_STOP | TWO_PLUS_STOPS.",
      },
      airlines: {
        type: "array",
        required: false,
        description: "Optional allow-list of airline IATA codes, e.g. ['BA', 'AA'].",
      },
      sort_by: {
        type: "string",
        required: false,
        description: "CHEAPEST | DURATION | DEPARTURE_TIME | ARRIVAL_TIME.",
      },
      passengers: {
        type: "number",
        required: false,
        description: "Number of adult passengers (default 1).",
      },
    },
  },
  {
    name: "search_dates",
    description:
      "PRIMARY TOOL for 'cheapest dates to fly' queries. ALWAYS use this — not web_search — when " +
      "the user wants the cheapest travel dates across a flexible range (e.g. 'cheapest week in May', " +
      "'best time to fly to Paris this summer'). Returns a list of date candidates ranked by price. " +
      "Convert relative phrases ('this summer', 'next month') to concrete start_date / end_date in " +
      "YYYY-MM-DD yourself. Pick a primary IATA airport code if the user gives a city name — do not " +
      "ask for clarification. " +
      "If the request is vague (no origin, no destination, no dates), DO NOT ask for clarification — " +
      "propose a plausible plan and call the tool anyway. Defaults: origin 'SJC' unless memory says " +
      "otherwise; destination is a popular airport matching the user's vibe (e.g. NRT Japan, CDG Paris, " +
      "LHR London, LAX LA, MEX Mexico City, CUN Cancún); date range spans ~30 days starting 30 days " +
      "from today; trip_duration 7; is_round_trip true. State your assumptions in one short sentence " +
      "alongside the call so the user can correct them.",
    parameters: {
      origin: {
        type: "string",
        required: true,
        description: "Departure airport IATA code.",
      },
      destination: {
        type: "string",
        required: true,
        description: "Arrival airport IATA code.",
      },
      start_date: {
        type: "string",
        required: true,
        description: "Start of date range in YYYY-MM-DD.",
      },
      end_date: {
        type: "string",
        required: true,
        description: "End of date range in YYYY-MM-DD.",
      },
      trip_duration: {
        type: "number",
        required: false,
        description: "Trip duration in days, for round-trips.",
      },
      is_round_trip: {
        type: "boolean",
        required: false,
        description: "True for round-trip; false/omitted for one-way.",
      },
      cabin_class: {
        type: "string",
        required: false,
        description: "ECONOMY | PREMIUM_ECONOMY | BUSINESS | FIRST.",
      },
      passengers: {
        type: "number",
        required: false,
        description: "Number of adult passengers (default 1).",
      },
    },
  },
  {
    name: "web_search",
    description:
      "Search the web. Returns up to 10 hits as {title, url, snippet}. " +
      "SNIPPETS ARE PREVIEWS, NOT ANSWERS — after reviewing the results, call fetch_page on " +
      "the URL most likely to contain what the user asked for, then answer from that page's " +
      "content. Do not answer a factual question from snippets alone. Use when the user asks " +
      "about current events, weather, docs, recent news — anything time-sensitive or " +
      "outside your training data. " +
      "DO NOT use for flight searches — use search_flights or search_dates instead; those return " +
      "structured, live flight data directly.",
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
  {
    name: "list_adapters",
    description:
      "List LoRA adapters installed on this machine, with which one (if any) is currently active. " +
      "Use this BEFORE calling activate_adapter if you're unsure which slug to use, or to show the " +
      "user what's available. Returns a JSON array of {slug, active}. Cheap — no network, no extra " +
      "model call.",
    parameters: {},
  },
  {
    name: "activate_adapter",
    description:
      "Attach a LoRA adapter by slug so your NEXT reply in this same turn is generated through it — " +
      "no second user message needed. Enforces one-at-a-time: activating replaces any currently-active " +
      "adapter. Use only when the user explicitly asks for a different specialist/style, or when you " +
      "genuinely need a different capability (e.g. a code specialist for a code question). Don't swap " +
      "speculatively. If the slug isn't installed, call list_adapters first and pick from the results.",
    parameters: {
      slug: {
        type: "string",
        required: true,
        description: "Exact adapter slug, e.g. 'opus-reasoning-e4b'. Case-sensitive.",
      },
    },
  },
  {
    name: "deactivate_adapter",
    description:
      "Detach the currently-active adapter and run as pure base on subsequent replies (until the user " +
      "or you re-activate one). Use when the current adapter is the wrong fit, or when the user asks " +
      "to go back to the base model. No-op if no adapter is active.",
    parameters: {
      unload: {
        type: "boolean",
        required: false,
        description:
          "If true, also evict the adapter from the sidecar cache (frees memory; re-activation will " +
          "be slower). Defaults to false — cached, fast to reattach.",
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
      case "search_flights": {
        try {
          const fliResult = await invoke<FliMcpResult>("mcp_fli_call", {
            toolName: "search_flights",
            args: buildFliFlightsArgs(args),
          });
          const flights = adaptFliFlights(fliResult, args);
          return { status: "success", output: JSON.stringify(flights) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "search_dates": {
        try {
          const fliResult = await invoke<FliMcpResult>("mcp_fli_call", {
            toolName: "search_dates",
            args: buildFliDatesArgs(args),
          });
          const dates = adaptFliDates(fliResult, args);
          return { status: "success", output: JSON.stringify(dates) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
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
      case "list_adapters":
      case "activate_adapter":
      case "deactivate_adapter":
        // Intentional: these need status / setStatus / downloadedAdapters /
        // ensureAdapterAttached, plus they must mutate the turn runner's
        // local `currentAdapter` so the next step picks up the new adapter.
        // Handled inside runNormalTurn; reaching this branch = a config bug.
        return {
          status: "error",
          error: `${name} must be handled by the calling turn runner, not runTool.`,
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

/** fli-mcp `tools/call` response envelope. */
type FliMcpResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

/** Decoded body of a successful search_flights or search_dates call. */
type FliDecoded = {
  success?: boolean;
  error?: string;
  flights?: FliFlight[];
  dates?: FliDatePrice[];
  date_prices?: FliDatePrice[];
};

type FliFlight = {
  price: number;
  currency?: string;
  legs: FliLeg[];
};

type FliLeg = {
  departure_airport: string;
  arrival_airport: string;
  departure_time: string; // ISO "YYYY-MM-DDTHH:MM:SS"
  arrival_time: string;
  duration: number; // minutes
  airline: string;
  airline_code: string;
  flight_number?: string;
};

type FliDatePrice = {
  // fli returns `date` as a tuple — `[dep]` for one-way, `[dep, ret]` for
  // round-trip — which JSON-serializes to an array of ISO strings. Older/
  // alternative builds may return a plain string. Accept both.
  date?: string | string[];
  departure_date?: string;
  return_date?: string | null;
  price?: number;
  price_usd?: number;
  currency?: string;
};

function buildFliFlightsArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    origin: String(args.origin ?? "").toUpperCase(),
    destination: String(args.destination ?? "").toUpperCase(),
    departure_date: args.departure_date,
  };
  if (args.return_date) out.return_date = args.return_date;
  if (args.cabin_class) out.cabin_class = args.cabin_class;
  if (args.max_stops) out.max_stops = args.max_stops;
  if (args.sort_by) out.sort_by = args.sort_by;
  if (Array.isArray(args.airlines) && args.airlines.length) {
    out.airlines = args.airlines;
  }
  return out;
}

function buildFliDatesArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    origin: String(args.origin ?? "").toUpperCase(),
    destination: String(args.destination ?? "").toUpperCase(),
    start_date: args.start_date,
    end_date: args.end_date,
  };
  if (args.trip_duration != null) out.trip_duration = args.trip_duration;
  if (args.is_round_trip != null) out.is_round_trip = args.is_round_trip;
  if (args.cabin_class) out.cabin_class = args.cabin_class;
  if (args.passengers != null) out.passengers = args.passengers;
  return out;
}

function decodeFli(result: FliMcpResult): FliDecoded {
  if (result.isError) {
    const text = result.content?.[0]?.text ?? "unknown fli error";
    throw new Error(text);
  }
  const text = result.content?.[0]?.text;
  if (!text) return {};
  try {
    return JSON.parse(text) as FliDecoded;
  } catch {
    // Some fli builds put the structured body at structuredContent; fall back.
    if (result.structuredContent && typeof result.structuredContent === "object") {
      return result.structuredContent as FliDecoded;
    }
    return {};
  }
}

function adaptFliFlights(
  result: FliMcpResult,
  args: Record<string, unknown>,
): FlightResultShape[] {
  const decoded = decodeFli(result);
  if (decoded.error) throw new Error(decoded.error);
  const flights = decoded.flights ?? [];

  const origin = String(args.origin ?? "").toUpperCase();
  const destination = String(args.destination ?? "").toUpperCase();
  const returnDate = args.return_date as string | undefined;
  const departureDate = args.departure_date as string | undefined;

  const adapted: FlightResultShape[] = [];
  for (const f of flights) {
    const outbound = sliceOutboundLegs(f.legs, destination);
    if (outbound.length === 0) continue;
    const first = outbound[0];
    const last = outbound[outbound.length - 1];
    const totalDuration =
      (new Date(last.arrival_time).getTime() -
        new Date(first.departure_time).getTime()) /
      60000;
    adapted.push({
      airline_code: first.airline_code,
      airline_name: first.airline,
      origin,
      destination,
      departure_time: extractHHMM(first.departure_time),
      arrival_time: extractHHMM(last.arrival_time),
      duration_minutes: Math.round(
        totalDuration > 0
          ? totalDuration
          : outbound.reduce((sum, l) => sum + (l.duration || 0), 0),
      ),
      stops: Math.max(0, outbound.length - 1),
      price_usd: Math.round(f.price),
      booking_url: buildGoogleFlightsUrl(
        origin,
        destination,
        departureDate,
        returnDate,
      ),
    });
  }
  return adapted;
}

function adaptFliDates(
  result: FliMcpResult,
  args: Record<string, unknown>,
): DateResultShape[] {
  const decoded = decodeFli(result);
  if (decoded.error) throw new Error(decoded.error);
  const raw = decoded.dates ?? decoded.date_prices ?? [];
  const origin = String(args.origin ?? "").toUpperCase();
  const destination = String(args.destination ?? "").toUpperCase();
  const tripDuration =
    typeof args.trip_duration === "number" ? Math.floor(args.trip_duration) : 7;

  const out: DateResultShape[] = [];
  for (const entry of raw) {
    // `entry.date` is fli's raw tuple-turned-array: [dep] for one-way,
    // [dep, ret] for round-trip. Fall through to the flat fields for
    // older/alternative builds that use `departure_date` / `return_date`.
    const tupleDep = Array.isArray(entry.date) ? entry.date[0] : undefined;
    const tupleRet =
      Array.isArray(entry.date) && entry.date.length > 1 ? entry.date[1] : undefined;
    const depRaw =
      entry.departure_date ??
      tupleDep ??
      (typeof entry.date === "string" ? entry.date : undefined);
    const dep = toIsoDate(depRaw);
    if (!dep) continue;
    const retExplicit = toIsoDate(entry.return_date ?? tupleRet);
    let ret = retExplicit;
    if (!ret) {
      const retDate = new Date(dep);
      if (Number.isNaN(retDate.getTime())) continue;
      retDate.setDate(retDate.getDate() + tripDuration);
      ret = retDate.toISOString().slice(0, 10);
    }
    const price = entry.price_usd ?? entry.price ?? 0;
    out.push({
      departure_date: dep,
      return_date: ret,
      price_usd: Math.round(price),
      booking_url: buildGoogleFlightsUrl(origin, destination, dep, ret),
    });
  }
  return out;
}

/** Coerce fli's datetime-ish strings to a YYYY-MM-DD date. Returns null on failure. */
function toIsoDate(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  // Fast path: already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // "2026-05-04T00:00:00" or similar — strip the time.
  const slice = v.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(slice)) return slice;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function sliceOutboundLegs(legs: FliLeg[], destination: string): FliLeg[] {
  if (legs.length === 0) return [];
  // Find the first leg whose arrival matches the destination city. That's
  // the end of the outbound journey. All legs up to and including it.
  const destLower = destination.toLowerCase();
  for (let i = 0; i < legs.length; i++) {
    if (
      legs[i].arrival_airport.toLowerCase().includes(destLower) ||
      airportNameImpliesCode(legs[i].arrival_airport, destination)
    ) {
      return legs.slice(0, i + 1);
    }
  }
  return legs;
}

/** Very loose match: airport name contains the IATA code or a common synonym. */
function airportNameImpliesCode(name: string, code: string): boolean {
  const synonyms: Record<string, string[]> = {
    LHR: ["heathrow"],
    LGW: ["gatwick"],
    JFK: ["kennedy"],
    LGA: ["laguardia"],
    EWR: ["newark"],
    LAX: ["los angeles"],
    CDG: ["charles de gaulle"],
    ORY: ["orly"],
    NRT: ["narita"],
    HND: ["haneda"],
  };
  const lower = name.toLowerCase();
  if (lower.includes(code.toLowerCase())) return true;
  const syns = synonyms[code.toUpperCase()] ?? [];
  return syns.some((s) => lower.includes(s));
}

function extractHHMM(iso: string): string {
  // ISO "YYYY-MM-DDTHH:MM:SS" — take the HH:MM part
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : iso;
}

function buildGoogleFlightsUrl(
  origin: string,
  destination: string,
  depart: string | undefined,
  ret: string | undefined,
): string {
  const base = `https://www.google.com/travel/flights?q=`;
  const dep = depart ?? "";
  const r = ret ?? "";
  const q = `flights+from+${origin}+to+${destination}${
    dep ? `+on+${dep}` : ""
  }${r ? `+returning+${r}` : ""}`;
  return base + q;
}

function stringifyFliError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

type FlightResultShape = {
  airline_code: string;
  airline_name: string;
  origin: string;
  destination: string;
  departure_time: string;
  arrival_time: string;
  duration_minutes: number;
  stops: number;
  price_usd: number;
  booking_url?: string;
};

type DateResultShape = {
  departure_date: string;
  return_date?: string;
  price_usd: number;
  booking_url?: string;
};

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
