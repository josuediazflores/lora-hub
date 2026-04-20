#!/usr/bin/env bash
# One-shot droplet prep for LoRA training on MI300X with ROCm 7.0.
# Safe to re-run; each step is idempotent.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (the PyTorch ROCm image drops you in as root by default)"
  exit 1
fi

echo "==> apt updates"
apt-get update -qq
apt-get install -y -qq tmux htop jq nvtop

echo "==> rocm-smi (verify GPU)"
rocm-smi --showproductname || true

echo "==> Python training deps"
python -m pip install --upgrade pip

# Pin versions that are known to work on ROCm 7.0 + Gemma 4 today.
# transformers 4.50+ is required for Gemma 4 support. peft 0.13+,
# trl 0.12+, and datasets 3.x play nicely with the rest. Axolotl
# trails transformers slightly — install from main if the pip release
# doesn't support Gemma 4 yet.
pip install \
  "transformers>=4.50" \
  "peft>=0.13" \
  "trl>=0.12" \
  "datasets>=3.0" \
  "accelerate>=1.0" \
  "sentencepiece" \
  "protobuf<5" \
  "wandb"

# Try pip release first; if it can't see Gemma 4, swap to HEAD:
pip install "axolotl" \
  || pip install "git+https://github.com/OpenAccess-AI-Collective/axolotl.git"

echo "==> accelerate config (single-GPU bf16, no DeepSpeed/FSDP)"
mkdir -p ~/.cache/huggingface/accelerate
cat >~/.cache/huggingface/accelerate/default_config.yaml <<'EOF'
compute_environment: LOCAL_MACHINE
distributed_type: 'NO'
downcast_bf16: 'no'
machine_rank: 0
main_training_function: main
mixed_precision: bf16
num_machines: 1
num_processes: 1
rdzv_backend: static
same_network: true
tpu_env: []
tpu_use_cluster: false
tpu_use_sudo: false
use_cpu: false
EOF

echo ""
echo "==> Done. Next:"
echo "    1) huggingface-cli login        # paste a token that has accepted the Gemma 4 license"
echo "    2) tmux new -s train"
echo "    3) axolotl preprocess configs/gemma4-e2b-skyt1.yaml"
echo "    4) axolotl train       configs/gemma4-e2b-skyt1.yaml"
