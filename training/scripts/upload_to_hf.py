"""Upload both trained LoRA adapters to HuggingFace as public model repos.

Extracts the eval trajectory from the training log, writes a model card
with the recipe + eval table + usage snippet, then uploads the adapter
weights + tokenizer files + card. Checkpoints and training_args.bin are
excluded.

Runs from inside the training container; expects the HF token already
set via `huggingface-cli login` (or present at ~/.cache/huggingface/token)."""

from __future__ import annotations

import os
import re
from pathlib import Path

from huggingface_hub import HfApi, create_repo


# Override with HF_USER=<your-handle> in the environment before running.
HF_USER = os.environ.get("HF_USER") or "josuediazflores"
# Runs defined as: (output_dir_name, base_model, pretty_label, log_name, dataset_label, dataset_id, repo_suffix)
OPUS_DATASETS = [
    "TeichAI/Claude-Opus-4.6-Reasoning-887x",
    "TeichAI/Claude-Sonnet-4.6-Reasoning-1100x",
    "TeichAI/claude-4.5-opus-high-reasoning-250x",
    "Crownelius/Opus-4.6-Reasoning-2100x-formatted",
]
OPUS_LABEL = "Claude Opus 4.6 + Sonnet 4.6 reasoning traces (~4.4k combined)"

RUNS = [
    (
        "gemma4-e2b-opus",
        "google/gemma-4-E2B-it",
        "Gemma 4 E2B",
        "e2b-opus",
        OPUS_DATASETS,
        OPUS_LABEL,
        "opus-reasoning-lora",
    ),
    (
        "gemma4-e4b-opus",
        "google/gemma-4-E4B-it",
        "Gemma 4 E4B",
        "e4b-opus",
        OPUS_DATASETS,
        OPUS_LABEL,
        "opus-reasoning-lora",
    ),
]


def extract_evals(log_path: Path) -> list[tuple[float, float]]:
    if not log_path.exists():
        return []
    out: list[tuple[float, float]] = []
    pattern = re.compile(
        r"'eval_loss':\s*'([0-9.]+)'.*?'epoch':\s*'([0-9.]+)'"
    )
    for line in log_path.read_text(errors="ignore").splitlines():
        m = pattern.search(line)
        if m:
            out.append((float(m.group(2)), float(m.group(1))))
    return out


def model_card(run_id: str, base: str, pretty: str, log_name: str,
               dataset_ids: list[str] | str, dataset_label: str, repo_suffix: str) -> str:
    evals = extract_evals(Path(f"/workspace/training/logs/{log_name}.log"))
    eval_rows = "\n".join(f"| {e:.3f} | {l:.4f} |" for e, l in evals) or "| _no evals_ | _–_ |"
    final_eval = f"{evals[-1][1]:.4f}" if evals else "n/a"
    repo_id = f"{HF_USER}/{pretty.lower().replace(' ', '-')}-{repo_suffix}"
    if isinstance(dataset_ids, str):
        dataset_ids = [dataset_ids]
    datasets_yaml = "\n".join(f"- {d}" for d in dataset_ids)
    datasets_md = "\n".join(
        f"- [`{d}`](https://huggingface.co/datasets/{d})" for d in dataset_ids
    )
    return f"""---
base_model: {base}
library_name: peft
license: apache-2.0
datasets:
{datasets_yaml}
language:
- en
tags:
- lora
- peft
- gemma-4
- reasoning
- chain-of-thought
- opus-distill
---

# {pretty} — Opus reasoning distill (LoRA)

LoRA adapter that teaches `{base}` to emit explicit step-by-step reasoning
in the style of **Claude Opus 4.6**, supervised-distilled from a
combined corpus of Opus + Sonnet reasoning traces:

{datasets_md}

Source: {dataset_label}. Final eval loss: **{final_eval}**.

## Why

Prior to this release the only confirmed Gemma 4 Opus-reasoning LoRA on
the hub was
[`kai-os/gemma4-31b-Opus-4.6-reasoning`](https://huggingface.co/kai-os/gemma4-31b-Opus-4.6-reasoning)
at the 31B tier. This set fills in the smaller sizes (E2B, E4B) with the
same Opus-derived recipe, so the hot-swap story works on lighter hardware.

## Training recipe

- **LoRA**: rank 32, alpha 64, dropout 0.05, bias=none
- **Target modules**: `q/k/v/o/gate/up/down_proj` — text tower only
  (vision + audio projections under `Gemma4ClippableLinear` are excluded
  so gradients flow to the layers that actually run during text inference)
- **Sequence length**: 2048, no packing
- **Effective batch**: 16 (micro-batch 8 × grad-accum 2 on E2B; 4 × 4 on E4B)
- **Optimizer**: AdamW, lr 2e-4, cosine schedule with 3% warmup
- **Epochs**: 2
- **Precision**: bf16, gradient checkpointing with `use_reentrant=False`
- **Attention**: SDPA (flash-attn 2 unavailable on ROCm for Gemma 4's head dim)
- **Hardware**: 1× AMD MI300X (192 GB, ROCm 7.0)

## Eval trajectory (held-out 2% split)

| epoch | eval_loss |
|---|---|
{eval_rows}

## Usage

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

base_id = "{base}"
adapter_id = "{repo_id}"

tokenizer = AutoTokenizer.from_pretrained(base_id)
model = AutoModelForCausalLM.from_pretrained(base_id, dtype="bfloat16")
model = PeftModel.from_pretrained(model, adapter_id)

messages = [{{"role": "user", "content": "Prove there are infinitely many primes."}}]
inputs = tokenizer.apply_chat_template(messages, return_tensors="pt", add_generation_prompt=True)
out = model.generate(inputs.to(model.device), max_new_tokens=1024)
print(tokenizer.decode(out[0], skip_special_tokens=True))
```

## Caveats

- Trained on ~16k reasoning traces — useful for broad reasoning patterns,
  not a substitute for domain-specific math/code evals.
- bf16 adapter; works with any bf16, 8-bit, or mxfp8 quant of the same
  base. 4-bit quants of the base will still load but some quality drift.
- No RLHF step — this is pure supervised distillation from the Sky-T1
  corpus, which was itself Qwen-distilled from o1/R1-style outputs.

## Citation

```
@dataset{{sky_t1_2025,
  author = {{NovaSky-AI}},
  title = {{Sky-T1 Reasoning Dataset}},
  year = {{2025}},
  url = {{https://huggingface.co/datasets/NovaSky-AI/Sky-T1_data_17k}}
}}
```
"""


def upload_run(run_id: str, base: str, pretty: str, log_name: str,
               dataset_ids: list[str] | str, dataset_label: str, repo_suffix: str) -> None:
    folder = Path(f"/workspace/training/outputs/{run_id}")
    adapter = folder / "adapter_model.safetensors"
    if not adapter.exists():
        print(f"[upload] SKIP {run_id} — no adapter_model.safetensors")
        return
    repo_id = f"{HF_USER}/{pretty.lower().replace(' ', '-')}-{repo_suffix}"
    (folder / "README.md").write_text(
        model_card(run_id, base, pretty, log_name, dataset_ids, dataset_label, repo_suffix)
    )
    print(f"[upload] creating {repo_id} (public)")
    create_repo(repo_id, exist_ok=True, private=False, repo_type="model")
    print(f"[upload] pushing {folder} → {repo_id}")
    api = HfApi()
    api.upload_folder(
        folder_path=str(folder),
        repo_id=repo_id,
        repo_type="model",
        commit_message=f"LoRA adapter — {pretty} × {dataset_label}",
        ignore_patterns=[
            "checkpoint-*",
            "training_args.bin",
            "*.pid",
            "*.log",
        ],
    )
    print(f"[upload] DONE {repo_id}")


def main() -> None:
    for row in RUNS:
        upload_run(*row)


if __name__ == "__main__":
    main()
