import type { ReactNode } from "react";
import { createElement } from "react";
import {
  FlightResultsCard,
  type FlightResult,
} from "../components/FlightResultsCard";
import {
  DateHeatmapCard,
  type DateResult,
} from "../components/DateHeatmapCard";

export type ToolResultRenderer = (
  output: string,
  args: Record<string, unknown>,
) => ReactNode | null;

export const TOOL_RESULT_RENDERERS: Record<string, ToolResultRenderer> = {
  search_flights: (output, args) => {
    const parsed = safeParse<FlightResult[]>(output);
    if (!parsed || !Array.isArray(parsed)) return null;
    return createElement(FlightResultsCard, {
      results: parsed,
      query: {
        origin: args.origin as string | undefined,
        destination: args.destination as string | undefined,
        departure_date: args.departure_date as string | undefined,
        return_date: args.return_date as string | undefined,
        sort_by: args.sort_by as string | undefined,
      },
    });
  },
  search_dates: (output, args) => {
    const parsed = safeParse<DateResult[]>(output);
    if (!parsed || !Array.isArray(parsed)) return null;
    return createElement(DateHeatmapCard, {
      results: parsed,
      query: {
        origin: args.origin as string | undefined,
        destination: args.destination as string | undefined,
        trip_duration: args.trip_duration as number | undefined,
        is_round_trip: args.is_round_trip as boolean | undefined,
      },
    });
  },
};

export const TOOL_LABELS: Record<string, string> = {
  search_flights: "Search flights",
  search_dates: "Search dates",
  read_file: "Read file",
  write_file: "Write file",
  edit_file: "Edit file",
  list_dir: "List directory",
  glob: "Find files",
  grep: "Search code",
  run_command: "Run command",
  http_fetch: "Fetch URL",
  fetch_page: "Fetch page",
  web_search: "Web search",
  save_memory: "Save memory",
  list_memories: "List memories",
  recall_memory: "Recall memory",
  compare_outputs: "Compare outputs",
  use_specialist: "Use specialist",
};

export const TOOL_BRANDS: Record<string, string> = {
  search_flights: "fl",
  search_dates: "fl",
  read_file: "rd",
  write_file: "wr",
  edit_file: "ed",
  list_dir: "ls",
  glob: "fd",
  grep: "gr",
  run_command: "sh",
  http_fetch: "ht",
  fetch_page: "pg",
  web_search: "ws",
  save_memory: "sv",
  list_memories: "ls",
  recall_memory: "rc",
  compare_outputs: "ab",
  use_specialist: "sp",
};

export function labelForTool(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function brandForTool(name: string): string {
  if (TOOL_BRANDS[name]) return TOOL_BRANDS[name];
  const cleaned = name.replace(/[^a-z0-9]/gi, "");
  return cleaned.slice(0, 2).toLowerCase() || "tl";
}

function safeParse<T>(s: string | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
