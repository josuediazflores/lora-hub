import type { Attachment } from "./attachments";
import type { ToolCallMessage } from "../components/ToolCallBubble";
import type { SpecialistStepMessage } from "../components/SpecialistStepBubble";
import type { SpecialistPlanMessage } from "../components/SpecialistPlanBubble";
import type { ABComparisonMessage } from "../components/ABComparePane";

export type {
  ToolCallMessage,
  SpecialistStepMessage,
  SpecialistPlanMessage,
  ABComparisonMessage,
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: Attachment[];
  adapter?: string | null;
  pending?: boolean;
  progress?: { desc: string; percent: number; n: number; total: number } | null;
};

export type ComparisonMessage = {
  id: string;
  role: "comparison";
  prompt: string;
  adapter: string;
  baseText: string;
  adapterText: string;
  pending: "base" | "adapter" | null;
};

export type MemoryChipMessage = {
  id: string;
  role: "memory_chip";
  name: string;
  kind?: string | null;
  status: "saved" | "denied" | "error";
  detail?: string;
};

export type AnyMessage =
  | Message
  | ComparisonMessage
  | ToolCallMessage
  | MemoryChipMessage
  | SpecialistStepMessage
  | SpecialistPlanMessage
  | ABComparisonMessage;

export type AdapterEntryMerged = {
  name: string;
  path: string;
  base_sha: string | null;
  downloaded_only: boolean;
};

export type Status = {
  base_model_id: string | null;
  base_sha: string | null;
  active_adapter: string | null;
  adapters: { name: string; path: string; base_sha: string | null }[];
};

export type Chat = {
  id: string;
  title: string;
  messages: AnyMessage[];
  pinned?: boolean;
};

export type PersistedChat = {
  id: string;
  title: string;
  messages: AnyMessage[];
  pinned?: boolean;
};
