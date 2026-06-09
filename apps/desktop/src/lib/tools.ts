import { invoke } from "@tauri-apps/api/core";
import type { ToolDef } from "./sidecar";
import { listMemories, type Memory } from "./memory";
import { useChatStore } from "./chat-store";
import {
  requestCommandApproval,
  requestActionApproval,
} from "./permission-bridge";

/**
 * Money-moving Stripe tools require explicit per-call user confirmation before
 * they run — mirroring the run_command approval. There is intentionally no
 * `sessionKey`, so there's no "allow this session" blanket approval: every
 * money operation re-prompts. Returns true when the user approves.
 */
async function confirmStripeAction(
  title: string,
  details: string,
): Promise<boolean> {
  const decision = await requestActionApproval({ title, details });
  return decision !== "denied";
}

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
    name: "parse_receipt",
    description:
      "OCR a receipt photo into raw text + heuristic line items. Use FIRST when the user uploads a " +
      "receipt image and asks to split it. Returns {raw_text, suggested_items: [{name, price}]}. " +
      "After this, refine the suggested items into a clean list and call split_bill. Requires " +
      "tesseract installed locally (brew install tesseract on macOS).",
    parameters: {
      image_path: {
        type: "string",
        required: true,
        description: "Absolute filesystem path to a JPEG/PNG receipt image.",
      },
    },
  },
  {
    name: "split_bill",
    description:
      "Compute per-person totals from itemized assignments. Pure math, no API calls. Use AFTER " +
      "parse_receipt (or when the user gives items + people directly). " +
      "items[i].price is in MAJOR units (dollars), not minor units. " +
      "assignments maps item index (as a string) OR item name to a list of person names; '*' means " +
      "everyone. Items with no assignment default to '*'. " +
      "tip_strategy: 'even' (split equally) or 'proportional' (by subtotal). " +
      "Pass `description` (e.g. \"Dinner at Mama's\") so downstream cards / payment links can label themselves. " +
      "Returns {per_person: [{name, subtotal, tax, tip, total}], grand_total, description}. " +
      "AFTER THIS RETURNS, the rendered card has its own 'Create payment links' button — you don't need to " +
      "auto-call create_split_payment_links. Just describe the split in one short sentence and let the user click.",
    parameters: {
      items: {
        type: "array",
        required: true,
        description: "Array of {name, price} where price is in major units (dollars).",
      },
      people: {
        type: "array",
        required: true,
        description: "Full list of participant names (case-sensitive).",
      },
      assignments: {
        type: "object",
        required: false,
        description:
          "Map of item index (string) or name to list of person names. '*' = everyone.",
      },
      tip: {
        type: "number",
        required: false,
        description: "Tip amount in major units (dollars). Defaults to 0.",
      },
      tax: {
        type: "number",
        required: false,
        description: "Tax amount in major units (dollars). Defaults to 0.",
      },
      tip_strategy: {
        type: "string",
        required: false,
        description: "'even' (default) | 'proportional'.",
      },
      tax_strategy: {
        type: "string",
        required: false,
        description: "'proportional' (default) | 'even'.",
      },
      description: {
        type: "string",
        required: false,
        description: "Short label for the bill (e.g. \"Dinner at Mama's\"). Echoed back so cards can use it.",
      },
    },
  },
  {
    name: "create_split_payment_links",
    description:
      "USE THIS (not create_payment_link) whenever there are multiple payers. Creates one Stripe " +
      "Payment Link per payer, each tagged with metadata.split_id so split_status can attribute " +
      "payments back. Calling create_payment_link N times is WRONG — those won't share a split_id, " +
      "and split_status will return nothing. Use AFTER split_bill, passing through its per_person " +
      "array. per_person[i].total is MAJOR units (dollars). Returns {split_id, currency, links: " +
      "[{name, url, id, amount}]} where amount is minor units. Test mode only.",
    parameters: {
      per_person: {
        type: "array",
        required: true,
        description: "Array of {name, total} from split_bill (totals in major units).",
      },
      description: {
        type: "string",
        required: true,
        description: "Shown on each Stripe Checkout page, e.g. \"Dinner at Mama's\".",
      },
      currency: {
        type: "string",
        required: false,
        description: "ISO 4217 lowercase. Defaults to 'usd'.",
      },
      split_id: {
        type: "string",
        required: false,
        description: "Optional caller-supplied id; auto-generated if omitted.",
      },
    },
  },
  {
    name: "send_payment_requests",
    description:
      "Build prefilled SMS / email / clipboard messages for each payer. Does NOT send anything itself — " +
      "returns URI handlers (sms:..., mailto:...) that the frontend renders as clickable links. " +
      "channel: 'sms' | 'email' | 'clipboard'. requests[i] = {name, contact?, url, amount}.",
    parameters: {
      channel: {
        type: "string",
        required: true,
        description: "'sms' | 'email' | 'clipboard'.",
      },
      requests: {
        type: "array",
        required: true,
        description: "Array of {name, contact?, url, amount} (amount in minor units).",
      },
      description: {
        type: "string",
        required: false,
        description: "Bill description used in the message body.",
      },
    },
  },
  {
    name: "split_status",
    description:
      "Poll Stripe for charges tagged with this split_id and report who has paid. Use after " +
      "create_split_payment_links to check progress, or whenever the user asks 'who paid yet?'. " +
      "Returns {split_id, paid: [{name, amount, paid_at, charge_id}]}.",
    parameters: {
      split_id: {
        type: "string",
        required: true,
        description: "split_id from create_split_payment_links's response.",
      },
      limit: {
        type: "number",
        required: false,
        description: "How many recent charges to scan (1–100, default 50).",
      },
    },
  },
  {
    name: "create_payment_link",
    description:
      "ONE-OFF single-payer payment links only. DO NOT use for splitting a bill across multiple " +
      "people — for that, use create_split_payment_links after split_bill. Use this when the user " +
      "asks for a single payment URL for a single product/charge (e.g. 'a $20 link for a coffee " +
      "subscription'). Amount is INTEGER MINOR UNITS (e.g. 2000 = $20.00 for USD); never pass " +
      "dollars. Currency is ISO 4217 lowercase (e.g. 'usd'). Expects a sk_test_… key during " +
      "development — every call mutates real Stripe state. Returns {url, id, amount, currency}.",
    parameters: {
      amount: {
        type: "number",
        required: true,
        description: "Integer minor units (e.g. 2000 = $20.00 for USD).",
      },
      currency: {
        type: "string",
        required: true,
        description: "ISO 4217 lowercase, e.g. 'usd'.",
      },
      description: {
        type: "string",
        required: true,
        description: "Product name shown on the Stripe checkout page.",
      },
    },
  },
  {
    name: "create_invoice",
    description:
      "Create, finalize, and email a Stripe invoice to a customer. Use when the user " +
      "asks to bill a customer by email. Per-item amount is INTEGER MINOR UNITS. " +
      "Expects a sk_test_… key during development — every call mutates real Stripe " +
      "state and sends an email. Returns {id, hosted_invoice_url, amount_due, status}.",
    parameters: {
      customer_email: {
        type: "string",
        required: true,
        description: "Email of the customer to bill (created if not found).",
      },
      line_items: {
        type: "array",
        required: true,
        description:
          "Array of {description, amount, quantity?, currency?}. amount is integer minor units.",
      },
      due_date: {
        type: "string",
        required: true,
        description: "Due date in YYYY-MM-DD (UTC).",
      },
    },
  },
  {
    name: "list_transactions",
    description:
      "List the most recent Stripe charges. Read-only. Use when the user asks to see " +
      "recent payments / transactions / charges. Default 10, max 100. Returns " +
      "{charges: [{id, amount, currency, status, description, created}]}.",
    parameters: {
      limit: {
        type: "number",
        required: false,
        description: "Number of charges to return (1–100, default 10).",
      },
    },
  },
  {
    name: "create_subscription",
    description:
      "Create a recurring Stripe subscription. Use when the user asks to subscribe a customer to a recurring " +
      "charge (e.g. monthly/yearly billing). Auto-creates a fresh customer with a Stripe TEST CLOCK and " +
      "pm_card_visa attached, so the subscription is immediately ACTIVE and can be fast-forwarded later via " +
      "advance_test_clock. Amount is INTEGER MINOR UNITS per interval (2000 = $20.00 USD). " +
      "Test mode only. Returns {id, customer_id, customer_email, test_clock_id, amount, currency, interval, " +
      "interval_count, status, current_period_end, latest_invoice_url}.",
    parameters: {
      customer_email: { type: "string", required: true, description: "Email of the customer to bill." },
      amount: {
        type: "number",
        required: true,
        description: "Recurring amount per interval, integer minor units (e.g. 2000 = $20.00 USD).",
      },
      currency: {
        type: "string",
        required: false,
        description: "ISO 4217 lowercase, e.g. 'usd'. Defaults to 'usd'.",
      },
      interval: {
        type: "string",
        required: false,
        description: "'day' | 'week' | 'month' | 'year'. Defaults to 'month'.",
      },
      interval_count: {
        type: "number",
        required: false,
        description: "Multiplier on interval (e.g. interval='month' + interval_count=3 → quarterly).",
      },
      description: {
        type: "string",
        required: false,
        description: "Product name shown on invoices.",
      },
    },
  },
  {
    name: "list_subscriptions",
    description:
      "List recent Stripe subscriptions across all statuses (active, canceled, past_due, etc.). " +
      "Read-only. Includes test-clock subscriptions (which Stripe excludes from default listings). " +
      "Returns {subscriptions: [{id, customer_email, amount, currency, interval, status, " +
      "current_period_end, test_clock_id}]}.",
    parameters: {
      limit: {
        type: "number",
        required: false,
        description: "Number of subscriptions to return (1–100, default 10).",
      },
    },
  },
  {
    name: "cancel_subscription",
    description:
      "Cancel a Stripe subscription. Default cancels immediately; pass immediately=false to cancel at " +
      "the end of the current billing period. Returns {id, status, canceled_at, cancel_at_period_end}.",
    parameters: {
      subscription_id: {
        type: "string",
        required: true,
        description: "Stripe subscription id, e.g. 'sub_…'.",
      },
      immediately: {
        type: "boolean",
        required: false,
        description: "True (default) cancels immediately; false sets cancel_at_period_end.",
      },
    },
  },
  {
    name: "advance_test_clock",
    description:
      "Fast-forward a Stripe TEST CLOCK by N months (1–24) to simulate billing cycles passing. Use after " +
      "create_subscription if the user asks to 'simulate a year of billing', 'fast-forward 6 months', etc. " +
      "NON-BLOCKING: returns immediately with status='advancing'. After calling, poll get_test_clock until " +
      "status='ready' (typically 5–60s for 1mo, 60–120s for 12mo), then re-call list_subscriptions and " +
      "list_transactions to see the simulated cycles. Returns {clock_id, frozen_time, status}.",
    parameters: {
      clock_id: {
        type: "string",
        required: true,
        description: "Test clock id from create_subscription's response, e.g. 'clock_…'.",
      },
      by_months: {
        type: "number",
        required: false,
        description: "Months to advance (1–24, default 1).",
      },
    },
  },
  {
    name: "get_test_clock",
    description:
      "Read current state of a Stripe test clock. Use to poll after advance_test_clock until status='ready'. " +
      "Returns {clock_id, frozen_time, status}, where status is 'ready' | 'advancing' | 'internal_failure'.",
    parameters: {
      clock_id: {
        type: "string",
        required: true,
        description: "Test clock id, e.g. 'clock_…'.",
      },
    },
  },
  {
    name: "refund_payment",
    description:
      "Refund a Stripe charge in full (omit amount) or partially (integer minor units). " +
      "Use when the user asks to refund a specific charge by id. Expects a sk_test_… " +
      "key during development — refunds mutate real Stripe state. Returns " +
      "{id, amount, status}.",
    parameters: {
      charge_id: {
        type: "string",
        required: true,
        description: "Stripe charge id, e.g. 'ch_…'.",
      },
      amount: {
        type: "number",
        required: false,
        description: "Partial refund amount in integer minor units. Omit for full refund.",
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
 * provider / key without a restart. Reads from the live settings store — the
 * previous implementation read a dead `lora-hub:settings:v1` localStorage key
 * (settings moved into the zustand store), so the user's provider/key choice
 * was silently ignored and search always fell back to DuckDuckGo. */
function readSearchConfig(): { provider: string; apiKey: string } {
  try {
    const s = useChatStore.getState().settings;
    return {
      provider: s.searchProvider ?? "duckduckgo",
      apiKey: (s.braveApiKey ?? "").trim(),
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
        const cmdArgs = ((args.args as unknown[] | undefined) ?? []).map((a) =>
          String(a),
        );
        const cwd = (args.cwd as string | undefined) ?? null;
        const cmd = String(args.cmd ?? "");
        try {
          const result = await invoke<CommandResult>("tool_run_command", {
            cmd,
            args: cmdArgs,
            cwd,
          });
          const parts = [`exit ${result.exit_code}`];
          if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
          if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
          return {
            status: "success",
            output: parts.join("\n\n"),
            truncated: result.truncated,
          };
        } catch (e) {
          // Allowlist denials surface from is_allowed_command in
          // src-tauri/src/permissions.rs. We pattern-match the exact error
          // text that helper produces ("not in the … allowlist" /
          // "not allowed under the Read-only preset"). ALWAYS_DENY hits
          // ("in the deny list") are *not* upgradeable — surface them as-is.
          const msg = String(e);
          const upgradeable =
            /not in the .* allowlist/i.test(msg) ||
            /not allowed under the Read-only preset/i.test(msg);
          if (!upgradeable) {
            return { status: "error", error: msg };
          }
          const decision = await requestCommandApproval({
            cmd,
            args: cmdArgs,
            cwd,
            reason: msg,
          });
          if (decision === "denied") {
            return { status: "denied", error: msg };
          }
          const result = await invoke<CommandResult>(
            "tool_run_command_approved",
            { cmd, args: cmdArgs, cwd, scope: decision },
          );
          const parts = [`exit ${result.exit_code}`];
          if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
          if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
          return {
            status: "success",
            output: parts.join("\n\n"),
            truncated: result.truncated,
          };
        }
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
      case "create_payment_link": {
        try {
          const approved = await confirmStripeAction(
            "Approve payment link?",
            `Create a Stripe payment link\n\namount: ${String(args.amount)} ${String(args.currency ?? "usd").toUpperCase()}\ndescription: ${String(args.description ?? "")}`,
          );
          if (!approved)
            return { status: "denied", error: "Payment link was not approved." };
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "create_payment_link",
            args: {
              amount: args.amount,
              currency: args.currency,
              description: args.description,
            },
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "create_invoice": {
        try {
          const approved = await confirmStripeAction(
            "Approve invoice?",
            `Create & send a Stripe invoice\n\nto: ${String(args.customer_email ?? "")}\nitems: ${JSON.stringify(args.line_items ?? [])}\ndue: ${String(args.due_date ?? "—")}`,
          );
          if (!approved)
            return { status: "denied", error: "Invoice was not approved." };
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "create_invoice",
            args: {
              customer_email: args.customer_email,
              line_items: args.line_items,
              due_date: args.due_date,
            },
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "list_transactions": {
        try {
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "list_transactions",
            args: { limit: args.limit ?? 10 },
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "refund_payment": {
        try {
          const stripeArgs: Record<string, unknown> = {
            charge_id: args.charge_id,
          };
          if (args.amount != null) stripeArgs.amount = args.amount;
          const approved = await confirmStripeAction(
            "Approve refund?",
            `Refund a Stripe charge\n\ncharge: ${String(args.charge_id ?? "")}\namount: ${args.amount != null ? String(args.amount) : "full"}`,
          );
          if (!approved)
            return { status: "denied", error: "Refund was not approved." };
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "refund_payment",
            args: stripeArgs,
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "create_subscription": {
        try {
          const subArgs: Record<string, unknown> = {
            customer_email: args.customer_email,
            amount: args.amount,
          };
          if (args.currency) subArgs.currency = args.currency;
          if (args.interval) subArgs.interval = args.interval;
          if (args.interval_count != null) subArgs.interval_count = args.interval_count;
          if (args.description) subArgs.description = args.description;
          const approved = await confirmStripeAction(
            "Approve subscription?",
            `Create a Stripe subscription\n\ncustomer: ${String(args.customer_email ?? "")}\namount: ${String(args.amount)} ${String(args.currency ?? "usd").toUpperCase()} / ${String(args.interval ?? "month")}`,
          );
          if (!approved)
            return { status: "denied", error: "Subscription was not approved." };
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "create_subscription",
            args: subArgs,
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "list_subscriptions": {
        try {
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "list_subscriptions",
            args: { limit: args.limit ?? 10 },
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "cancel_subscription": {
        try {
          const cancelArgs: Record<string, unknown> = {
            subscription_id: args.subscription_id,
          };
          if (args.immediately != null) cancelArgs.immediately = args.immediately;
          const approved = await confirmStripeAction(
            "Approve cancellation?",
            `Cancel a Stripe subscription\n\nsubscription: ${String(args.subscription_id ?? "")}\nimmediately: ${String(args.immediately ?? false)}`,
          );
          if (!approved)
            return { status: "denied", error: "Cancellation was not approved." };
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "cancel_subscription",
            args: cancelArgs,
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "advance_test_clock": {
        try {
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "advance_test_clock",
            args: {
              clock_id: args.clock_id,
              by_months: args.by_months ?? 1,
            },
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "get_test_clock": {
        try {
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "get_test_clock",
            args: { clock_id: args.clock_id },
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "parse_receipt": {
        try {
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "parse_receipt",
            args: { image_path: args.image_path },
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "split_bill": {
        try {
          const splitArgs: Record<string, unknown> = {
            items: args.items,
            people: args.people,
          };
          if (args.assignments) splitArgs.assignments = args.assignments;
          if (args.tip != null) splitArgs.tip = args.tip;
          if (args.tax != null) splitArgs.tax = args.tax;
          if (args.tip_strategy) splitArgs.tip_strategy = args.tip_strategy;
          if (args.tax_strategy) splitArgs.tax_strategy = args.tax_strategy;
          if (args.description) splitArgs.description = args.description;
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "split_bill",
            args: splitArgs,
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "create_split_payment_links": {
        try {
          const linkArgs: Record<string, unknown> = {
            per_person: args.per_person,
            description: args.description,
          };
          if (args.currency) linkArgs.currency = args.currency;
          if (args.split_id) linkArgs.split_id = args.split_id;
          const approved = await confirmStripeAction(
            "Approve payment links?",
            `Create Stripe payment links for a bill split\n\nper_person: ${JSON.stringify(args.per_person ?? [])}\ndescription: ${String(args.description ?? "")}`,
          );
          if (!approved)
            return { status: "denied", error: "Payment links were not approved." };
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "create_split_payment_links",
            args: linkArgs,
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "send_payment_requests": {
        try {
          const sendArgs: Record<string, unknown> = {
            channel: args.channel,
            requests: args.requests,
          };
          if (args.description) sendArgs.description = args.description;
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "send_payment_requests",
            args: sendArgs,
          });
          return { status: "success", output: decodeStripe(r) };
        } catch (e) {
          return { status: "error", error: stringifyFliError(e) };
        }
      }
      case "split_status": {
        try {
          const r = await invoke<StripeMcpResult>("mcp_stripe_call", {
            toolName: "split_status",
            args: { split_id: args.split_id, limit: args.limit ?? 50 },
          });
          return { status: "success", output: decodeStripe(r) };
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

/** stripe-mcp `tools/call` response envelope (same shape as fli-mcp). */
type StripeMcpResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

/** Pull the JSON body out of a stripe-mcp response and return it as-is.
 * The model sees the raw JSON string (including any {error: …} envelope from
 * the Python wrappers — they catch StripeError so we don't fall into the
 * MCP isError path). */
function decodeStripe(result: StripeMcpResult): string {
  if (result.isError) {
    return result.content?.[0]?.text ?? "unknown stripe error";
  }
  const text = result.content?.[0]?.text;
  if (text) return text;
  if (result.structuredContent) return JSON.stringify(result.structuredContent);
  return "{}";
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
