"""Convert a Hugging Face PEFT LoRA adapter into mlx-lm-native format.

Usage:
    python scripts/convert_peft_adapter.py \\
        --src ZySec-AI/gemma-3-4b-document-writer-lora \\
        --out ~/Library/Application\\ Support/com.lorahub.desktop/adapters/document-writer \\
        --base-sha 3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698

`--src` can be either a HF repo id or a local directory containing the PEFT
adapter files. `--base-sha` is optional but recommended — it embeds the target
base fingerprint into adapter_config.json so the client can compatibility-check
before loading.

The converter:
  1. Reads PEFT's adapter_config.json.
  2. Walks adapter_model.safetensors, renaming tensors:
        base_model.model.<path>.lora_{A,B}.weight
        -> <path>.lora_{a,b}
     and transposing to mlx-lm's (in, rank) / (rank, out) convention.
  3. Derives num_layers (max layer index + 1) and keys (unique target modules).
  4. Writes adapters.safetensors + adapter_config.json in mlx-lm format.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import mlx.core as mx
import numpy as np
import safetensors


PEFT_NAME = re.compile(
    r"^base_model\.model\.(?P<path>.+?)\.lora_(?P<which>[AB])\.weight$"
)


def resolve_source(src: str) -> Path:
    p = Path(src).expanduser()
    if p.is_dir():
        return p
    from huggingface_hub import snapshot_download
    print(f"downloading {src} from Hugging Face…")
    return Path(snapshot_download(src))


def convert(src_dir: Path, out_dir: Path, base_sha: str | None, base_model_id: str | None) -> dict:
    peft_cfg_path = src_dir / "adapter_config.json"
    weights_path = src_dir / "adapter_model.safetensors"
    if not peft_cfg_path.exists() or not weights_path.exists():
        raise SystemExit(f"expected PEFT files under {src_dir}")
    peft_cfg = json.loads(peft_cfg_path.read_text())
    if peft_cfg.get("peft_type") != "LORA":
        raise SystemExit(f"only LORA peft_type supported (found {peft_cfg.get('peft_type')!r})")
    if peft_cfg.get("use_dora"):
        raise SystemExit("DoRA adapters not yet supported by this converter")

    rank = int(peft_cfg["r"])
    alpha = float(peft_cfg["lora_alpha"])
    scale = alpha / rank
    dropout = float(peft_cfg.get("lora_dropout") or 0.0)

    converted: dict[str, mx.array] = {}
    keys_seen: set[str] = set()
    layer_indices: set[int] = set()
    skipped: list[str] = []

    with safetensors.safe_open(str(weights_path), framework="numpy") as sf:
        for name in sf.keys():
            m = PEFT_NAME.match(name)
            if not m:
                skipped.append(name)
                continue
            path = m["path"]
            which = m["which"].lower()

            tensor = sf.get_tensor(name).astype(np.float32)
            arr = mx.array(tensor.T)

            mlx_name = f"{path}.lora_{which}"
            converted[mlx_name] = arr

            layer_match = re.search(r"\.layers\.(\d+)\.", path)
            if layer_match:
                layer_indices.add(int(layer_match.group(1)))
            module_match = re.search(r"\.layers\.\d+\.(.+)$", path)
            if module_match:
                keys_seen.add(module_match.group(1))

    if not converted:
        raise SystemExit("no tensors matched PEFT naming convention; nothing converted")

    num_layers = max(layer_indices) + 1 if layer_indices else 0

    out_dir.mkdir(parents=True, exist_ok=True)
    mx.save_safetensors(str(out_dir / "adapters.safetensors"), converted)

    cfg = {
        "fine_tune_type": "lora",
        "num_layers": num_layers,
        "lora_parameters": {
            "rank": rank,
            "scale": scale,
            "dropout": dropout,
            "keys": sorted(keys_seen),
        },
        "source_format": "peft",
        "source_repo": peft_cfg.get("base_model_name_or_path"),
    }
    if base_sha:
        cfg["base_sha"] = base_sha
    if base_model_id:
        cfg["base_model_id"] = base_model_id

    (out_dir / "adapter_config.json").write_text(json.dumps(cfg, indent=2))

    report = {
        "converted_tensors": len(converted),
        "skipped_tensors": len(skipped),
        "num_layers": num_layers,
        "keys": sorted(keys_seen),
        "rank": rank,
        "scale": scale,
        "out_dir": str(out_dir),
    }
    if skipped[:3]:
        report["skipped_examples"] = skipped[:3]
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", required=True, help="HF repo id OR local PEFT adapter dir")
    ap.add_argument("--out", required=True, type=Path, help="output directory (mlx-lm format)")
    ap.add_argument("--base-sha", default=None, help="target base fingerprint")
    ap.add_argument("--base-model-id", default=None, help="HF repo id of target base")
    args = ap.parse_args()

    src_dir = resolve_source(args.src)
    report = convert(src_dir, args.out.expanduser(), args.base_sha, args.base_model_id)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
