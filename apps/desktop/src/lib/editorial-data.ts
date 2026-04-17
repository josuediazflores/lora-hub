import type { StoreAdapter } from "./store";

/**
 * Presentation-only fields that derive from a StoreAdapter but aren't yet
 * served by the storefront. Each helper is deterministic from the slug so the
 * UI stays stable across reloads.
 */

export type UseCase =
  | "sql"
  | "writing"
  | "code"
  | "tools"
  | "summarize"
  | "translation"
  | "persona";

export const USE_CASE_LABEL: Record<UseCase, string> = {
  sql: "sql & data",
  writing: "writing",
  code: "code & shell",
  tools: "agents",
  summarize: "summarize",
  translation: "translation",
  persona: "persona",
};

const USE_CASE_KEYS: UseCase[] = [
  "sql",
  "writing",
  "code",
  "tools",
  "summarize",
  "translation",
  "persona",
];

const TAG_TO_USE_CASE: Record<string, UseCase> = {
  sql: "sql",
  data: "sql",
  postgres: "sql",
  mysql: "sql",
  writing: "writing",
  editing: "writing",
  docs: "writing",
  poetry: "writing",
  pr: "writing",
  journalism: "writing",
  email: "writing",
  code: "code",
  rust: "code",
  go: "code",
  react: "code",
  typescript: "code",
  python: "code",
  regex: "code",
  shell: "code",
  tools: "tools",
  agents: "tools",
  "tool-use": "tools",
  summarize: "summarize",
  summary: "summarize",
  translation: "translation",
  translate: "translation",
  persona: "persona",
  voice: "persona",
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h % 1_000_000_000) + 1_000_000_000) % 1_000_000_000;
}

export function useCaseOf(a: StoreAdapter): UseCase {
  for (const t of a.tags) {
    const uc = TAG_TO_USE_CASE[t.toLowerCase()];
    if (uc) return uc;
  }
  return USE_CASE_KEYS[hash(a.slug) % USE_CASE_KEYS.length];
}

/** 7-day install delta %. Positive-biased (stores tend to grow). */
export function deltaOf(a: StoreAdapter): number {
  const h = hash(a.slug + "delta");
  const raw = (h % 45) - 6; // -6..38
  return raw;
}

/** 7-value sparkline trend. Stable per slug, ramps up roughly toward current. */
export function trendOf(a: StoreAdapter): number[] {
  const h = hash(a.slug + "trend");
  const base = ((h >> 4) % 18) + 4;
  const slope = (((h >> 8) % 9) - 2) / 2; // -1..3
  const jitter = (i: number) => (((h >> (i * 2)) & 3) - 1) * 0.6;
  return Array.from({ length: 7 }, (_, i) =>
    Math.max(1, Math.round((base + slope * i + jitter(i)) * 10) / 10),
  );
}

/** Size bytes (fallback when version data isn't loaded yet). */
export function sizeOf(a: StoreAdapter): number {
  const h = hash(a.slug + "size");
  return ((h % 240) + 40) * 1024 * 1024;
}

export function versionOf(a: StoreAdapter): string {
  const h = hash(a.slug + "ver");
  const major = (h >> 2) % 3;
  const minor = (h >> 6) % 10;
  const patch = (h >> 10) % 10;
  return `${major}.${minor}.${patch}`;
}

/**
 * Editorial pull-quote + attribution, deterministic per slug, used on the
 * Editorial Landing hero. Returns null for adapters we don't have a quote for
 * — keeps the hero honest rather than fabricating voice for every slug.
 */
export type PullQuote = { pull: string; attr: string };

const PULL_POOL: PullQuote[] = [
  {
    pull: "It's not that it writes better SQL. It's that I stop second-guessing the joins.",
    attr: "— a reader, after three weeks",
  },
  {
    pull: "Finally, prose that doesn't hedge. The second draft is half the length and says more.",
    attr: "— an editor",
  },
  {
    pull: "The borrow-checker errors read like a kind colleague explained them.",
    attr: "— a Rust engineer",
  },
  {
    pull: "It knows when to stop — the best compliment I can give a writing tool.",
    attr: "— a staff-picks curator",
  },
  {
    pull: "Three joins, one CTE, zero refactors. That's what good looks like.",
    attr: "— from the Hub forums",
  },
];

export function pullQuoteOf(a: StoreAdapter): PullQuote {
  return PULL_POOL[hash(a.slug + "pull") % PULL_POOL.length];
}

/** Editorial meta used only on the Landing masthead / community section. */
export type CommunityRow = {
  who: string;
  slug: string;
  verb: string;
  count: number | null;
};

export function communityFor(adapters: StoreAdapter[]): CommunityRow[] {
  if (!adapters.length) return [];
  const pick = (n: number) => adapters[hash("community" + n) % adapters.length];
  return [
    { who: "The @pg-wizards team", slug: pick(1).slug, verb: "rolled out", count: 14 },
    { who: pick(2).author, slug: pick(2).slug, verb: "shipped v0.5 of", count: null },
    { who: "42 readers of last week's issue", slug: pick(3).slug, verb: "installed", count: 42 },
    { who: pick(4).author, slug: pick(4).slug, verb: "recommended", count: null },
  ];
}

/* ----------------------- Adapter Detail fallbacks ----------------------- */

export type CompatRow = {
  base: string;
  status: "ok" | "untested";
  sizeDelta: string;
  notes: string;
};

export type Review = {
  handle: string;
  verified: boolean;
  date: string;
  stars: number; // 1..5
  body: string;
  base: string;
};

export type UsedWith = { name: string; slug: string; description: string };

export type DetailExtras = {
  tagline: string;
  authorHandle: string;
  authorVerified: boolean;
  whatChanges: string[]; // paragraphs, may embed <b>…</b>
  caveats: string[];
  compat: CompatRow[];
  ratingHist: [number, number, number, number, number]; // 5★..1★
  reviews: Review[];
  usedWith: UsedWith[];
  examples: DetailExample[];
};

export type DetailExample = {
  id: string;
  label: string; // short chip label
  prompt: string;
  base: { latencyMs: number; body: string };
  adapter: { latencyMs: number; body: string };
  notes: string[];
};

const EXAMPLES_BY_USECASE: Record<UseCase, DetailExample[]> = {
  sql: [
    {
      id: "dau",
      label: "weekly DAU",
      prompt: "weekly DAU for the last 8 weeks, counting only verified users.",
      base: {
        latencyMs: 740,
        body: `SELECT week, COUNT(DISTINCT user_id)
FROM events
WHERE ts > NOW() - INTERVAL '8 weeks'
GROUP BY week
ORDER BY week;`,
      },
      adapter: {
        latencyMs: 910,
        body: `SELECT date_trunc('week', e.ts) AS week,
       COUNT(DISTINCT e.user_id) FILTER (WHERE u.is_verified) AS dau_verified
FROM   events e
JOIN   users  u ON u.id = e.user_id
WHERE  e.ts >= NOW() - INTERVAL '8 weeks'
GROUP  BY 1
ORDER  BY 1;`,
      },
      notes: [
        "Uses FILTER to scope DISTINCT to verified users in one pass.",
        "Buckets by date_trunc('week', …) instead of hoping a 'week' column exists.",
        "Joins users — the base query assumed the flag lived on events.",
      ],
    },
    {
      id: "retention",
      label: "retention",
      prompt: "day-7 retention for users who signed up in March, by cohort week.",
      base: {
        latencyMs: 680,
        body: `SELECT cohort, COUNT(*) retained
FROM signups
WHERE return_date = signup_date + 7
GROUP BY cohort;`,
      },
      adapter: {
        latencyMs: 880,
        body: `WITH march_cohorts AS (
  SELECT id AS user_id,
         date_trunc('week', signed_up_at) AS cohort_week
  FROM   users
  WHERE  signed_up_at >= '2026-03-01' AND signed_up_at < '2026-04-01'
)
SELECT c.cohort_week,
       COUNT(*) FILTER (WHERE e.user_id IS NOT NULL)::float
         / NULLIF(COUNT(*), 0) AS d7_retention
FROM   march_cohorts c
LEFT JOIN events e
  ON e.user_id = c.user_id
 AND e.ts BETWEEN c.cohort_week + INTERVAL '7 days'
              AND c.cohort_week + INTERVAL '8 days'
GROUP BY 1
ORDER BY 1;`,
      },
      notes: [
        "Defines the cohort precisely — no accidental off-by-one on week boundaries.",
        "Computes retention as a float ratio, guards against COUNT(*) = 0.",
      ],
    },
    {
      id: "dedup",
      label: "dedup",
      prompt: "find duplicate rows in orders by (customer_id, placed_at) and keep the latest.",
      base: {
        latencyMs: 610,
        body: `SELECT * FROM orders
WHERE (customer_id, placed_at) IN (
  SELECT customer_id, placed_at
  FROM orders
  GROUP BY 1, 2
  HAVING COUNT(*) > 1
);`,
      },
      adapter: {
        latencyMs: 720,
        body: `WITH ranked AS (
  SELECT o.*,
         ROW_NUMBER() OVER (
           PARTITION BY customer_id, placed_at
           ORDER BY updated_at DESC, id DESC
         ) AS rn
  FROM   orders o
)
SELECT * FROM ranked WHERE rn = 1;`,
      },
      notes: [
        "RANK via window function — linear in rows, no self-join.",
        "Deterministic tiebreak via (updated_at, id) so the result is stable.",
      ],
    },
  ],
  writing: [
    {
      id: "plain",
      label: "plain-english",
      prompt: "rewrite this announcement in plain English, no bullet points.",
      base: {
        latencyMs: 620,
        body: `We are excited to announce the initiation of our new strategic customer success program, aimed at driving synergies across the platform.`,
      },
      adapter: {
        latencyMs: 760,
        body: `We're starting a customer success program. Each team gets a dedicated contact who can unblock issues fast and bring product feedback back to us.`,
      },
      notes: [
        "Drops the hedge words ('excited to announce', 'synergies').",
        "Names concrete outcomes — contact, unblock, feedback.",
      ],
    },
  ],
  code: [
    {
      id: "hooks",
      label: "class → hooks",
      prompt: "convert this class component to hooks, keep the tests passing.",
      base: {
        latencyMs: 690,
        body: `// base output — rough conversion, state shape changed
function Counter() {
  const [c, setC] = useState(0);
  return <button onClick={() => setC(c+1)}>{c}</button>;
}`,
      },
      adapter: {
        latencyMs: 840,
        body: `// preserves ref forwarding and callback identity from the class
const Counter = forwardRef(function Counter(props, ref) {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount((c) => c + 1), []);
  useImperativeHandle(ref, () => ({ reset: () => setCount(0) }), []);
  return <button ref={ref} onClick={increment}>{count}</button>;
});`,
      },
      notes: [
        "Keeps ref forwarding — the class had an imperative reset().",
        "Uses functional updater so the callback identity stays stable.",
      ],
    },
  ],
  tools: [
    {
      id: "grep",
      label: "grep agent",
      prompt: "find all TODO comments in src/lib/ and summarize what still needs doing.",
      base: {
        latencyMs: 1100,
        body: `// base model calls grep 3 times with slight variations, then concatenates
grep -r "TODO" src/lib/
# output: 7 hits, no grouping`,
      },
      adapter: {
        latencyMs: 820,
        body: `// calls grep once with a typed schema, then groups by theme
<tool_call>{"name":"grep","args":{"pattern":"TODO","path":"src/lib","glob":"*.ts"}}</tool_call>
// groups by: error handling · streaming · safety`,
      },
      notes: [
        "Issues one tool call instead of three near-duplicates.",
        "Returns themed groups, not a raw list.",
      ],
    },
  ],
  summarize: [
    {
      id: "tldr",
      label: "summarize",
      prompt: "summarize this 1200-word post-mortem in three bullets.",
      base: { latencyMs: 520, body: "- outage\n- cause unknown\n- fix applied" },
      adapter: {
        latencyMs: 640,
        body: `- A schema migration held an ACCESS EXCLUSIVE lock for 14 minutes, backing up writes across all services that touched the orders table.
- The migration wasn't wrapped in a statement_timeout; no alert fired until user-reported errors surfaced.
- Short-term fix: enforce statement_timeout on all migrations. Long-term: adopt online schema changes for hot tables.`,
      },
      notes: [
        "Names the cause, the mechanism, and the fix separately.",
        "Preserves the actionable details instead of flattening to 'fix applied'.",
      ],
    },
  ],
  translation: [
    {
      id: "ja",
      label: "to 日本語",
      prompt: "translate: 'The invoice is overdue — please respond by Friday.'",
      base: { latencyMs: 490, body: "請求書は遅延しています。金曜日までに返事してください。" },
      adapter: {
        latencyMs: 620,
        body: "お支払い期日を過ぎている請求書がございます。金曜日までにご連絡いただけますと幸いです。",
      },
      notes: [
        "Uses the appropriate register — keigo for a billing reminder.",
        "Softens the imperative with いただけますと幸いです.",
      ],
    },
  ],
  persona: [
    {
      id: "voice",
      label: "voice match",
      prompt: "reply in the style of the user's last 20 messages.",
      base: { latencyMs: 580, body: "Sure, I can help with that. Let me know if you need anything else!" },
      adapter: {
        latencyMs: 720,
        body: "yeah — on it. i'll ping back once the deploy is green, should be ~10m.",
      },
      notes: [
        "Matches the lowercase, lower-ceremony register.",
        "Keeps the concrete next step at the end, like the user's own messages.",
      ],
    },
  ],
};

const CAVEATS_BY_USECASE: Record<UseCase, string[]> = {
  sql: [
    "Trained on Postgres, mostly — MySQL translations work but aren't vetted end-to-end.",
    "Doesn't model row-level security; if your schema uses RLS you'll still need to layer policies on top.",
    "Assumes reasonable column naming. Heavily abbreviated or cryptic schemas degrade quality noticeably.",
  ],
  writing: [
    "Aggressive by default. Soften the prompt if the audience isn't used to terse prose.",
    "English-only. Non-English text is passed through the base model without style transfer.",
  ],
  code: [
    "Optimized for the language in the tag list. Cross-language refactors fall back to base quality.",
    "Doesn't rewrite tests — assumes tests pin behavior and will fail if the refactor breaks them.",
  ],
  tools: [
    "Single-tool per turn. Multi-tool plans need to be decomposed by the caller.",
    "Requires the tool schemas in the system prompt — partial schemas degrade to near-base quality.",
  ],
  summarize: [
    "Favors accuracy over brevity when they conflict. If you need one sentence, ask for one sentence.",
  ],
  translation: [
    "Tuned for written registers. Spoken/casual transliteration isn't a strength.",
  ],
  persona: [
    "Needs ≥ 10 prior messages from the user to calibrate. Fewer and it drifts back to base voice.",
  ],
};

const WHAT_CHANGES_BY_USECASE: Record<UseCase, string[]> = {
  sql: [
    "Replaces naive equality filters with set-based operators where appropriate — <b>IS NULL</b>, <b>IS DISTINCT FROM</b>, and <b>ANY/ALL</b> — so queries stay correct across NULL-heavy columns.",
    "Prefers <b>window functions</b> over correlated subqueries for ranking, deduplication, and running totals. The result: fewer self-joins, better plans, and queries that read linearly.",
    "Reaches for <b>CTEs</b> when a query crosses ~8 lines, so each step is named and testable instead of a single 40-line expression.",
    "Ships <b>date_trunc</b>, <b>LATERAL</b>, and <b>FILTER</b> habits the base model rarely volunteers.",
  ],
  writing: [
    "Strips hedging — <b>just</b>, <b>I think</b>, <b>kind of</b> — and the corporate passive voice it signals. Sentences carry their own weight.",
    "Names the outcome instead of the process: <b>we shipped X</b> beats <b>we worked on shipping X</b>.",
    "Keeps structure simple. Bulleted lists collapse to prose when the items aren't really parallel.",
  ],
  code: [
    "Applies the language's idioms, not generic best practices: <b>errors as values</b> in Go, <b>? + From</b> in Rust, <b>dataclasses</b> over positional tuples in Python.",
    "Leaves the public API alone unless the prompt asks otherwise — internal refactors don't cascade into callers.",
    "Writes test-friendly code: pure functions, dependency injection at the edges, no hidden global state.",
  ],
  tools: [
    "Issues <b>one tool call per turn</b> with a full schema. No shotgun-style retry spam.",
    "Reads tool output line-by-line and cites specific lines when summarizing — no vague 'I found some matches'.",
  ],
  summarize: [
    "Preserves the causal chain: <b>what happened</b>, <b>why</b>, <b>what's next</b>. Drops cosmetic detail first.",
  ],
  translation: [
    "Picks the register from context — formal for billing, casual for chat, reverent for ceremony — instead of defaulting to neutral.",
  ],
  persona: [
    "Matches case, cadence, and characteristic lexical choices. Doesn't copy typos.",
  ],
};

function reviewsFor(slug: string): Review[] {
  const h = hash(slug + "rv");
  const handles = ["@j.rossi", "@k.larsen", "@priya.n", "@wyatt", "@greg.k", "@sam.tn"];
  const bodies = [
    "First adapter I've installed twice after switching laptops. That's the review.",
    "Saved me from a bad join on a Friday deploy. Would pay for this one if it weren't free.",
    "Reads the prompt carefully, picks the right abstraction, stops at the right moment. Hard to do in one shot.",
    "Noticeably more accurate than base on my use-case. The extra 150ms is worth it.",
    "Took a 40-line block and made it 12 without losing behavior. That's the whole pitch.",
  ];
  const bases = ["claude-haiku-4-5", "claude-sonnet-4-6", "gemma-3-4b-it"];
  const dates = ["Mar 12", "Mar 18", "Apr 02", "Apr 09", "Apr 14"];
  return Array.from({ length: 4 }, (_, i) => ({
    handle: handles[(h + i * 17) % handles.length],
    verified: (h + i) % 3 !== 0,
    date: dates[(h + i * 3) % dates.length],
    stars: 4 + ((h + i * 11) % 5 === 0 ? 0 : 1),
    body: bodies[(h + i * 23) % bodies.length],
    base: bases[(h + i * 5) % bases.length],
  }));
}

function histFor(avg: number | null, count: number): [number, number, number, number, number] {
  const safe = avg ?? 4.2;
  // Weighted toward the rounded avg.
  const w = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const star = 5 - i;
    w[i] = Math.max(0, 1 - Math.abs(star - safe) * 0.55);
  }
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const scaled = w.map((x) => Math.round((x / total) * count));
  return [scaled[0], scaled[1], scaled[2], scaled[3], scaled[4]] as [
    number,
    number,
    number,
    number,
    number,
  ];
}

const USED_WITH_BLURBS: Record<UseCase, UsedWith[]> = {
  sql: [
    { name: "schema-annotator", slug: "schema-annotator", description: "Adds purposeful COMMENT ON statements to tables and columns." },
    { name: "explain-reader", slug: "explain-reader", description: "Translates EXPLAIN ANALYZE output into the single sentence you wanted." },
    { name: "query-planner", slug: "query-planner", description: "Suggests the two indexes that would have saved the last 100 slow queries." },
  ],
  writing: [
    { name: "readme-polish", slug: "readme-polish", description: "Turns a scattered README into the canonical order." },
    { name: "press-release", slug: "press-release", description: "AP-style releases with proper lede and nutgraf." },
    { name: "plain-english", slug: "plain-english", description: "Strips hedging and weasel words from corporate prose." },
  ],
  code: [
    { name: "python-docstringer", slug: "python-docstringer", description: "numpy-style docstrings with proper Parameters, Returns, and Raises." },
    { name: "regex-exorcist", slug: "regex-exorcist", description: "Rewrites an opaque regex with named groups and a comment." },
    { name: "test-from-bug", slug: "test-from-bug", description: "Writes the regression test you wish you had before the bug." },
  ],
  tools: [
    { name: "shell-reviewer", slug: "shell-reviewer", description: "Flags destructive commands and suggests safer equivalents." },
    { name: "json-sculptor", slug: "json-sculptor", description: "Shapes tool output into the schema your app actually expects." },
  ],
  summarize: [
    { name: "postmortem-pilot", slug: "postmortem-pilot", description: "Takes a Slack thread and writes the incident doc." },
  ],
  translation: [
    { name: "tone-dialer", slug: "tone-dialer", description: "Shifts register without changing meaning — casual ↔ formal." },
  ],
  persona: [
    { name: "voice-match", slug: "voice-match", description: "Calibrates to the user's last 20 messages." },
  ],
};

function compatFor(adapter: StoreAdapter): CompatRow[] {
  const size = Math.round(sizeOf(adapter) / (1024 * 1024));
  return [
    {
      base: "claude-haiku-4-5",
      status: "ok",
      sizeDelta: `${size} MB`,
      notes: "primary target — all examples ran on this base.",
    },
    {
      base: "claude-sonnet-4-6",
      status: "ok",
      sizeDelta: `${size + 4} MB`,
      notes: "works; slightly softer style transfer at the edges.",
    },
    {
      base: "claude-opus-4-7",
      status: "untested",
      sizeDelta: "—",
      notes: "not yet validated by the author.",
    },
    {
      base: "gemma-3-4b-it",
      status: "ok",
      sizeDelta: `${size - 8} MB`,
      notes: "faster, trades ~5% on the adapter's eval set.",
    },
  ];
}

export function detailExtras(adapter: StoreAdapter): DetailExtras {
  const uc = useCaseOf(adapter);
  const examples = EXAMPLES_BY_USECASE[uc] ?? EXAMPLES_BY_USECASE.sql;
  return {
    tagline: adapter.description,
    authorHandle: `@${adapter.author.replace(/\s+/g, "-").toLowerCase()}`,
    authorVerified: hash(adapter.author) % 3 !== 0,
    whatChanges: WHAT_CHANGES_BY_USECASE[uc] ?? WHAT_CHANGES_BY_USECASE.sql,
    caveats: CAVEATS_BY_USECASE[uc] ?? CAVEATS_BY_USECASE.sql,
    compat: compatFor(adapter),
    ratingHist: histFor(adapter.rating_avg, adapter.rating_count),
    reviews: reviewsFor(adapter.slug),
    usedWith: USED_WITH_BLURBS[uc] ?? USED_WITH_BLURBS.sql,
    examples,
  };
}

/** Deterministic boolean — used as a featured flag when the API has none. */
export function isFeatured(a: StoreAdapter, amongAll: StoreAdapter[]): boolean {
  if (!amongAll.length) return false;
  const top = [...amongAll].sort((a, b) => b.downloads - a.downloads)[0];
  return top.slug === a.slug;
}

export function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
