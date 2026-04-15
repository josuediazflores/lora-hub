"""LoRA Hub MLX sidecar — JSON-over-stdio LLM runtime.

See sidecar/README.md for the protocol. Logs go to stderr.
"""

from __future__ import annotations

import hashlib
import json
import sys
import threading
import traceback
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def log(msg: str) -> None:
    print(f"[sidecar] {msg}", file=sys.stderr, flush=True)


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


@dataclass
class AdapterEntry:
    name: str
    path: Path
    config: dict
    base_sha: str | None = None


@dataclass
class State:
    base_model_id: str | None = None
    base_sha: str | None = None
    model: Any = None
    tokenizer: Any = None
    lora_wrapped: bool = False
    wrapped_lora_params: dict | None = None  # the lora_parameters dict used at wrap time
    wrapped_num_layers: int | None = None
    adapters: "OrderedDict[str, AdapterEntry]" = field(default_factory=OrderedDict)
    cache_capacity: int = 3
    active_adapter: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


STATE = State()


class SidecarError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def sha256_file(path: Path, chunk: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            buf = f.read(chunk)
            if not buf:
                break
            h.update(buf)
    return h.hexdigest()


def fingerprint_base(model_id: str) -> str:
    """SHA-256 of the model's safetensors index, sorted file shards.

    We hash the index manifest plus the per-shard sha (when present in the index),
    falling back to hashing each shard if the index has no checksums. This produces
    a stable identifier per (model, quant) combo.
    """
    from huggingface_hub import snapshot_download

    local_dir = Path(snapshot_download(model_id))
    shards = sorted(local_dir.glob("*.safetensors"))
    if not shards:
        raise SidecarError("INTERNAL", f"no safetensors shards under {local_dir}")
    h = hashlib.sha256()
    h.update(model_id.encode())
    for shard in shards:
        h.update(shard.name.encode())
        h.update(sha256_file(shard).encode())
    return h.hexdigest()


def op_load_base(req: dict) -> dict:
    model_id = req.get("model_id")
    if not model_id:
        raise SidecarError("INVALID_REQUEST", "load_base requires model_id")

    if STATE.base_model_id == model_id and STATE.model is not None:
        return {"model_id": model_id, "base_sha": STATE.base_sha, "cached": True}

    from mlx_lm import load

    log(f"loading base {model_id}")
    model, tokenizer = load(model_id)
    base_sha = fingerprint_base(model_id)

    STATE.model = model
    STATE.tokenizer = tokenizer
    STATE.base_model_id = model_id
    STATE.base_sha = base_sha
    STATE.lora_wrapped = False
    STATE.wrapped_lora_params = None
    STATE.wrapped_num_layers = None
    STATE.adapters.clear()
    STATE.active_adapter = None

    return {"model_id": model_id, "base_sha": base_sha, "cached": False}


def _ensure_wrapped(lora_params: dict, num_layers: int) -> None:
    """Wrap lora layers exactly once per process. Subsequent adapters must use the
    same lora_parameters/num_layers (a.k.a. shape-compatible adapters)."""
    from mlx_lm.tuner.utils import linear_to_lora_layers

    if STATE.lora_wrapped:
        if STATE.wrapped_lora_params != lora_params or STATE.wrapped_num_layers != num_layers:
            raise SidecarError(
                "BASE_MISMATCH",
                "adapter lora_parameters/num_layers differ from already-wrapped config",
            )
        return

    linear_to_lora_layers(STATE.model, num_layers, lora_params)
    STATE.lora_wrapped = True
    STATE.wrapped_lora_params = lora_params
    STATE.wrapped_num_layers = num_layers


def _evict_if_needed() -> None:
    while len(STATE.adapters) > STATE.cache_capacity:
        evicted_name, _ = STATE.adapters.popitem(last=False)
        log(f"evicted adapter {evicted_name}")


def op_load_adapter(req: dict) -> dict:
    if STATE.model is None:
        raise SidecarError("BASE_NOT_LOADED", "load a base before loading adapters")

    name = req.get("name")
    adapter_path = req.get("adapter_path")
    if not name or not adapter_path:
        raise SidecarError("INVALID_REQUEST", "load_adapter requires name + adapter_path")

    p = Path(adapter_path)
    cfg_path = p / "adapter_config.json"
    if not cfg_path.exists():
        raise SidecarError("INVALID_REQUEST", f"missing adapter_config.json at {p}")
    cfg = json.loads(cfg_path.read_text())

    declared_base_sha = cfg.get("base_sha")
    if declared_base_sha and STATE.base_sha and declared_base_sha != STATE.base_sha:
        raise SidecarError(
            "BASE_MISMATCH",
            f"adapter base_sha {declared_base_sha[:12]} != loaded {STATE.base_sha[:12]}",
        )

    lora_params = cfg.get("lora_parameters") or {}
    num_layers = cfg.get("num_layers", 0)
    _ensure_wrapped(lora_params, num_layers)

    entry = AdapterEntry(name=name, path=p, config=cfg, base_sha=declared_base_sha)
    STATE.adapters[name] = entry
    STATE.adapters.move_to_end(name)
    _evict_if_needed()

    return {"name": name, "loaded": True, "cache_size": len(STATE.adapters)}


def op_unload_adapter(req: dict) -> dict:
    name = req.get("name")
    if not name:
        raise SidecarError("INVALID_REQUEST", "unload_adapter requires name")
    if name not in STATE.adapters:
        raise SidecarError("ADAPTER_NOT_FOUND", f"adapter {name} not loaded")
    del STATE.adapters[name]
    if STATE.active_adapter == name:
        STATE.active_adapter = None
    return {"name": name, "unloaded": True, "cache_size": len(STATE.adapters)}


def _swap_to_adapter(name: str | None) -> None:
    """Swap the model to point at the named adapter's weights, or strip back to base.

    Stripping back to base means loading a 'zero adapter' — but we don't currently
    support that cleanly; if name is None we just leave whatever was last loaded.
    """
    import mlx.core as mx

    if name is None:
        return
    if name not in STATE.adapters:
        raise SidecarError("ADAPTER_NOT_FOUND", f"adapter {name} not loaded")
    entry = STATE.adapters[name]
    weights_path = entry.path / "adapters.safetensors"
    if not weights_path.exists():
        raise SidecarError("INTERNAL", f"missing adapters.safetensors at {entry.path}")
    STATE.model.load_weights(str(weights_path), strict=False)
    mx.eval(STATE.model.parameters())
    STATE.active_adapter = name
    STATE.adapters.move_to_end(name)


def op_generate(req: dict) -> dict:
    if STATE.model is None or STATE.tokenizer is None:
        raise SidecarError("BASE_NOT_LOADED", "load a base before generating")

    prompt = req.get("prompt")
    if not isinstance(prompt, str) or not prompt:
        raise SidecarError("INVALID_REQUEST", "generate requires non-empty prompt")
    max_tokens = int(req.get("max_tokens", 256))
    adapter = req.get("adapter")

    if adapter is not None and adapter != STATE.active_adapter:
        _swap_to_adapter(adapter)

    from mlx_lm import stream_generate

    req_id = req["id"]
    pieces: list[str] = []
    for chunk in stream_generate(STATE.model, STATE.tokenizer, prompt=prompt, max_tokens=max_tokens):
        text = getattr(chunk, "text", None) or (chunk if isinstance(chunk, str) else "")
        if not text:
            continue
        pieces.append(text)
        emit({"id": req_id, "type": "token", "text": text})

    return {"text": "".join(pieces), "adapter": STATE.active_adapter}


def op_status(_req: dict) -> dict:
    return {
        "base_model_id": STATE.base_model_id,
        "base_sha": STATE.base_sha,
        "lora_wrapped": STATE.lora_wrapped,
        "active_adapter": STATE.active_adapter,
        "cache_capacity": STATE.cache_capacity,
        "adapters": [
            {"name": e.name, "path": str(e.path), "base_sha": e.base_sha}
            for e in STATE.adapters.values()
        ],
    }


def op_base_fingerprint(req: dict) -> dict:
    model_id = req.get("model_id") or STATE.base_model_id
    if not model_id:
        raise SidecarError("INVALID_REQUEST", "no model_id provided and no base loaded")
    return {"model_id": model_id, "base_sha": fingerprint_base(model_id)}


HANDLERS = {
    "load_base": op_load_base,
    "load_adapter": op_load_adapter,
    "unload_adapter": op_unload_adapter,
    "generate": op_generate,
    "status": op_status,
    "base_fingerprint": op_base_fingerprint,
}


def handle(req: dict) -> None:
    req_id = req.get("id")
    op = req.get("op")
    try:
        if not req_id:
            raise SidecarError("INVALID_REQUEST", "missing id")
        if op not in HANDLERS:
            raise SidecarError("UNKNOWN_OP", f"unknown op {op!r}")
        with STATE.lock:
            result = HANDLERS[op](req)
        emit({"id": req_id, "type": "done", "result": result})
    except SidecarError as e:
        emit({"id": req_id, "type": "error", "error": {"code": e.code, "message": e.message}})
    except Exception as e:
        log(f"unhandled exception:\n{traceback.format_exc()}")
        emit({"id": req_id, "type": "error", "error": {"code": "INTERNAL", "message": str(e)}})


def main() -> int:
    log("ready")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            emit({"id": None, "type": "error", "error": {"code": "INVALID_REQUEST", "message": str(e)}})
            continue
        handle(req)
    return 0


if __name__ == "__main__":
    sys.exit(main())
