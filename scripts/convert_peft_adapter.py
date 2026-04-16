"""CLI wrapper for sidecar.peft_convert.convert_peft_adapter.

Usage:
    python scripts/convert_peft_adapter.py \\
        --src ZySec-AI/gemma-3-4b-document-writer-lora \\
        --out ~/Library/Application\\ Support/com.lorahub.desktop/adapters/document-writer \\
        --base-sha 3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698

`--src` can be a HF repo id or a local PEFT directory.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow running this script from the repo root without installing the sidecar
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "sidecar"))

from peft_convert import convert_peft_adapter  # noqa: E402


def resolve_source(src: str) -> Path:
    p = Path(src).expanduser()
    if p.is_dir():
        return p
    from huggingface_hub import snapshot_download

    print(f"downloading {src} from Hugging Face…")
    return Path(snapshot_download(src))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", required=True, help="HF repo id OR local PEFT adapter dir")
    ap.add_argument("--out", required=True, type=Path, help="output directory")
    ap.add_argument("--base-sha", default=None, help="target base fingerprint")
    ap.add_argument("--base-model-id", default=None, help="HF repo id of target base")
    args = ap.parse_args()

    src_dir = resolve_source(args.src)
    report = convert_peft_adapter(
        src_dir, args.out.expanduser(), args.base_sha, args.base_model_id
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
