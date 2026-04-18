import { invoke, Channel } from "@tauri-apps/api/core";

let _seq = 0;
function nextId(): string {
  _seq += 1;
  return `${Date.now().toString(36)}-${_seq.toString(36)}`;
}

export type SidecarToken = { id: string; type: "token"; text: string };
export type SidecarProgress = {
  id: string;
  type: "progress";
  stage: string;
  desc?: string;
  n?: number;
  total?: number;
  percent?: number;
  final?: boolean;
};
export type SidecarToolCall = {
  id: string;
  type: "tool_call";
  call_id: string;
  name: string;
  args: Record<string, unknown>;
};
export type SidecarToolError = {
  id: string;
  type: "tool_error";
  error: string;
};
export type SidecarDone = { id: string; type: "done"; result: unknown };
export type SidecarError = {
  id: string;
  type: "error";
  error: { code: string; message: string };
};
export type SidecarMessage =
  | SidecarToken
  | SidecarProgress
  | SidecarToolCall
  | SidecarToolError
  | SidecarDone
  | SidecarError;

export type ToolParamDef = {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  description?: string;
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, ToolParamDef>;
};

export type Request = Record<string, unknown>;

export interface StreamHandlers {
  onToken?: (msg: SidecarToken) => void;
  onProgress?: (msg: SidecarProgress) => void;
  onToolCall?: (msg: SidecarToolCall) => void;
  onToolError?: (msg: SidecarToolError) => void;
}

export async function send(
  request: Request,
  handlers: StreamHandlers = {},
): Promise<SidecarDone | SidecarError> {
  return new Promise((resolve, reject) => {
    const ch = new Channel<SidecarMessage>();
    ch.onmessage = (msg) => {
      switch (msg.type) {
        case "token":
          handlers.onToken?.(msg);
          break;
        case "progress":
          handlers.onProgress?.(msg);
          break;
        case "tool_call":
          handlers.onToolCall?.(msg);
          break;
        case "tool_error":
          handlers.onToolError?.(msg);
          break;
        case "done":
          resolve(msg);
          break;
        case "error":
          resolve(msg);
          break;
      }
    };
    invoke("sidecar_send", { request, channel: ch }).catch(reject);
  });
}

export async function status() {
  return send({ op: "status" });
}

export async function loadBase(
  modelId: string,
  opts: { onProgress?: (msg: SidecarProgress) => void } = {},
) {
  return send({ op: "load_base", model_id: modelId }, { onProgress: opts.onProgress });
}

export async function loadAdapter(name: string, adapterPath: string) {
  return send({ op: "load_adapter", name, adapter_path: adapterPath });
}

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type GenerateHandle = {
  id: string;
  result: Promise<SidecarDone | SidecarError>;
};

export function generate(
  prompt: string,
  opts: {
    adapter?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    messages?: ChatMessage[];
    onToken?: (text: string) => void;
    /** Run as if no adapter were active — sidecar zeroes LoRA weights for
     * the duration of the call, then restores them. Used by compare mode. */
    baseOnly?: boolean;
    /** When set, a tool-use preamble is injected into the prompt; the
     * stream will surface `tool_call` / `tool_error` events. */
    tools?: ToolDef[];
    onToolCall?: (call: SidecarToolCall) => void;
    onToolError?: (err: SidecarToolError) => void;
  } = {},
): GenerateHandle {
  const id = nextId();
  const result = send(
    {
      id,
      op: "generate",
      prompt,
      adapter: opts.adapter ?? null,
      max_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.7,
      top_p: opts.topP ?? 0.95,
      messages: opts.messages ?? null,
      base_only: opts.baseOnly ?? false,
      tools: opts.tools ?? null,
    },
    {
      onToken: (m) => opts.onToken?.(m.text),
      onToolCall: (m) => opts.onToolCall?.(m),
      onToolError: (m) => opts.onToolError?.(m),
    },
  );
  return { id, result };
}

export async function abortGeneration(targetId: string) {
  return send({ op: "abort_generation", target_id: targetId });
}

export async function makeTestAdapter(outDir: string, seed: number) {
  return send({ op: "make_test_adapter", out_dir: outDir, seed });
}

export async function unloadAdapter(name: string) {
  return send({ op: "unload_adapter", name });
}
