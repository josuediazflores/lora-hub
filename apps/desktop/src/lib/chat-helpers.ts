import type { AnyMessage } from "./message-types";
import type { Memory } from "./memory";
import { buildSystemMessage } from "./system-prompt";
import { formatAttachmentsForPrompt } from "./attachments";
import * as sidecar from "./sidecar";

/** Fold chat history into sidecar-ready turns. Comparison messages collapse
 * to their adapter output. Tool-call messages expand into a synthetic
 * assistant turn carrying the call marker followed by a synthetic user turn
 * carrying the tool result, so the model sees prior tool interactions on any
 * follow-up generate. A non-empty `systemPrompt` is prepended as a single
 * `system` role message; the sidecar routes it through the tokenizer's
 * chat template. */
export function buildHistory(
  msgs: AnyMessage[],
  systemPrompt: string = "",
  memories: Memory[] = [],
  learnedRules: string[] = [],
): sidecar.ChatMessage[] {
  const out: sidecar.ChatMessage[] = [];
  const sys = buildSystemMessage(systemPrompt, memories, learnedRules);
  if (sys) out.push({ role: "system", content: sys });
  for (const m of msgs) {
    if (m.role === "comparison") {
      const content = m.adapterText.trim();
      if (content) out.push({ role: "assistant", content });
    } else if (m.role === "memory_chip") {
      continue;
    } else if (m.role === "tool_call") {
      out.push({
        role: "assistant",
        content: `<tool_call>${JSON.stringify({
          name: m.name,
          args: m.args,
        })}</tool_call>`,
      });
      const resultText =
        m.status === "success"
          ? (m.output ?? "")
          : (m.error ?? `[${m.status}]`);
      out.push({
        role: "user",
        content: `[tool result: ${m.name}${
          m.status !== "success" ? " " + m.status : ""
        }]\n${resultText}`,
      });
    } else if (m.role === "ab_comparison") {
      const pickedText =
        m.pick === "variation" ? m.variationText : m.baselineText;
      const assistantContent = pickedText.trim();
      if (assistantContent)
        out.push({ role: "assistant", content: assistantContent });
    } else if (m.role === "specialist_plan") {
      continue;
    } else if (m.role === "specialist_step") {
      const slugLabel = m.slug ?? "base";
      out.push({
        role: "assistant",
        content: `<tool_call>${JSON.stringify({
          name: "use_specialist",
          args: { slug: m.slug, instruction: m.instruction },
        })}</tool_call>`,
      });
      const TAIL = 3200;
      const raw =
        m.status === "success"
          ? m.output
          : m.error ?? m.output ?? `[${m.status}]`;
      const resultText =
        raw.length > TAIL ? raw.slice(0, TAIL) + "\n…truncated…" : raw;
      out.push({
        role: "user",
        content: `[tool result: use_specialist ${slugLabel}${
          m.status !== "success" ? " " + m.status : ""
        }]\n${resultText}`,
      });
    } else if (m.role === "user" || m.role === "assistant") {
      let content = m.text;
      if (m.role === "user" && m.attachments && m.attachments.length) {
        content = content + formatAttachmentsForPrompt(m.attachments);
      }
      content = content.trim();
      if (content) out.push({ role: m.role, content });
    }
  }
  return out;
}

/** Back-of-envelope token count. Proper tokenizers live in the sidecar,
 * but pinging it on every keystroke is wasteful. ~3.8 chars/token
 * (English+code mix) is within ~10% of the HF tokenizer output. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

export function estimateMessageTokens(messages: AnyMessage[]): number {
  let sum = 0;
  for (const m of messages) {
    if (m.role === "comparison") {
      sum += estimateTokens(m.adapterText) + estimateTokens(m.baseText) + 8;
    } else if (m.role === "tool_call") {
      sum +=
        estimateTokens(m.name) +
        estimateTokens(JSON.stringify(m.args)) +
        estimateTokens(m.output ?? "") +
        estimateTokens(m.error ?? "") +
        16;
    } else if (m.role === "memory_chip") {
      continue;
    } else if (m.role === "specialist_step") {
      sum +=
        estimateTokens(m.instruction) +
        estimateTokens(m.output) +
        estimateTokens(m.slug ?? "") +
        16;
    } else if (m.role === "specialist_plan") {
      continue;
    } else if (m.role === "ab_comparison") {
      const picked =
        m.pick === "variation" ? m.variationText : m.baselineText;
      sum += estimateTokens(picked) + 8;
    } else {
      sum += estimateTokens(m.text) + 4;
      if (m.role === "user" && m.attachments) {
        for (const a of m.attachments) {
          sum += estimateTokens(a.text ?? "") + 8;
        }
      }
    }
  }
  return sum;
}

/** Planner adapter slug lookup for Specialist mode. Matches the plan's
 * exact slugs (`opus-reasoning-e2b` / `-e4b`) first, then falls back to any
 * installed adapter whose name contains `opus-reasoning` and the base's
 * size tag. */
export function findPlannerAdapter(
  adapters: { name: string }[],
  baseParams: string | null,
): string | null {
  const size = (baseParams ?? "").toLowerCase();
  const exact =
    size === "e2b" ? "opus-reasoning-e2b" : size === "e4b" ? "opus-reasoning-e4b" : null;
  if (exact && adapters.some((a) => a.name === exact)) return exact;
  for (const a of adapters) {
    const n = a.name.toLowerCase();
    if (!n.includes("opus-reasoning")) continue;
    if (size && !n.includes(size)) continue;
    return a.name;
  }
  return null;
}

/** Context window per base family. Conservative — better to warn at 6.5k
 * when the real cap is 8k than miss a warning. */
export function contextLimitFor(baseId: string | null | undefined): number {
  if (!baseId) return 8192;
  const id = baseId.toLowerCase();
  if (id.includes("gemma-4") || id.includes("gemma4")) return 8192;
  if (id.includes("gemma-3") || id.includes("gemma3")) return 8192;
  if (id.includes("llama-3") || id.includes("llama3")) return 8192;
  return 8192;
}
