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
export type SidecarDone = { id: string; type: "done"; result: unknown };
export type SidecarError = {
  id: string;
  type: "error";
  error: { code: string; message: string };
};
export type SidecarMessage =
  | SidecarToken
  | SidecarProgress
  | SidecarDone
  | SidecarError;

export type Request = Record<string, unknown>;

export interface StreamHandlers {
  onToken?: (msg: SidecarToken) => void;
  onProgress?: (msg: SidecarProgress) => void;
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

export type ChatMessage = { role: "user" | "assistant"; content: string };

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
    },
    { onToken: (m) => opts.onToken?.(m.text) },
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
