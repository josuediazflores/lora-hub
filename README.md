# LoRA Hub

A local AI desktop app with a built-in storefront for LoRA adapters. Browse, install, and hot-swap task-specific adapters on a single base model.

## What works today

- **Hot-swap LoRA adapters mid-conversation** without restarting the model — the `mlx-lm` sidecar wraps the LoRA layers once, then swaps weights per-turn (sub-second on Apple Silicon).
- **Per-turn adapter provenance** — every assistant turn shows which adapter produced it via the colored gutter column; swap markers render between turns when the active adapter changes.
- **Storefront** — browse a Cloudflare Worker–backed catalog of community adapters. The seed catalog ships 5 real adapters from the HuggingFace community: `document-writer`, `instruction-tune`, `persian`, `emirati-family-chatbot`, `oasst1-instruct`. Install streams the weights from R2 to the local app data dir, verifies SHA-256, and loads them into the live model.
- **PEFT auto-conversion** — drop in any HuggingFace PEFT adapter (`adapter_model.safetensors` + `adapter_config.json`); the sidecar detects PEFT shape and converts to mlx-lm format on first load.
- **Composer modes** — Normal, Compare (run base vs adapter side-by-side on the same prompt), Specialist (planner LoRA delegates subtasks to other adapters), and Computer Use (full tool access — file reads/writes scoped to a picked workspace, shell commands gated by a permission preset).
- **Tools** — `read_file`, `write_file`, `grep`, `run_command` (shell), `web_search` (DuckDuckGo or Brave), `fetch_page`, `http_fetch`, `save_memory`. All bracketed by an append-only audit log; URL fetches are SSRF-guarded; shell commands run against a curated allowlist with a `read_only` / `standard` preset toggle.
- **Memory system** — durable user-scoped notes prepended to every system message; tool-driven saves go through an approval modal under the "ask" policy.
- **Attachments** — drag-drop files into the composer; PDF, DOCX, XLSX, RTF, and image extraction supported.
- **Insingnis design system** — Paper & Ink palette, serif/mono/sans typography roles, four canonical screens (chat, store landing, store browse, adapter detail).

## Status

Pre-alpha — no installer, no first-run onboarding (you have to set up the Python sidecar and storefront yourself, see Quick start). The chat UX and adapter-swap mechanics are stable; the storefront is local-dev only at the moment.

## Platform

- **v1 (current)**: macOS Apple Silicon, MLX backend.
- **v2 (planned)**: Windows / Linux NVIDIA, ExLlamaV2 backend — see `docs/PLAN.md`.

## Quick start

Prerequisites: macOS Apple Silicon, Node ≥ 20, Rust toolchain (`rustup`), Python ≥ 3.11, ~10 GB free disk for the base model + adapters.

```bash
# 1. Sidecar (Python, MLX)
python3 -m venv sidecar/.venv
sidecar/.venv/bin/pip install -r sidecar/requirements.txt

# 2. Storefront (Cloudflare Worker, local)
cd storefront
npm install
npm run db:reset:local   # creates D1 schema + seeds 5 adapters
cd ..

# 3. Desktop app
cd apps/desktop
npm install
cd ../..

# 4. Run the whole stack
./scripts/dev.sh
```

`scripts/dev.sh` boots the storefront on `:8787`, waits for it to accept requests, then launches the Tauri desktop app. Ctrl+C the Tauri window to stop everything.

On first launch you'll land on a welcome screen prompting you to pick a base model. The smallest option is **Gemma 4 E2B Instruct (4-bit)** at ~1.6 GB; downloading happens in-app via the sidecar from `mlx-community` on HuggingFace Hub. Once a base is loaded, the store landing page shows the seeded adapters and you can install one with a click.

See `docs/PLAN.md` for the architecture and `docs/UX.md` for the composer/UI contract.

## License

MIT — see [LICENSE](./LICENSE).
