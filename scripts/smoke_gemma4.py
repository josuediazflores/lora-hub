"""End-to-end smoke test for Gemma 4 E4B in the sidecar.

Spawns mlx_server.py, loads Gemma 4 E4B, downloads + auto-converts the two
seeded Gemma 4 PEFT adapters from Hugging Face, runs a short generation
against each, and asserts non-empty output.

Run from the repo root:

    sidecar/.venv/bin/python scripts/smoke_gemma4.py

Exits 0 on pass, 1 on any failure. Intended to be run before a release cut.
"""

from __future__ import annotations

import itertools
import json
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SIDECAR_SCRIPT = REPO_ROOT / "sidecar" / "mlx_server.py"
VENV_PYTHON = REPO_ROOT / "sidecar" / ".venv" / "bin" / "python"

BASE_MODEL = "mlx-community/gemma-4-e4b-it-4bit"
BASE_SHA = "769bec7273285355f6ba44a974df0e223fa7db7e3267e86b3e032ff006f792bc"

# (slug, hf_peft_repo, canary_prompt)
ADAPTERS = [
    (
        "emirati-family-chatbot",
        "Aledec/gemma4-emirati-family-chatbot-lora",
        "Write one short sentence greeting a family member.",
    ),
    (
        "oasst1-instruct",
        "safibaig03/gemma-4-E4B-oasst1-lora",
        "In one sentence, what is photosynthesis?",
    ),
]

MIN_RESPONSE_CHARS = 8


class SmokeFail(RuntimeError):
    pass


class Sidecar:
    def __init__(self, proc: subprocess.Popen):
        self.proc = proc
        self._ids = itertools.count(1)

    def _next_id(self) -> str:
        return f"smoke-{next(self._ids)}"

    def call(self, op: str, on_token=None, timeout: float = 900.0, **fields) -> dict:
        req_id = self._next_id()
        req = {"id": req_id, "op": op, **fields}
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        deadline = time.monotonic() + timeout
        while True:
            if time.monotonic() > deadline:
                raise SmokeFail(f"{op} timed out after {timeout}s")
            line = self.proc.stdout.readline()
            if not line:
                raise SmokeFail(f"sidecar stdout closed during {op}")
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("id") != req_id:
                continue
            mtype = msg.get("type")
            if mtype == "token" and on_token:
                on_token(msg.get("text", ""))
            elif mtype == "done":
                return msg.get("result", {})
            elif mtype == "error":
                err = msg.get("error", {})
                raise SmokeFail(
                    f"{op} error {err.get('code', '?')}: {err.get('message', '')}"
                )

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def step(label: str) -> None:
    print(f"\n▸ {label}", flush=True)


def ok(label: str) -> None:
    print(f"  ✓ {label}", flush=True)


def spawn_sidecar() -> Sidecar:
    python = VENV_PYTHON if VENV_PYTHON.exists() else Path(sys.executable)
    step(f"spawning sidecar ({python})")
    proc = subprocess.Popen(
        [str(python), str(SIDECAR_SCRIPT)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        text=True,
        bufsize=1,
    )
    return Sidecar(proc)


def run() -> int:
    if not SIDECAR_SCRIPT.exists():
        print(f"sidecar not found at {SIDECAR_SCRIPT}", file=sys.stderr)
        return 1
    from huggingface_hub import snapshot_download  # noqa: E402

    sc = spawn_sidecar()
    try:
        step(f"loading base {BASE_MODEL}")
        res = sc.call("load_base", model_id=BASE_MODEL)
        actual_sha = res.get("base_sha")
        if actual_sha != BASE_SHA:
            raise SmokeFail(
                f"base_sha mismatch: got {actual_sha}, expected {BASE_SHA}"
            )
        ok(f"loaded ({'cached' if res.get('cached') else 'fresh'})")

        for slug, hf_repo, prompt in ADAPTERS:
            step(f"adapter {slug} ← {hf_repo}")
            adapter_dir = Path(snapshot_download(hf_repo))
            ok(f"downloaded to {adapter_dir}")

            sc.call("load_adapter", name=slug, adapter_path=str(adapter_dir))
            ok("loaded into sidecar (PEFT auto-converted)")

            chunks: list[str] = []
            sc.call(
                "generate",
                on_token=lambda t: chunks.append(t),
                prompt=prompt,
                adapter=slug,
                max_tokens=64,
                temperature=0.7,
                top_p=0.95,
            )
            text = "".join(chunks).strip()
            if len(text) < MIN_RESPONSE_CHARS:
                raise SmokeFail(
                    f"response too short ({len(text)} chars): {text!r}"
                )
            preview = text.replace("\n", " ")[:80]
            ok(f'generated {len(text)} chars: "{preview}…"')

        step("smoke test PASSED")
        return 0
    except SmokeFail as e:
        print(f"\n✗ FAIL: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"\n✗ unexpected error: {e}", file=sys.stderr)
        return 1
    finally:
        sc.close()


if __name__ == "__main__":
    sys.exit(run())
