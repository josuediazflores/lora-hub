# Training — Gemma 4 reasoning-distill LoRAs on AMD MI300X

Playbook for training two LoRA adapters (Gemma 4 **E2B** + **E4B**) that
distill Claude Opus reasoning style, using
[`NovaSky-AI/Sky-T1_data_17k`](https://huggingface.co/datasets/NovaSky-AI/Sky-T1_data_17k).
Target infra: DigitalOcean **MI300X** GPU Droplet with the
`PyTorch 2.6.0 / ROCm 7.0` quick-start image.

Trained adapters are PEFT-format; run them through
`sidecar/peft_convert.py` afterwards to produce MLX-lm artifacts for
lora-hub.

## Quick start

```bash
# 1. SSH into the droplet
ssh root@<droplet-ip>

# 2. Pull this repo (or scp the training/ directory)
git clone https://github.com/josuediazflores/lora-hub.git
cd lora-hub/training

# 3. Run setup (installs deps, configures tmux)
bash setup.sh

# 4. HF auth — paste a token that has accepted the Gemma 4 license at
#    https://huggingface.co/google/gemma-4-E4B-it
huggingface-cli login

# 5. Kick off training inside a tmux session so SSH drops don't kill it
tmux new -s train
axolotl preprocess configs/gemma4-e2b-skyt1.yaml
axolotl train       configs/gemma4-e2b-skyt1.yaml
# Ctrl-b d to detach; reattach with `tmux attach -t train`
```

Repeat for `configs/gemma4-e4b-skyt1.yaml`. Expected wall-clock on one
MI300X:

| Model | Time | Credit |
|---|---|---|
| E2B, 2 epochs @ 4096 ctx | ~1.5 h | ~$3 |
| E4B, 2 epochs @ 4096 ctx | ~3 h | ~$6 |

## Fallback trainer

If Axolotl chokes on ROCm 7 / Gemma 4, `scripts/train_fallback.py` is
an 80-line TRL script that replicates the same config without the
Axolotl layer:

```bash
python scripts/train_fallback.py \
  --base google/gemma-4-E2B-it \
  --out  outputs/gemma4-e2b-skyt1 \
  --epochs 2
```

## Export back to the Mac

```bash
# on Mac
scp -r root@<droplet-ip>:~/lora-hub/training/outputs/ \
       ~/Projects/lora-hub/training/outputs/

# convert PEFT → MLX
cd ~/Projects/lora-hub
python sidecar/peft_convert.py \
  training/outputs/gemma4-e2b-skyt1 \
  --base mlx-community/gemma-4-e2b-it-bf16 \
  --out adapters/gemma4-e2b-skyt1-mlx
```

Drop the resulting directory into lora-hub's adapters folder and it
registers automatically.

## Cleanup

**Destroy the droplet** from the DO console when training's done.
GPU credits burn at $1.99/hr even when idle; a forgotten droplet can
eat the remaining balance in a week.

## Files

- `setup.sh` — one-shot droplet prep
- `configs/gemma4-e2b-skyt1.yaml` — Axolotl config for E2B
- `configs/gemma4-e4b-skyt1.yaml` — Axolotl config for E4B
- `scripts/train_fallback.py` — bare-metal TRL trainer if Axolotl fails
- `.gitignore` — keeps `outputs/` and HF cache out of git
