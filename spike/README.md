# Phase 0 spike — MLX hot-swap latency

Purpose: prove that Gemma 3 4B Q4 in `mlx-lm` can hot-swap LoRA adapters fast enough and within memory budget to support the LoRA Hub UX.

## Pass criteria

- Warm adapter-swap latency: **< 500 ms**
- Peak RSS with 2 adapters resident: **< 6 GB**
- Generated outputs visibly differ between adapters (when real adapters are provided)

If any of these fail, revisit the backend choice before building Phase 1.

## Requirements

- Apple Silicon Mac (M-series)
- Python 3.10+
- ~3 GB free disk for Gemma 3 4B Q4 weights (downloaded on first run)

## Setup

```bash
cd spike
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

**Latency-only (synthetic adapters, fast):**

```bash
python swap_bench.py
```

**With real adapters (verifies behavior actually changes):**

```bash
python swap_bench.py \
  --adapter-a /path/to/adapter_a \
  --adapter-b /path/to/adapter_b
```

Each adapter path should point to a directory containing `adapter_config.json` and `adapters.safetensors` produced by `mlx_lm.lora` (or converted from PEFT).

## Output

Writes `results.json` with timings, peak RSS, and generated samples. Console prints a pass/fail summary against the criteria above.

## What this does NOT validate

- Adapter quality at 4-bit (covered later, per-adapter, in Phase 3)
- Multi-adapter LRU cache eviction behavior (Phase 2)
- Conversion pipeline from PEFT → MLX (Phase 4)
