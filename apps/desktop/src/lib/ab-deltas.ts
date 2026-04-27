/**
 * Preset pool of "delta" rules that the opportunistic A/B tuning flow
 * mixes into the user's system prompt. Each delta represents one small,
 * additive instruction: a tone shift, format change, or register tweak.
 * When the user prefers a variation, the `rule` text is appended to
 * `settings.learnedRules` and folded back into the system prompt on
 * every future turn.
 *
 * Keep entries minimal and non-overlapping — we want each A/B offer to
 * feel like a distinct choice, not a reshuffle of the same idea.
 */

export type ABDelta = {
  id: string;
  /** Short human-facing label (e.g. "more concise"). Shown in pane headers + the pick bar. */
  name: string;
  /** One-line description shown under the title in the turn gutter. */
  description: string;
  /** The exact instruction appended to the system prompt when the user picks this variation. */
  rule: string;
};

export const AB_DELTAS: ABDelta[] = [
  {
    id: "concise",
    name: "more concise",
    description: "cut fluff, skip preamble",
    rule: "Answer directly and concisely. Skip restatement of the question and skip preamble.",
  },
  {
    id: "warm",
    name: "warmer tone",
    description: "friendlier register",
    rule: "Use a warm, friendly register — as if speaking with a trusted colleague.",
  },
  {
    id: "technical",
    name: "more technical",
    description: "assume the reader has background",
    rule: "Assume the reader is technically fluent; skip basic background explanations.",
  },
  {
    id: "stepwise",
    name: "step-by-step",
    description: "numbered sequential format",
    rule: "When giving instructions or explanations with multiple parts, format them as short numbered steps.",
  },
  {
    id: "examples",
    name: "concrete examples",
    description: "always cite a worked example",
    rule: "Support claims with at least one concrete, worked example whenever possible.",
  },
  {
    id: "plain",
    name: "plain language",
    description: "strip jargon",
    rule: "Avoid jargon. Prefer plain, everyday words where they fit the meaning.",
  },
  {
    id: "formal",
    name: "formal tone",
    description: "professional register",
    rule: "Use a formal, professional register. Avoid contractions and casual phrasing.",
  },
  {
    id: "brief-reason",
    name: "brief reasoning",
    description: "one-line why before the answer",
    rule: "Before your answer, state in one short sentence why you're answering this way.",
  },
];

/**
 * Stateful picker. Keeps a small ring buffer of recently-offered delta IDs
 * so consecutive A/B turns don't repeat the same suggestion. Caller owns
 * the ref; we mutate it in place.
 */
export function selectNextDelta(
  recentIds: string[],
  pool: ABDelta[] = AB_DELTAS,
  avoid = 2,
): ABDelta {
  const banned = new Set(recentIds.slice(-avoid));
  const candidates = pool.filter((d) => !banned.has(d.id));
  const choices = candidates.length > 0 ? candidates : pool;
  const pick = choices[Math.floor(Math.random() * choices.length)];
  recentIds.push(pick.id);
  if (recentIds.length > 8) recentIds.splice(0, recentIds.length - 8);
  return pick;
}
