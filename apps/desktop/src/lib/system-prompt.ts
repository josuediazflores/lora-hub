import type { Memory } from "./memory";

const MEMORY_SYSTEM_BUDGET = 4_000;

export function currentDateContext(): string {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // ignore — some exotic runtimes don't expose this
  }
  return `Today is ${iso} (${weekday}). The user's local timezone is ${tz}. Use this as ground truth for any time-sensitive question — "tomorrow", "next week", "this year" — and when deciding whether to run a fresh web_search.`;
}

export function buildSystemMessage(
  systemPrompt: string,
  memories: Memory[],
  learnedRules: string[] = [],
): string {
  const prompt = systemPrompt.trim();
  const dateLine = currentDateContext();
  const toolGuidance = prompt
    ? ""
    : "When a tool has required parameters the user didn't specify, fill them with your best plausible guess and state the assumption in one short sentence. Prefer running the tool to asking a clarifying question.";
  const cleanedRules = Array.from(
    new Set(learnedRules.map((r) => r.trim()).filter((r) => r.length > 0)),
  );
  const learnedBlock =
    cleanedRules.length > 0
      ? [
          "Style preferences (learned from your past A/B picks — treat each as a soft rule):",
          ...cleanedRules.map((r) => `- ${r}`),
        ].join("\n")
      : "";

  if (!memories.length) {
    const parts = [prompt, toolGuidance, dateLine, learnedBlock].filter(
      (s) => s.length > 0,
    );
    return parts.join("\n\n");
  }

  const lines = ["The user has recorded the following durable notes about themselves. Use them to personalize responses; don't repeat them back verbatim unless asked."];
  const baseBytes =
    (prompt ? prompt.length + 2 : 0) +
    (toolGuidance ? toolGuidance.length + 2 : 0) +
    dateLine.length +
    2 +
    (learnedBlock.length ? learnedBlock.length + 2 : 0);
  let bytes = baseBytes + lines[0].length;
  const sortedOldestFirst = [...memories].sort((a, b) => a.updated_at - b.updated_at);
  for (const m of sortedOldestFirst) {
    const suffix = m.kind ? ` (${m.kind})` : "";
    const line = `- ${m.name}: ${m.content}${suffix}`;
    if (bytes + line.length + 1 > MEMORY_SYSTEM_BUDGET) break;
    lines.push(line);
    bytes += line.length + 1;
  }
  const memoryBlock = lines.join("\n");
  const parts = [prompt, toolGuidance, dateLine, learnedBlock, memoryBlock].filter(
    (s) => s.length > 0,
  );
  return parts.join("\n\n");
}
