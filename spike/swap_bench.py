"""Phase 0 spike: measure MLX LoRA hot-swap latency and memory on Gemma 3 4B Q4.

Pass criteria:
  - warm adapter swap < 500 ms
  - peak RSS < 6 GB
  - outputs differ between adapters (when --adapter-a/--adapter-b are supplied)

Usage:
  python swap_bench.py
  python swap_bench.py --adapter-a /path/to/a --adapter-b /path/to/b
"""

from __future__ import annotations

import argparse
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
GEN_TOKENS = 64
WARM_SWAP_TARGET_MS = 500
PEAK_RSS_TARGET_GB = 6.0


def require_apple_silicon() -> None:
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        sys.exit("This spike requires an Apple Silicon Mac.")


def rss_gb() -> float:
    return psutil.Process().memory_info().rss / (1024**3)


def fmt_ms(seconds: float) -> str:
    return f"{seconds * 1000:.1f} ms"


def make_synthetic_adapter(model, out_dir: Path, seed: int) -> Path:
    """Create a tiny random LoRA adapter for latency-only benchmarking.

    Behavior won't meaningfully change vs. base; this exists purely to exercise
    the load/swap code path with realistic tensor shapes.
    """
    import mlx.core as mx
    import mlx.nn as nn

    out_dir.mkdir(parents=True, exist_ok=True)
    rank = 8
    alpha = 16

    weights: dict[str, mx.array] = {}
    mx.random.seed(seed)
    for name, module in model.named_modules():
        if isinstance(module, nn.Linear) and "attn" in name:
            in_f, out_f = module.weight.shape[1], module.weight.shape[0]
            weights[f"{name}.lora_a"] = mx.random.normal((in_f, rank)) * 0.01
            weights[f"{name}.lora_b"] = mx.zeros((rank, out_f))

    if not weights:
        raise RuntimeError("No attention Linear layers found to attach LoRA to.")

    mx.save_safetensors(str(out_dir / "adapters.safetensors"), weights)
    (out_dir / "adapter_config.json").write_text(
        json.dumps(
            {
                "fine_tune_type": "lora",
                "lora_parameters": {
                    "rank": rank,
                    "alpha": alpha,
                    "dropout": 0.0,
                    "scale": alpha / rank,
                    "keys": ["self_attn.q_proj", "self_attn.v_proj"],
                },
            },
            indent=2,
        )
    )
    return out_dir


def time_block(label: str, fn):
    print(f"  {label}...", end=" ", flush=True)
    t0 = time.perf_counter()
    result = fn()
    elapsed = time.perf_counter() - t0
    print(fmt_ms(elapsed))
    return result, elapsed


def generate_text(model, tokenizer, prompt: str) -> str:
    from mlx_lm import generate as mlx_generate

    return mlx_generate(model, tokenizer, prompt=prompt, max_tokens=GEN_TOKENS, verbose=False)


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

    from mlx_lm import load
    from mlx_lm.tuner.utils import load_adapters

    print("\n[1/4] Loading base model")
    (model, tokenizer), base_load_s = time_block("base load", lambda: load(args.base))
    rss_after_base = rss_gb()
    print(f"  RSS after base: {rss_after_base:.2f} GB")

    tmp_root: Path | None = None
    if args.adapter_a and args.adapter_b:
        adapter_a, adapter_b = args.adapter_a, args.adapter_b
        synthetic = False
    else:
        print("\n  no adapters supplied; generating synthetic adapters for latency-only run")
        tmp_root = Path(tempfile.mkdtemp(prefix="lorahub_spike_"))
        adapter_a = make_synthetic_adapter(model, tmp_root / "a", seed=1)
        adapter_b = make_synthetic_adapter(model, tmp_root / "b", seed=2)
        synthetic = True

    print("\n[2/4] Cold-loading adapter A")
    _, cold_load_a_s = time_block(
        "load A", lambda: load_adapters(model, str(adapter_a))
    )
    rss_after_a = rss_gb()
    print(f"  RSS after A: {rss_after_a:.2f} GB")

    print("  generating with A...", end=" ", flush=True)
    t0 = time.perf_counter()
    out_a = generate_text(model, tokenizer, PROMPT)
    print(fmt_ms(time.perf_counter() - t0))

    print("\n[3/4] Warm-swapping to adapter B")
    _, warm_swap_s = time_block(
        "swap B", lambda: load_adapters(model, str(adapter_b))
    )
    rss_after_b = rss_gb()
    print(f"  RSS after B: {rss_after_b:.2f} GB")

    print("  generating with B...", end=" ", flush=True)
    t0 = time.perf_counter()
    out_b = generate_text(model, tokenizer, PROMPT)
    print(fmt_ms(time.perf_counter() - t0))

    print("\n[4/4] Second warm swap (back to A)")
    _, warm_swap_back_s = time_block(
        "swap A", lambda: load_adapters(model, str(adapter_a))
    )

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
    print(f"  cold adapter load:   {cold_load_a_s * 1000:>8.1f} ms")
    print(f"  warm swap (A→B):     {warm_swap_ms:>8.1f} ms")
    print(f"  warm swap (B→A):     {warm_swap_back_ms:>8.1f} ms")
    print(f"  avg warm swap:       {avg_warm_swap_ms:>8.1f} ms  (target <{WARM_SWAP_TARGET_MS})")
    print(f"  peak RSS:            {peak_rss:>8.2f} GB  (target <{PEAK_RSS_TARGET_GB})")
    if pass_diff is not None:
        print(f"  outputs differ:      {pass_diff}")

    print("\n  PASS" if (pass_swap and pass_rss and pass_diff is not False) else "\n  FAIL")
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

    return 0 if (pass_swap and pass_rss and pass_diff is not False) else 1


if __name__ == "__main__":
    sys.exit(main())
