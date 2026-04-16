"""PEFT → mlx-lm LoRA adapter conversion.

The sidecar uses this to auto-convert any HF PEFT adapter (`adapter_model.safetensors`
+ PEFT-shaped `adapter_config.json`) into mlx-lm-native format
(`adapters.safetensors` + mlx-lm-shaped `adapter_config.json`).

Detection: PEFT configs declare `"peft_type": "LORA"`. mlx-lm configs declare
`"fine_tune_type": "lora"` and a `lora_parameters` block.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import mlx.core as mx
import numpy as np
import safetensors


PEFT_NAME = re.compile(
    r"^base_model\.model\.(?P<path>.+?)\.lora_(?P<which>[AB])\.weight$"
)

# Multimodal contamination — these substrings indicate non-text-side modules
# that mlx-lm's text-LoRA pipeline can't apply. Adapters targeting these
# (audio encoder, vision tower, projection bridges) are silently dropped.
NON_TEXT_MARKERS = (
    "audio_tower",
    "vision_tower",
    "image_proj",
    "embedding_projection",
    "per_layer_",
    "relative_",
    "input_proj",
    "output_proj",
    "embed_audio",
    "embed_vision",
)


def _normalize_text_path(path: str) -> str:
    """Map PEFT's text-side path to the mlx-lm convention.

    Gemma 3 / Llama-style:  PEFT path == mlx-lm path (no rewrite needed)
        e.g. language_model.model.layers.N.self_attn.q_proj
    Gemma 4 multimodal: PEFT writes `model.language_model.layers.N`, but mlx-lm
        registers the inner module as `language_model.model.layers.N`. Swap the
        order so the names match.
    """
    if path.startswith("model.language_model.layers."):
        # `model.language_model.layers.N.X` -> `language_model.model.layers.N.X`
        return "language_model.model." + path[len("model.language_model.") :]
    return path


class PeftConvertError(Exception):
    pass


def is_peft_adapter(adapter_dir: Path) -> bool:
    cfg_path = adapter_dir / "adapter_config.json"
    weights_path = adapter_dir / "adapter_model.safetensors"
    if not cfg_path.exists() or not weights_path.exists():
        return False
    try:
        cfg = json.loads(cfg_path.read_text())
    except Exception:
        return False
    return cfg.get("peft_type") == "LORA"


def is_mlx_adapter(adapter_dir: Path) -> bool:
    cfg_path = adapter_dir / "adapter_config.json"
    weights_path = adapter_dir / "adapters.safetensors"
    if not cfg_path.exists() or not weights_path.exists():
        return False
    try:
        cfg = json.loads(cfg_path.read_text())
    except Exception:
        return False
    return cfg.get("fine_tune_type") == "lora" and "lora_parameters" in cfg


def convert_peft_adapter(
    src_dir: Path,
    out_dir: Path,
    base_sha: str | None = None,
    base_model_id: str | None = None,
) -> dict:
    peft_cfg_path = src_dir / "adapter_config.json"
    weights_path = src_dir / "adapter_model.safetensors"
    if not peft_cfg_path.exists() or not weights_path.exists():
        raise PeftConvertError(f"expected PEFT files under {src_dir}")
    peft_cfg = json.loads(peft_cfg_path.read_text())
    if peft_cfg.get("peft_type") != "LORA":
        raise PeftConvertError(
            f"only LORA peft_type supported (found {peft_cfg.get('peft_type')!r})"
        )
    if peft_cfg.get("use_dora"):
        raise PeftConvertError("DoRA adapters not yet supported")

    rank = int(peft_cfg["r"])
    alpha = float(peft_cfg["lora_alpha"])
    scale = alpha / rank
    dropout = float(peft_cfg.get("lora_dropout") or 0.0)

    converted: dict[str, mx.array] = {}
    keys_seen: set[str] = set()
    layer_indices: set[int] = set()
    skipped_unmatched: list[str] = []
    skipped_non_text: list[str] = []

    with safetensors.safe_open(str(weights_path), framework="numpy") as sf:
        for name in sf.keys():
            m = PEFT_NAME.match(name)
            if not m:
                skipped_unmatched.append(name)
                continue
            path = m["path"]
            which = m["which"].lower()

            if any(marker in path for marker in NON_TEXT_MARKERS):
                skipped_non_text.append(name)
                continue

            mlx_path = _normalize_text_path(path)

            tensor = sf.get_tensor(name).astype(np.float32)
            arr = mx.array(tensor.T)
            converted[f"{mlx_path}.lora_{which}"] = arr

            layer_match = re.search(r"\.layers\.(\d+)\.", mlx_path)
            if layer_match:
                layer_indices.add(int(layer_match.group(1)))
            module_match = re.search(r"\.layers\.\d+\.(.+)$", mlx_path)
            if module_match:
                keys_seen.add(module_match.group(1))

    if not converted:
        raise PeftConvertError(
            "no tensors matched PEFT naming convention; nothing converted"
        )

    num_layers = max(layer_indices) + 1 if layer_indices else 0

    out_dir.mkdir(parents=True, exist_ok=True)
    mx.save_safetensors(str(out_dir / "adapters.safetensors"), converted)

    cfg: dict = {
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

    return {
        "converted_tensors": len(converted),
        "skipped_unmatched": len(skipped_unmatched),
        "skipped_non_text": len(skipped_non_text),
        "num_layers": num_layers,
        "keys": sorted(keys_seen),
        "rank": rank,
        "scale": scale,
        "out_dir": str(out_dir),
    }
