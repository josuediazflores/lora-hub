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

from peft_convert import (
    PeftConvertError,
    convert_peft_adapter,
    is_mlx_adapter,
    is_peft_adapter,
)


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


# Cooperative cancellation for in-flight generate requests. Only one generation
# may run at a time; abort_generation flips its event and the loop checks each
# token. Mutated under GEN_LOCK; main thread reads/writes when handling abort.
ACTIVE_GENERATION_ID: str | None = None
ACTIVE_ABORT_EVENT: threading.Event | None = None
GEN_LOCK = threading.Lock()


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


from tqdm import tqdm as _tqdm


class ProgressTqdm(_tqdm):
    """tqdm subclass that also emits `type: "progress"` events to the sidecar
    protocol. Installed via huggingface_hub's tqdm_class parameter.
    Class-level `req_id` scopes events to the in-flight request.
    """

    req_id: str | None = None

    def display(self, *args, **kwargs):
        self._emit()
        return super().display(*args, **kwargs)

    def close(self):
        self._emit(final=True)
        super().close()

    def _emit(self, final=False):
        if not ProgressTqdm.req_id:
            return
        total = self.total or 0
        percent = (100.0 * self.n / total) if total else 0.0
        emit(
            {
                "id": ProgressTqdm.req_id,
                "type": "progress",
                "stage": "download",
                "desc": self.desc or "",
                "n": self.n,
                "total": total,
                "percent": round(percent, 1),
                "final": final,
            }
        )


def op_load_base(req: dict) -> dict:
    model_id = req.get("model_id")
    if not model_id:
        raise SidecarError("INVALID_REQUEST", "load_base requires model_id")

    if STATE.base_model_id == model_id and STATE.model is not None:
        return {"model_id": model_id, "base_sha": STATE.base_sha, "cached": True}

    from huggingface_hub import snapshot_download
    from mlx_lm import load

    log(f"loading base {model_id}")
    ProgressTqdm.req_id = req["id"]
    try:
        snapshot_download(model_id, tqdm_class=ProgressTqdm)
    finally:
        ProgressTqdm.req_id = None

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


def _wrap_now(lora_params: dict, num_layers: int) -> None:
    from mlx_lm.tuner.utils import linear_to_lora_layers

    linear_to_lora_layers(STATE.model, num_layers, lora_params)
    STATE.lora_wrapped = True
    STATE.wrapped_lora_params = dict(lora_params)
    STATE.wrapped_num_layers = num_layers


def _ensure_wrapped(lora_params: dict, num_layers: int) -> None:
    """Ensure the model is wrapped with the given lora config. If already wrapped
    with a different config, reload the base and re-wrap (drops cached adapter
    weights from the model — paths in STATE.adapters remain so callers can re-load).
    """
    if STATE.lora_wrapped:
        if (
            STATE.wrapped_lora_params == lora_params
            and STATE.wrapped_num_layers == num_layers
        ):
            return
        # Re-wrap path: blow away the model and rebuild.
        log("re-wrapping base for new lora config")
        from mlx_lm import load as mlx_load

        model_id = STATE.base_model_id
        if not model_id:
            raise SidecarError("BASE_NOT_LOADED", "no base to re-wrap")
        model, tokenizer = mlx_load(model_id)
        STATE.model = model
        STATE.tokenizer = tokenizer
        STATE.lora_wrapped = False
        STATE.wrapped_lora_params = None
        STATE.wrapped_num_layers = None
        STATE.active_adapter = None

    _wrap_now(lora_params, num_layers)


def _evict_if_needed() -> None:
    while len(STATE.adapters) > STATE.cache_capacity:
        evicted_name, _ = STATE.adapters.popitem(last=False)
        log(f"evicted adapter {evicted_name}")


def _maybe_convert_peft(src: Path) -> Path:
    """If src is a PEFT adapter dir, convert it to mlx-lm format under
    src/.mlx-cache/ and return that path. Otherwise return src unchanged.
    Conversion result is cached and skipped on subsequent loads.
    """
    if is_mlx_adapter(src):
        return src
    if not is_peft_adapter(src):
        return src

    cache_dir = src / ".mlx-cache"
    if is_mlx_adapter(cache_dir):
        log(f"using cached mlx conversion at {cache_dir}")
        return cache_dir

    log(f"auto-converting PEFT adapter {src} → {cache_dir}")
    try:
        report = convert_peft_adapter(
            src,
            cache_dir,
            base_sha=STATE.base_sha,
            base_model_id=STATE.base_model_id,
        )
        log(f"conversion done: {report['converted_tensors']} tensors, {report['num_layers']} layers")
    except PeftConvertError as e:
        raise SidecarError("INVALID_REQUEST", f"PEFT conversion failed: {e}")
    return cache_dir


def op_load_adapter(req: dict) -> dict:
    if STATE.model is None:
        raise SidecarError("BASE_NOT_LOADED", "load a base before loading adapters")

    name = req.get("name")
    adapter_path = req.get("adapter_path")
    if not name or not adapter_path:
        raise SidecarError("INVALID_REQUEST", "load_adapter requires name + adapter_path")

    src = Path(adapter_path)
    if not src.exists():
        raise SidecarError("INVALID_REQUEST", f"adapter path does not exist: {src}")

    p = _maybe_convert_peft(src)
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
    """Swap the model to point at the named adapter's weights. If the adapter's
    lora config differs from the currently-wrapped one, re-wraps the base first.
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

    lora_params = entry.config.get("lora_parameters") or {}
    num_layers = entry.config.get("num_layers", 0)
    _ensure_wrapped(lora_params, num_layers)

    STATE.model.load_weights(str(weights_path), strict=False)
    mx.eval(STATE.model.parameters())
    STATE.active_adapter = name
    STATE.adapters.move_to_end(name)


def _format_prompt(prompt: str, messages: list | None) -> str:
    """Apply the tokenizer's chat template if available. Falls back to the raw
    prompt for base (non-instruct) models.

    `messages` (optional) is a list of {role, content} for multi-turn history;
    when omitted, the prompt is treated as a single user message.
    """
    tok = STATE.tokenizer
    apply = getattr(tok, "apply_chat_template", None)
    if not callable(apply):
        return prompt

    chat = list(messages) if messages else []
    if not chat or chat[-1].get("role") != "user":
        chat.append({"role": "user", "content": prompt})

    try:
        return apply(chat, add_generation_prompt=True, tokenize=False)
    except Exception as e:
        log(f"chat template failed ({e}); using raw prompt")
        return prompt


def op_generate(req: dict) -> dict:
    """Runs in a worker thread (see handle()). Cooperatively respects
    ACTIVE_ABORT_EVENT; breaks the token loop on next iteration when set."""
    global ACTIVE_GENERATION_ID, ACTIVE_ABORT_EVENT

    if STATE.model is None or STATE.tokenizer is None:
        raise SidecarError("BASE_NOT_LOADED", "load a base before generating")

    prompt = req.get("prompt")
    if not isinstance(prompt, str) or not prompt:
        raise SidecarError("INVALID_REQUEST", "generate requires non-empty prompt")
    max_tokens = int(req.get("max_tokens", 512))
    temperature = float(req.get("temperature", 0.7))
    top_p = float(req.get("top_p", 0.95))
    messages = req.get("messages")
    adapter = req.get("adapter")

    abort_event = threading.Event()
    with GEN_LOCK:
        if ACTIVE_GENERATION_ID is not None:
            raise SidecarError(
                "BUSY",
                f"another generation is in progress ({ACTIVE_GENERATION_ID})",
            )
        ACTIVE_GENERATION_ID = req["id"]
        ACTIVE_ABORT_EVENT = abort_event

    try:
        if adapter is not None and adapter != STATE.active_adapter:
            _swap_to_adapter(adapter)

        formatted = _format_prompt(prompt, messages)

        from mlx_lm import stream_generate
        from mlx_lm.sample_utils import make_sampler

        sampler = make_sampler(temp=temperature, top_p=top_p)

        req_id = req["id"]
        pieces: list[str] = []
        aborted = False
        for chunk in stream_generate(
            STATE.model,
            STATE.tokenizer,
            prompt=formatted,
            max_tokens=max_tokens,
            sampler=sampler,
        ):
            if abort_event.is_set():
                aborted = True
                break
            text = getattr(chunk, "text", None) or (chunk if isinstance(chunk, str) else "")
            if not text:
                continue
            pieces.append(text)
            emit({"id": req_id, "type": "token", "text": text})

        return {
            "text": "".join(pieces),
            "adapter": STATE.active_adapter,
            "aborted": aborted,
        }
    finally:
        with GEN_LOCK:
            ACTIVE_GENERATION_ID = None
            ACTIVE_ABORT_EVENT = None


def op_abort_generation(req: dict) -> dict:
    target = req.get("target_id")
    with GEN_LOCK:
        if not ACTIVE_GENERATION_ID or not ACTIVE_ABORT_EVENT:
            return {"aborted": False, "reason": "no active generation"}
        if target and target != ACTIVE_GENERATION_ID:
            return {
                "aborted": False,
                "reason": f"active generation is {ACTIVE_GENERATION_ID}, not {target}",
            }
        ACTIVE_ABORT_EVENT.set()
        return {"aborted": True, "target_id": ACTIVE_GENERATION_ID}


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


def op_make_test_adapter(req: dict) -> dict:
    """Dev helper: write a valid mlx-lm LoRA adapter with random weights to out_dir.
    Requires a base to be loaded so we can derive shapes from lora-wrapped layers.
    """
    if STATE.model is None:
        raise SidecarError("BASE_NOT_LOADED", "load a base before creating a test adapter")

    out_dir = req.get("out_dir")
    seed = int(req.get("seed", 1))
    if not out_dir:
        raise SidecarError("INVALID_REQUEST", "make_test_adapter requires out_dir")

    import mlx.core as mx
    from mlx.utils import tree_flatten
    from mlx_lm.tuner.utils import linear_to_lora_layers

    lora_params = STATE.wrapped_lora_params or {"rank": 8, "scale": 20.0, "dropout": 0.0}
    num_layers = STATE.wrapped_num_layers or 8
    if not STATE.lora_wrapped:
        linear_to_lora_layers(STATE.model, num_layers, lora_params)
        STATE.lora_wrapped = True
        STATE.wrapped_lora_params = lora_params
        STATE.wrapped_num_layers = num_layers

    p = Path(out_dir)
    p.mkdir(parents=True, exist_ok=True)

    mx.random.seed(seed)
    trainable = dict(tree_flatten(STATE.model.trainable_parameters()))
    weights = {
        name: (mx.random.normal(w.shape) * 0.03).astype(w.dtype)
        for name, w in trainable.items()
    }
    mx.eval(weights)
    mx.save_safetensors(str(p / "adapters.safetensors"), weights)

    cfg = {
        "fine_tune_type": "lora",
        "num_layers": num_layers,
        "lora_parameters": lora_params,
        "base_sha": STATE.base_sha,
        "base_model_id": STATE.base_model_id,
    }
    (p / "adapter_config.json").write_text(json.dumps(cfg, indent=2))
    return {"path": str(p), "num_tensors": len(weights)}


HANDLERS = {
    "load_base": op_load_base,
    "load_adapter": op_load_adapter,
    "unload_adapter": op_unload_adapter,
    "generate": op_generate,
    "abort_generation": op_abort_generation,
    "status": op_status,
    "base_fingerprint": op_base_fingerprint,
    "make_test_adapter": op_make_test_adapter,
}

# These ops run in a worker thread so the main loop can keep reading stdin
# (notably so abort_generation can interrupt a running generate).
ASYNC_OPS = {"generate"}


def _run_handler(req: dict) -> None:
    req_id = req.get("id")
    op = req.get("op")
    try:
        if not req_id:
            raise SidecarError("INVALID_REQUEST", "missing id")
        if op not in HANDLERS:
            raise SidecarError("UNKNOWN_OP", f"unknown op {op!r}")
        # ASYNC_OPS bypass STATE.lock — they manage their own concurrency
        # (currently only generate, which is gated by GEN_LOCK to one in-flight).
        if op in ASYNC_OPS:
            result = HANDLERS[op](req)
        else:
            with STATE.lock:
                result = HANDLERS[op](req)
        emit({"id": req_id, "type": "done", "result": result})
    except SidecarError as e:
        emit({"id": req_id, "type": "error", "error": {"code": e.code, "message": e.message}})
    except Exception as e:
        log(f"unhandled exception:\n{traceback.format_exc()}")
        emit({"id": req_id, "type": "error", "error": {"code": "INTERNAL", "message": str(e)}})


def handle(req: dict) -> None:
    op = req.get("op")
    if op in ASYNC_OPS:
        threading.Thread(target=_run_handler, args=(req,), daemon=True).start()
    else:
        _run_handler(req)


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
