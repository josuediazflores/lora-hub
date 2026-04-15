"""Phase 0 spike: measure MLX LoRA hot-swap latency and memory on Gemma 3 4B Q4.

Pass criteria:
  - warm adapter swap < 500 ms
  - peak RSS < 6 GB
  - outputs differ between adapters (when --adapter-a/--adapter-b are supplied)

Production hot-swap path: call linear_to_lora_layers once, then swap with
model.load_weights(strict=False). That is what is timed here.

Usage:
  python swap_bench.py
  python swap_bench.py --adapter-a /path/to/a --adapter-b /path/to/b
"""

from __future__ import annotations

import argparse
import gc
import json
import platform
import shutil
import sys
import tempfile
import time
from pathlib import Path

import psutil

DEFAULT_BASE = "mlx-community/gemma-3-4b-it-4bit"
PROMPT = "Write a one-sentence description of a sunset over the ocean."
GEN_TOKENS = 32
WARM_SWAP_TARGET_MS = 500
PEAK_RSS_TARGET_GB = 6.0

LORA_RANK = 8
LORA_SCALE = 20.0
LORA_NUM_LAYERS = 8


def require_apple_silicon() -> None:
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        sys.exit("This spike requires an Apple Silicon Mac.")


def rss_gb() -> float:
    return psutil.Process().memory_info().rss / (1024**3)


def fmt_ms(seconds: float) -> str:
    return f"{seconds * 1000:.1f} ms"


def lora_config_dict() -> dict:
    return {
        "rank": LORA_RANK,
        "scale": LORA_SCALE,
        "dropout": 0.0,
    }


def adapter_config_dict() -> dict:
    return {
        "fine_tune_type": "lora",
        "num_layers": LORA_NUM_LAYERS,
        "lora_parameters": lora_config_dict(),
    }


def prepare_synthetic_adapters(base_path: str, out_a: Path, out_b: Path) -> None:
    """Build two valid mlx-lm LoRA adapter directories with random weights."""
    import mlx.core as mx
    from mlx.utils import tree_flatten
    from mlx_lm import load
    from mlx_lm.tuner.utils import linear_to_lora_layers

    print("  loading base to derive adapter shapes...", flush=True)
    model, _ = load(base_path)
    linear_to_lora_layers(model, LORA_NUM_LAYERS, lora_config_dict())

    trainable_template = dict(tree_flatten(model.trainable_parameters()))
    if not trainable_template:
        raise RuntimeError("linear_to_lora_layers produced no trainable params.")

    cfg = adapter_config_dict()
    for out_dir, seed in [(out_a, 1), (out_b, 2)]:
        out_dir.mkdir(parents=True, exist_ok=True)
        mx.random.seed(seed)
        weights = {
            name: (mx.random.normal(w.shape) * 0.02).astype(w.dtype)
            for name, w in trainable_template.items()
        }
        mx.eval(weights)
        mx.save_safetensors(str(out_dir / "adapters.safetensors"), weights)
        (out_dir / "adapter_config.json").write_text(json.dumps(cfg, indent=2))
        print(f"  wrote synthetic adapter at {out_dir} ({len(weights)} tensors)")

    del model
    gc.collect()


def read_adapter_config(adapter_dir: Path) -> dict:
    return json.loads((adapter_dir / "adapter_config.json").read_text())


def time_block(label: str, fn):
    print(f"  {label}...", end=" ", flush=True)
    t0 = time.perf_counter()
    result = fn()
    elapsed = time.perf_counter() - t0
    print(fmt_ms(elapsed))
    return result, elapsed


def swap_weights(model, adapter_dir: Path) -> None:
    import mlx.core as mx

    model.load_weights(str(adapter_dir / "adapters.safetensors"), strict=False)
    mx.eval(model.parameters())


def generate_text(model, tokenizer, prompt: str) -> str:
    from mlx_lm import generate as mlx_generate

    return mlx_generate(
        model, tokenizer, prompt=prompt, max_tokens=GEN_TOKENS, verbose=False
    )


def main() -> int:
    require_apple_silicon()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE, help="HF repo id of MLX base model")
    parser.add_argument("--adapter-a", type=Path, help="Path to first adapter dir")
    parser.add_argument("--adapter-b", type=Path, help="Path to second adapter dir")
    parser.add_argument("--out", type=Path, default=Path("results.json"))
    args = parser.parse_args()

    print(f"Spike: MLX hot-swap latency on {args.base}")
    print(f"  starting RSS: {rss_gb():.2f} GB")

    tmp_root: Path | None = None
    if args.adapter_a and args.adapter_b:
        adapter_a, adapter_b = args.adapter_a, args.adapter_b
        synthetic = False
        cfg_a = read_adapter_config(adapter_a)
        if read_adapter_config(adapter_b)["lora_parameters"] != cfg_a["lora_parameters"]:
            sys.exit("Adapter A and B have different lora_parameters; not supported.")
        wrap_layers = cfg_a["num_layers"]
        wrap_lora = cfg_a["lora_parameters"]
    else:
        print("\n[setup] Generating synthetic adapters (latency-only run)")
        tmp_root = Path(tempfile.mkdtemp(prefix="lorahub_spike_"))
        prepare_synthetic_adapters(args.base, tmp_root / "a", tmp_root / "b")
        adapter_a, adapter_b = tmp_root / "a", tmp_root / "b"
        synthetic = True
        wrap_layers = LORA_NUM_LAYERS
        wrap_lora = lora_config_dict()

    from mlx_lm import load
    from mlx_lm.tuner.utils import linear_to_lora_layers

    print("\n[1/5] Loading base model (fresh)")
    (model, tokenizer), base_load_s = time_block(
        "base load", lambda: load(args.base)
    )
    rss_after_base = rss_gb()
    print(f"  RSS after base: {rss_after_base:.2f} GB")

    print("\n[2/5] Wrapping LoRA layers (one-time)")
    _, wrap_s = time_block(
        "wrap", lambda: linear_to_lora_layers(model, wrap_layers, wrap_lora)
    )

    print("\n[3/5] Cold-loading adapter A")
    _, cold_load_a_s = time_block("load A", lambda: swap_weights(model, adapter_a))
    rss_after_a = rss_gb()
    print(f"  RSS after A: {rss_after_a:.2f} GB")

    print("  generating with A...", end=" ", flush=True)
    t0 = time.perf_counter()
    out_a = generate_text(model, tokenizer, PROMPT)
    print(fmt_ms(time.perf_counter() - t0))

    print("\n[4/5] Warm swap (A → B)")
    _, warm_swap_s = time_block("swap B", lambda: swap_weights(model, adapter_b))
    rss_after_b = rss_gb()
    print(f"  RSS after B: {rss_after_b:.2f} GB")

    print("  generating with B...", end=" ", flush=True)
    t0 = time.perf_counter()
    out_b = generate_text(model, tokenizer, PROMPT)
    print(fmt_ms(time.perf_counter() - t0))

    print("\n[5/5] Warm swap back (B → A)")
    _, warm_swap_back_s = time_block("swap A", lambda: swap_weights(model, adapter_a))

    peak_rss = max(rss_after_base, rss_after_a, rss_after_b)
    warm_swap_ms = warm_swap_s * 1000
    warm_swap_back_ms = warm_swap_back_s * 1000
    avg_warm_swap_ms = (warm_swap_ms + warm_swap_back_ms) / 2

    pass_swap = avg_warm_swap_ms < WARM_SWAP_TARGET_MS
    pass_rss = peak_rss < PEAK_RSS_TARGET_GB
    pass_diff = (out_a.strip() != out_b.strip()) if not synthetic else None

    print("\n" + "=" * 60)
    print("Results")
    print("=" * 60)
    print(f"  base load:           {base_load_s * 1000:>8.1f} ms")
    print(f"  one-time LoRA wrap:  {wrap_s * 1000:>8.1f} ms")
    print(f"  cold adapter load:   {cold_load_a_s * 1000:>8.1f} ms")
    print(f"  warm swap (A→B):     {warm_swap_ms:>8.1f} ms")
    print(f"  warm swap (B→A):     {warm_swap_back_ms:>8.1f} ms")
    print(f"  avg warm swap:       {avg_warm_swap_ms:>8.1f} ms  (target <{WARM_SWAP_TARGET_MS})")
    print(f"  peak RSS:            {peak_rss:>8.2f} GB  (target <{PEAK_RSS_TARGET_GB})")
    if pass_diff is not None:
        print(f"  outputs differ:      {pass_diff}")

    overall_pass = pass_swap and pass_rss and pass_diff is not False
    print("\n  PASS" if overall_pass else "\n  FAIL")
    print(f"    swap latency: {'OK' if pass_swap else 'FAIL'}")
    print(f"    peak RSS:     {'OK' if pass_rss else 'FAIL'}")
    if pass_diff is not None:
        print(f"    behavior:     {'OK' if pass_diff else 'FAIL'}")
    elif synthetic:
        print("    behavior:     SKIPPED (synthetic adapters)")

    args.out.write_text(
        json.dumps(
            {
                "base_model": args.base,
                "synthetic_adapters": synthetic,
                "base_load_ms": base_load_s * 1000,
                "lora_wrap_ms": wrap_s * 1000,
                "cold_adapter_load_ms": cold_load_a_s * 1000,
                "warm_swap_ms": warm_swap_ms,
                "warm_swap_back_ms": warm_swap_back_ms,
                "avg_warm_swap_ms": avg_warm_swap_ms,
                "peak_rss_gb": peak_rss,
                "output_a": out_a,
                "output_b": out_b,
                "pass_swap_latency": pass_swap,
                "pass_peak_rss": pass_rss,
                "pass_outputs_differ": pass_diff,
            },
            indent=2,
        )
    )
    print(f"\n  wrote {args.out}")

    if tmp_root is not None:
        shutil.rmtree(tmp_root, ignore_errors=True)

    return 0 if overall_pass else 1


if __name__ == "__main__":
    sys.exit(main())
