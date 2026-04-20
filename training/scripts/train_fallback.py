"""Bare-metal TRL LoRA trainer. Fallback for when Axolotl trips on the
specific transformers + ROCm + Gemma-4 combination on the droplet.

Mirrors the same config as the YAML files: rank 32, alpha 64, target
modules q/k/v/o + gate/up/down, seq_len 4096, bf16, effective batch 16,
2 epochs, AdamW, cosine LR with 3% warmup.

Usage:
    python scripts/train_fallback.py \\
        --base google/gemma-4-E2B-it \\
        --out  outputs/gemma4-e2b-skyt1 \\
        --epochs 2
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer


TARGET_MODULES = [
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
]


def build_conversation(example: dict) -> dict:
    """Sky-T1 rows have `system` (str) + `conversations` (list of
    {from, value}). Fold system into a leading message so the chat
    template sees the whole turn sequence."""
    messages: list[dict] = []
    sys_prompt = example.get("system")
    if sys_prompt:
        messages.append({"role": "system", "content": sys_prompt})
    for turn in example.get("conversations", []):
        role = "user" if turn["from"] in ("human", "user") else "assistant"
        messages.append({"role": role, "content": turn["value"]})
    return {"messages": messages}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--micro-batch", type=int, default=None,
                        help="auto-picked from base-model size if omitted")
    parser.add_argument("--seq-len", type=int, default=4096)
    parser.add_argument("--rank", type=int, default=32)
    args = parser.parse_args()

    # Heuristic: E2B fits micro_batch=8, everything bigger goes to 4.
    if args.micro_batch is None:
        args.micro_batch = 8 if "e2b" in args.base.lower() else 4
    grad_accum = max(1, 16 // args.micro_batch)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(args.base, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.base,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        attn_implementation="sdpa",
    )
    model.config.use_cache = False
    model = get_peft_model(
        model,
        LoraConfig(
            r=args.rank,
            lora_alpha=2 * args.rank,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=TARGET_MODULES,
        ),
    )
    model.print_trainable_parameters()

    ds = load_dataset("NovaSky-AI/Sky-T1_data_17k", split="train")
    ds = ds.map(build_conversation, remove_columns=ds.column_names)
    split = ds.train_test_split(test_size=0.02, seed=0)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=split["train"],
        eval_dataset=split["test"],
        args=SFTConfig(
            output_dir=str(out),
            num_train_epochs=args.epochs,
            per_device_train_batch_size=args.micro_batch,
            gradient_accumulation_steps=grad_accum,
            gradient_checkpointing=True,
            learning_rate=2e-4,
            lr_scheduler_type="cosine",
            warmup_ratio=0.03,
            optim="adamw_torch",
            bf16=True,
            fp16=False,
            max_seq_length=args.seq_len,
            packing=True,
            logging_steps=20,
            eval_strategy="steps",
            eval_steps=200,
            save_strategy="steps",
            save_steps=500,
            save_total_limit=3,
            report_to="none",
        ),
    )
    trainer.train()
    trainer.save_model(str(out))
    tokenizer.save_pretrained(str(out))


if __name__ == "__main__":
    main()
