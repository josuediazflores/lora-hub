/**
 * Parses the raw model output into thought vs final-answer segments.
 *
 * Gemma's thinking mode emits channel markers:
 *   <|channel>thought ... <channel|>final answer
 *
 * The exact tokens vary by tokenizer template — pipes can appear on either
 * side (`<|channel|>` vs `<channel|>` vs `<|channel>`), whitespace and the
 * literal word "thought" may or may not follow. We match all those shapes
 * forgivingly so a firmware update doesn't silently regress the UI.
 *
 * Always safe to call on arbitrary model output. When no markers are
 * detected (e.g. base models, adapters not tuned for thinking), the raw
 * text is returned as `answer` and `thought` is null.
 */

export type ThinkingPhase = "thought" | "answer" | "done";

export type ParsedThinking = {
  /** Everything emitted inside the thought channel, trimmed. Null when no
   * thought-channel marker has appeared. */
  thought: string | null;
  /** Everything the user should see — text before any thought marker plus
   * text after the switch to the answer channel. */
  answer: string;
  /** Which channel the model is currently streaming into — used to choose
   * disclosure open/closed defaults during streaming. "done" once parsing
   * sees the answer switch AND the caller says streaming is finished. */
  phase: ThinkingPhase;
};

/**
 * Match the opening `thought` marker. Accepts any of:
 *   <|channel|>thought        (canonical pipe-both-sides)
 *   <|channel>thought         (pipe-left only)
 *   <channel|>thought         (pipe-right only, seen in Gemma output)
 *   <channel>thought          (no pipes)
 * Followed by optional whitespace / newline.
 */
const THOUGHT_START = /<\|?channel\|?>\s*thought\b\s*/;

/**
 * Match the channel-switch marker to the final-answer stream. Same shape
 * tolerance, but without the literal "thought" word. Must appear *after*
 * the thought opener — we anchor from that point in `parseThinking`.
 */
const CHANNEL_SWITCH = /<\|?channel\|?>(?!\s*thought\b)/;

/**
 * @param raw   model output so far — may be mid-stream.
 * @param done  true once the sidecar signals the turn is complete. Used
 *              to distinguish "answer still arriving" from "answer done".
 */
export function parseThinking(raw: string, done = false): ParsedThinking {
  const thoughtStart = raw.match(THOUGHT_START);
  if (!thoughtStart) {
    // No thinking markers — behave like today.
    return {
      thought: null,
      answer: raw,
      phase: done ? "done" : "answer",
    };
  }

  const startIdx = thoughtStart.index ?? 0;
  const afterOpener = startIdx + thoughtStart[0].length;
  const preamble = raw.slice(0, startIdx);

  // Search for the channel-switch marker *after* the opener so we never
  // eat the opener itself as a switch.
  const tail = raw.slice(afterOpener);
  const switchMatch = tail.match(CHANNEL_SWITCH);

  if (!switchMatch) {
    // Still streaming the thought — answer is only whatever preamble text
    // came before the thought opener.
    return {
      thought: tail.trim() || null,
      answer: preamble.trim(),
      phase: "thought",
    };
  }

  const switchIdx = switchMatch.index ?? 0;
  const thoughtText = tail.slice(0, switchIdx).trim();
  const answerText = tail.slice(switchIdx + switchMatch[0].length);

  // Splice preamble + post-switch so any stray prefix text survives.
  const combinedAnswer =
    preamble.trim().length > 0
      ? `${preamble.trim()}\n\n${answerText}`
      : answerText;

  return {
    thought: thoughtText || null,
    answer: combinedAnswer,
    phase: done ? "done" : "answer",
  };
}
