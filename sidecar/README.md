# MLX sidecar

Long-running Python process that owns the MLX model and adapter state. Spawned by the Tauri Rust core; speaks JSON-over-stdio.

## Protocol

One JSON object per line in (request), one or more JSON objects per line out (responses / events). Every request carries an `id`; every response echoes that `id`. Streaming responses use `type: "token"` or `type: "progress"` and end with `type: "done"` (or `type: "error"`).

### Requests

```jsonc
// Load a base model. Resolves once weights are loaded.
{"id": "1", "op": "load_base", "model_id": "mlx-community/gemma-3-4b-it-4bit"}

// Load a LoRA adapter into the base. Wraps lora layers on first call,
// then hot-swaps weights on subsequent calls. Hard-rejects if base SHA mismatch.
{"id": "2", "op": "load_adapter", "name": "sql-v1", "adapter_path": "/path/to/dir"}

// Unload a named adapter from the cache.
{"id": "3", "op": "unload_adapter", "name": "sql-v1"}

// Generate. If "adapter" is set, swap to it before generating.
// Streams tokens; ends with "done".
{"id": "4", "op": "generate", "prompt": "...", "adapter": "sql-v1", "max_tokens": 256}

// Sidecar status snapshot.
{"id": "5", "op": "status"}

// Compute SHA-256 fingerprint of the loaded base weights.
{"id": "6", "op": "base_fingerprint"}
```

### Responses

```jsonc
// Generic completion.
{"id": "1", "type": "done", "result": {...}}

// Error.
{"id": "2", "type": "error", "error": {"code": "BASE_MISMATCH", "message": "..."}}

// Streaming token (during generate).
{"id": "4", "type": "token", "text": "Hello"}

// Long-running progress (e.g., model download).
{"id": "1", "type": "progress", "stage": "download", "percent": 42.0}
```

### Error codes

- `INVALID_REQUEST` — malformed JSON or missing fields
- `UNKNOWN_OP` — `op` not recognized
- `BASE_NOT_LOADED` — operation requires a loaded base
- `BASE_MISMATCH` — adapter's `base_sha` ≠ currently loaded base's SHA
- `ADAPTER_NOT_FOUND` — referenced adapter not loaded
- `INTERNAL` — anything else; `message` carries detail

## Process model

- One sidecar per app launch.
- Stays alive across model loads and adapter swaps.
- Adapter cache (LRU, default N=3) lives entirely in the sidecar — Rust just sends `load_adapter` / `generate` requests.
- Sidecar logs to stderr; Rust core captures and forwards to the app's log file.

## Running standalone (dev)

```bash
cd sidecar
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python mlx_server.py
# then type JSON requests at the prompt
```
